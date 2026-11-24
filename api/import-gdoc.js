import TurndownService from 'turndown';

/**
 * Vercel Serverless Function: Google Docs Importer (`/api/import-gdoc`)
 *
 * Accepts POST { url: "https://docs.google.com/document/d/<FILE_ID>/..." }
 *  1. Strictly validates & extracts <FILE_ID> from Google Docs URLs.
 *  2. Fetches Google's clean Markdown export (`export?format=md`), falling back
 *     to HTML export (`export?format=html`) converted via `turndown`.
 *  3. Detects Restricted / login-gated Google Docs and returns a clear 403 error.
 */

const FETCH_TIMEOUT_MS = 15000;
const GOOGLE_DOC_ID_REGEX =
  /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})(?:\/|$|\?|#)/i;

function extractGoogleDocId(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  const match = trimmed.match(GOOGLE_DOC_ID_REGEX);
  return match ? match[1] : null;
}

function isLoginOrRestrictedResponse(response, bodyText) {
  const finalUrl = String(response?.url || '').toLowerCase();
  if (
    response.status === 401 ||
    response.status === 403 ||
    finalUrl.includes('accounts.google.com') ||
    finalUrl.includes('servicelogin')
  ) {
    return true;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const sample = String(bodyText || '').slice(0, 4000).toLowerCase();
  if (
    contentType.includes('text/html') &&
    (sample.includes('accounts.google.com') ||
      sample.includes('servicelogin') ||
      sample.includes('you need access') ||
      sample.includes('request access') ||
      sample.includes('sign in - google accounts'))
  ) {
    return true;
  }

  return false;
}

function extractTitleFromDisposition(disposition) {
  if (!disposition) return '';

  // RFC 5987 UTF-8 filename*=UTF-8''...
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/\.(md|markdown|html|htm|docx|txt)$/i, '').trim();
    } catch {
      // fall through
    }
  }

  // Standard filename="..."
  const asciiMatch = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1].replace(/\.(md|markdown|html|htm|docx|txt)$/i, '').trim();
  }

  return '';
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!match?.[1]) return '';
  return match[1]
    .replace(/\s*[-–—]\s*Google Docs\s*$/i, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractTitleFromMarkdown(markdown) {
  const headingMatch = String(markdown || '').match(/^#{1,2}\s+(.+)$/m);
  if (!headingMatch?.[1]) return '';
  return headingMatch[1].replace(/[*_`\\]/g, '').trim().slice(0, 120);
}

function convertHtmlToMarkdown(html) {
  // Strip head, style, and script tags before feeding into Turndown
  const bodyMatch = String(html || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const cleanedHtml = (bodyMatch ? bodyMatch[1] : String(html || ''))
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Preserve superscripts/subscripts cleanly when present in academic notes
  turndown.addRule('sup', {
    filter: 'sup',
    replacement: (content) => (content.trim() ? `^${content}` : ''),
  });
  turndown.addRule('sub', {
    filter: 'sub',
    replacement: (content) => (content.trim() ? `_${content}` : ''),
  });

  // Convert simple HTML tables cleanly to GFM markdown tables
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows.map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) =>
          cell.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
        )
      );
      const colCount = Math.max(...matrix.map((r) => r.length), 1);
      const padRow = (r) =>
        Array.from({ length: colCount }, (_, idx) => r[idx] || '');
      const header = padRow(matrix[0]);
      const sep = header.map(() => '---');
      const bodyRows = matrix.slice(1).map(padRow);
      const lines = [
        `| ${header.join(' | ')} |`,
        `| ${sep.join(' | ')} |`,
        ...bodyRows.map((r) => `| ${r.join(' | ')} |`),
      ];
      return `\n\n${lines.join('\n')}\n\n`;
    },
  });

  return turndown.turndown(cleanedHtml).replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeImportedMarkdown(md) {
  return String(md || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchGoogleExport(fileId, format) {
  const exportUrl = `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/export?format=${format}`;
  const response = await fetch(exportUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; HyperDocsImporter/1.0; +https://github.com/trongdat-code/hyperdocs)',
      Accept: format === 'md' ? 'text/markdown, text/plain, */*' : 'text/html, */*',
    },
  });
  const text = await response.text();
  return { response, text };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
  }

  const rawUrl = String(body?.url || '').trim();
  const fileId = extractGoogleDocId(rawUrl);

  if (!fileId) {
    return res.status(400).json({
      code: 'INVALID_GDOC_URL',
      error:
        'Please enter a valid Google Docs URL (e.g., https://docs.google.com/document/d/<FILE_ID>/edit).',
    });
  }

  try {
    // 1. Try native Google Docs Markdown export first
    const mdAttempt = await fetchGoogleExport(fileId, 'md');

    if (isLoginOrRestrictedResponse(mdAttempt.response, mdAttempt.text)) {
      return res.status(403).json({
        code: 'RESTRICTED_DOC',
        error:
          'This Google Doc is currently set to "Restricted". Open Share settings in Google Docs, change General access to "Anyone with the link" (Viewer), and try again.',
      });
    }

    if (mdAttempt.response.status === 404) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        error: 'Google Doc not found. Please check that the URL is correct and the file still exists.',
      });
    }

    const mdContentType = String(mdAttempt.response.headers.get('content-type') || '').toLowerCase();
    const looksLikeHtmlPage =
      mdContentType.includes('text/html') || /^\s*<!doctype html/i.test(mdAttempt.text);

    if (mdAttempt.response.ok && mdAttempt.text.trim() && !looksLikeHtmlPage) {
      const markdown = normalizeImportedMarkdown(mdAttempt.text);
      const title =
        extractTitleFromDisposition(mdAttempt.response.headers.get('content-disposition')) ||
        extractTitleFromMarkdown(markdown) ||
        'Imported Google Doc';

      return res.status(200).json({
        title,
        markdown,
        format: 'md',
        fileId,
      });
    }

    // 2. Fallback to HTML export converted cleanly via Turndown
    const htmlAttempt = await fetchGoogleExport(fileId, 'html');

    if (isLoginOrRestrictedResponse(htmlAttempt.response, htmlAttempt.text)) {
      return res.status(403).json({
        code: 'RESTRICTED_DOC',
        error:
          'This Google Doc is currently set to "Restricted". Open Share settings in Google Docs, change General access to "Anyone with the link" (Viewer), and try again.',
      });
    }

    if (htmlAttempt.response.status === 404) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        error: 'Google Doc not found. Please check that the URL is correct.',
      });
    }

    if (!htmlAttempt.response.ok || !htmlAttempt.text.trim()) {
      return res.status(502).json({
        error: `Google Docs export failed (HTTP ${htmlAttempt.response.status}). Make sure the document is shared with "Anyone with the link".`,
      });
    }

    const markdown = normalizeImportedMarkdown(convertHtmlToMarkdown(htmlAttempt.text));
    const title =
      extractTitleFromDisposition(htmlAttempt.response.headers.get('content-disposition')) ||
      extractTitleFromHtml(htmlAttempt.text) ||
      extractTitleFromMarkdown(markdown) ||
      'Imported Google Doc';

    return res.status(200).json({
      title,
      markdown,
      format: 'html-fallback',
      fileId,
    });
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('[api/import-gdoc] failed:', err?.message || err);
    return res.status(isTimeout ? 504 : 500).json({
      error: isTimeout
        ? 'Timed out while fetching Google Doc. Please try again.'
        : err?.message || 'Failed to import Google Doc.',
    });
  }
}

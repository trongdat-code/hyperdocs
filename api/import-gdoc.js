import TurndownService from 'turndown';
import { formatImportedText } from '../src/utils/formatImportedText.js';

/**
 * Vercel Serverless Function: Google Docs Importer (`/api/import-gdoc`)
 *
 * Accepts POST { url: "https://docs.google.com/document/d/<FILE_ID>/..." }
 *  1. Strictly validates & extracts <FILE_ID> from Google Docs URLs.
 *  2. Fetches Google Docs HTML export (`export?format=html`) and converts block
 *     elements (`<p>`, `<div>`, `<h1>`–`<h6>`, `<li>`, `<br>`, `<tr>`) explicitly
 *     into double newlines (`\n\n`) via Turndown so paragraphs never collapse.
 *  3. Falls back cleanly to `.txt` (`export?format=txt`, normalizing `\r\n` -> `\n`)
 *     and `.md` (`export?format=md`) if HTML export is unavailable.
 *  4. Applies `formatImportedText()` to preserve spacing around paragraphs,
 *     Vietnamese problem headers (`Câu 1:`, `Bài 1:`, `Phần I:`), and sub-items (`a)`, `b)`).
 *  5. Detects Restricted / login-gated Google Docs and returns a clear 403 error.
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
  const utf8Match = disposition.match(/filename\*\s*=\s*"?(?:utf-?8)'[^']*'([^";\r\n]+)"?/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
        .replace(/["\r\n]/g, '')
        .replace(/\.(md|markdown|html|htm|docx|txt)$/i, '')
        .trim();
    } catch {
      // fall through
    }
  }

  // Standard filename="..."
  const asciiMatch = disposition.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1]
      .replace(/["\r\n]/g, '')
      .replace(/\.(md|markdown|html|htm|docx|txt)$/i, '')
      .trim();
  }

  return '';
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return '';
  return decodeHtmlEntities(match[1])
    .replace(/\s*[-–—]\s*Google Docs\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromMarkdown(markdown) {
  const headingMatch = String(markdown || '').match(/^#{1,2}\s+(.+)$/m);
  if (!headingMatch?.[1]) return '';
  return headingMatch[1].replace(/[*_`\\]/g, '').trim().slice(0, 120);
}

function extractCellText(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    return node.nodeValue || '';
  }
  const tag = String(node.nodeName || '').toUpperCase();
  if (tag === 'BR') return ' ';
  const isBlock = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE)$/.test(tag);
  const children = Array.from(node.childNodes || [])
    .map(extractCellText)
    .join('');
  return isBlock ? ` ${children} ` : children;
}

function fallbackHtmlToParagraphText(cleanedHtml) {
  return decodeHtmlEntities(
    String(cleanedHtml || '')
      .replace(/<br\s*\/?>/gi, '\n\n')
      .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, '\n\n')
      .replace(/<(?:p|div|h[1-6]|li|tr|blockquote|section|article)(?:\s[^>]*)?>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function convertHtmlToMarkdown(html) {
  // Extract body and strip head, style, script, and metadata tags before feeding into Turndown
  const rawHtml = String(html || '').replace(/\r\n?/g, '\n');
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const cleanedHtml = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/\u200B/g, '');

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Explicitly convert <br> into double newlines so Shift+Enter line breaks never collapse
  turndown.addRule('gdocLineBreak', {
    filter: 'br',
    replacement: () => '\n\n',
  });

  // Explicitly convert <p> into distinct Markdown paragraphs separated by \n\n
  turndown.addRule('gdocParagraph', {
    filter: 'p',
    replacement: (content, node) => {
      const parentName = String(node.parentNode?.nodeName || '').toUpperCase();
      const trimmed = content.replace(/\u00A0/g, ' ').trim();
      if (!trimmed) {
        return parentName === 'TD' || parentName === 'TH' ? '' : '\n\n';
      }
      return `\n\n${trimmed}\n\n`;
    },
  });

  // Explicitly convert <div> into distinct block paragraphs separated by \n\n
  turndown.addRule('gdocDiv', {
    filter: 'div',
    replacement: (content) => {
      const trimmed = content.replace(/\u00A0/g, ' ').trim();
      return trimmed ? `\n\n${trimmed}\n\n` : '\n\n';
    },
  });

  // Explicitly convert <h1>–<h6> into ATX headings separated by \n\n
  turndown.addRule('gdocHeading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: (content, node) => {
      const level = Number(String(node.nodeName || '').charAt(1)) || 2;
      const trimmed = content.replace(/\u00A0/g, ' ').replace(/\n+/g, ' ').trim();
      return trimmed ? `\n\n${'#'.repeat(level)} ${trimmed}\n\n` : '';
    },
  });

  // Explicitly separate <li> items cleanly with \n\n while preserving ordered/unordered list markers
  turndown.addRule('gdocListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const cleaned = content
        .replace(/\u00A0/g, ' ')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n/gm, '\n  ');

      if (!cleaned.trim()) return '';

      const parent = node.parentNode;
      let prefix = `${options.bulletListMarker} `;
      if (parent && String(parent.nodeName || '').toUpperCase() === 'OL') {
        const start = Number(parent.getAttribute('start')) || 1;
        const siblings = Array.from(parent.children || []).filter(
          (child) => String(child.nodeName || '').toUpperCase() === 'LI'
        );
        const index = siblings.indexOf(node);
        prefix = `${start + (index >= 0 ? index : 0)}. `;
      }

      return `\n\n${prefix}${cleaned}\n\n`;
    },
  });

  // Explicitly convert <tr> into \n\n-separated blocks (used for 1-column layout boxes or standalone rows)
  turndown.addRule('gdocTableRow', {
    filter: 'tr',
    replacement: (content) => {
      const trimmed = content.replace(/\u00A0/g, ' ').trim();
      return trimmed ? `\n\n${trimmed}\n\n` : '\n\n';
    },
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

  // Convert multi-column HTML tables to GFM tables; unwrap 1-column Google Docs layout boxes into paragraphs
  turndown.addRule('table', {
    filter: 'table',
    replacement: (content, node) => {
      const hasNestedTable = Boolean(node.querySelector('table'));
      const rows = Array.from(node.querySelectorAll('tr')).filter(
        (row) => row.closest('table') === node
      );
      if (rows.length === 0) return '';

      const matrix = rows
        .map((row) =>
          Array.from(row.children || [])
            .filter((cell) => /^(TH|TD)$/i.test(cell.nodeName))
            .map((cell) =>
              extractCellText(cell)
                .replace(/\u00A0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .replace(/\|/g, '\\|')
            )
        )
        .filter((r) => r.length > 0);

      if (matrix.length === 0) return '';

      const colCount = Math.max(...matrix.map((r) => r.length), 1);

      // Single-column layout/callout boxes or nested tables: keep rich block paragraphs via tr/p rules
      if (colCount < 2 || hasNestedTable) {
        const unwrapped = content.replace(/\n{3,}/g, '\n\n').trim();
        return unwrapped ? `\n\n${unwrapped}\n\n` : '';
      }

      const padRow = (r) => Array.from({ length: colCount }, (_, idx) => r[idx] || '');
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

  try {
    const md = turndown.turndown(cleanedHtml);
    return md
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return fallbackHtmlToParagraphText(cleanedHtml);
  }
}

function normalizeImportedMarkdown(md) {
  return formatImportedText(
    String(md || '')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
  );
}

async function fetchGoogleExport(fileId, format) {
  const exportUrl = `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/export?format=${format}`;
  const acceptMap = {
    html: 'text/html, application/xhtml+xml, */*',
    txt: 'text/plain; charset=utf-8, text/plain, */*',
    md: 'text/markdown, text/plain, */*',
  };

  const response = await fetch(exportUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; HyperDocsImporter/1.0; +https://github.com/trongdat-code/hyperdocs)',
      Accept: acceptMap[format] || '*/*',
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
    // 1. Primary: Fetch Google Docs HTML export (`export?format=html`) to preserve exact block structure
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
        error: 'Google Doc not found. Please check that the URL is correct and the file still exists.',
      });
    }

    if (htmlAttempt.response.ok && htmlAttempt.text.trim()) {
      const converted = convertHtmlToMarkdown(htmlAttempt.text);
      const markdown = normalizeImportedMarkdown(converted);
      if (markdown) {
        const title =
          extractTitleFromDisposition(htmlAttempt.response.headers.get('content-disposition')) ||
          extractTitleFromHtml(htmlAttempt.text) ||
          extractTitleFromMarkdown(markdown) ||
          'Imported Google Doc';

        return res.status(200).json({
          title,
          markdown,
          format: 'html',
          fileId,
        });
      }
    }

    // 2. Fallback 1: Fetch Google Docs plain text export (`export?format=txt`) preserving line breaks
    const txtAttempt = await fetchGoogleExport(fileId, 'txt');

    if (isLoginOrRestrictedResponse(txtAttempt.response, txtAttempt.text)) {
      return res.status(403).json({
        code: 'RESTRICTED_DOC',
        error:
          'This Google Doc is currently set to "Restricted". Open Share settings in Google Docs, change General access to "Anyone with the link" (Viewer), and try again.',
      });
    }

    if (txtAttempt.response.status === 404) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        error: 'Google Doc not found. Please check that the URL is correct.',
      });
    }

    const txtContentType = String(txtAttempt.response.headers.get('content-type') || '').toLowerCase();
    const txtLooksLikeHtml =
      txtContentType.includes('text/html') || /^\s*<!doctype html/i.test(txtAttempt.text);

    if (txtAttempt.response.ok && txtAttempt.text.trim() && !txtLooksLikeHtml) {
      const markdown = normalizeImportedMarkdown(txtAttempt.text);
      if (markdown) {
        const title =
          extractTitleFromDisposition(txtAttempt.response.headers.get('content-disposition')) ||
          extractTitleFromHtml(htmlAttempt.text) ||
          extractTitleFromMarkdown(markdown) ||
          'Imported Google Doc';

        return res.status(200).json({
          title,
          markdown,
          format: 'txt-fallback',
          fileId,
        });
      }
    }

    // 3. Fallback 2: Native Google Docs Markdown export (`export?format=md`)
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
        error: 'Google Doc not found. Please check that the URL is correct.',
      });
    }

    const mdContentType = String(mdAttempt.response.headers.get('content-type') || '').toLowerCase();
    const mdLooksLikeHtml =
      mdContentType.includes('text/html') || /^\s*<!doctype html/i.test(mdAttempt.text);

    if (!mdAttempt.response.ok || !mdAttempt.text.trim() || mdLooksLikeHtml) {
      return res.status(502).json({
        error: `Google Docs export failed (HTTP ${htmlAttempt.response.status || mdAttempt.response.status}). Make sure the document is shared with "Anyone with the link".`,
      });
    }

    const markdown = normalizeImportedMarkdown(mdAttempt.text);
    const title =
      extractTitleFromDisposition(mdAttempt.response.headers.get('content-disposition')) ||
      extractTitleFromHtml(htmlAttempt.text) ||
      extractTitleFromMarkdown(markdown) ||
      'Imported Google Doc';

    return res.status(200).json({
      title,
      markdown,
      format: 'md-fallback',
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

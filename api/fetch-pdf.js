/**
 * Vercel Serverless Function: CORS Proxy for External PDF URLs (`/api/fetch-pdf`)
 *
 * Accepts:
 *   - GET  /api/fetch-pdf?url=<ENCODED_PDF_URL>
 *   - POST /api/fetch-pdf  { url: "<PDF_URL>" }
 *
 * Features:
 *   1. Automatically converts Google Drive share URLs
 *      (`drive.google.com/file/d/<ID>/view` or `open?id=<ID>`) into
 *      `https://drive.google.com/uc?export=download&id=<ID>`.
 *   2. Blocks private/loopback/internal hostnames (SSRF protection) and enforces
 *      strict HTTP/HTTPS validation, a 20s timeout, and a 20MB streaming cap.
 *   3. Handles Google Drive large-file confirmation HTML pages and returns a clear
 *      403 `RESTRICTED_PDF` error when a Drive file is set to "Restricted".
 *   4. Streams the verified PDF binary back with `Content-Type: application/pdf`
 *      so it can be used safely by `pdfjs-dist`, Gemini extraction, or `<iframe>` preview.
 */

const FETCH_TIMEOUT_MS = 20000;
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB cap

const DRIVE_FILE_D_REGEX =
  /^https?:\/\/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})(?:\/|$|\?|#)/i;
const DRIVE_OPEN_OR_UC_REGEX =
  /^https?:\/\/drive\.google\.com\/(?:open|uc)\?.*?(?:^|[?&])id=([a-zA-Z0-9_-]{10,120})(?:&|$|#)/i;

function normalizeTargetUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { error: 'Missing PDF URL.' };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'Please provide a valid http(s) PDF URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'Only http:// and https:// URLs are supported.' };
  }

  // Convert Google Drive share links to direct download URLs
  const driveMatch = trimmed.match(DRIVE_FILE_D_REGEX) || trimmed.match(DRIVE_OPEN_OR_UC_REGEX);
  if (driveMatch?.[1]) {
    const fileId = driveMatch[1];
    return {
      url: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
      isGoogleDrive: true,
      driveFileId: fileId,
    };
  }

  return {
    url: parsed.toString(),
    isGoogleDrive: parsed.hostname.toLowerCase().endsWith('drive.google.com') ||
      parsed.hostname.toLowerCase().endsWith('googleusercontent.com'),
    driveFileId: null,
  };
}

function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }

  // Block private IPv4 ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }

  // Block private IPv6 prefixes (fc00::/7, fe80::/10)
  if (/^(fc|fd|fe[89ab])[0-9a-f]{0,2}:/i.test(host)) {
    return true;
  }

  return false;
}

function isPdfBuffer(buf) {
  if (!buf || buf.length < 5) return false;
  // PDF header `%PDF-` usually starts at byte 0, occasionally preceded by BOM/whitespace
  const head = buf.subarray(0, Math.min(buf.length, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

function extractFilenameFromHeadersOrUrl(disposition, targetUrl) {
  if (disposition) {
    const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]).replace(/["\r\n]/g, '').trim();
      } catch {
        // fall through
      }
    }
    const asciiMatch = disposition.match(/filename\s*=\s*"?([^";\r\n]+)"?/i);
    if (asciiMatch?.[1]) {
      return asciiMatch[1].replace(/["\r\n]/g, '').trim();
    }
  }

  try {
    const pathname = new URL(targetUrl).pathname;
    const lastSegment = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    if (lastSegment && /\.pdf$/i.test(lastSegment)) {
      return lastSegment;
    }
  } catch {
    // ignore
  }

  return 'document.pdf';
}

function extractGoogleDriveConfirmUrl(html, fileId) {
  const text = String(html || '');
  // Match Google Drive virus-scan confirmation form or link
  const formActionMatch = text.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]*)"/i);
  if (formActionMatch?.[1]) {
    const baseAction = formActionMatch[1].replace(/&amp;/g, '&');
    const urlObj = new URL(baseAction);
    const inputRegex = /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi;
    let match;
    while ((match = inputRegex.exec(text)) !== null) {
      urlObj.searchParams.set(match[1], match[2]);
    }
    if (!urlObj.searchParams.has('confirm')) {
      urlObj.searchParams.set('confirm', 't');
    }
    return urlObj.toString();
  }

  const confirmTokenMatch = text.match(/confirm=([0-9A-Za-z_-]+)/i);
  if (confirmTokenMatch?.[1] && fileId) {
    return `https://drive.google.com/uc?export=download&confirm=${encodeURIComponent(
      confirmTokenMatch[1]
    )}&id=${encodeURIComponent(fileId)}`;
  }

  return null;
}

function looksLikeRestrictedGoogleResponse(response, htmlSample) {
  const finalUrl = String(response?.url || '').toLowerCase();
  const sample = String(htmlSample || '').slice(0, 5000).toLowerCase();
  return (
    response.status === 401 ||
    response.status === 403 ||
    finalUrl.includes('accounts.google.com') ||
    finalUrl.includes('servicelogin') ||
    sample.includes('accounts.google.com') ||
    sample.includes('you need access') ||
    sample.includes('request access') ||
    sample.includes('sign in - google accounts')
  );
}

async function readResponseWithLimit(response) {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_PDF_BYTES) {
    const err = new Error('PDF file exceeds the 20 MB proxy limit.');
    err.status = 413;
    throw err;
  }

  if (!response.body) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > MAX_PDF_BYTES) {
      const err = new Error('PDF file exceeds the 20 MB proxy limit.');
      err.status = 413;
      throw err;
    }
    return Buffer.from(ab);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PDF_BYTES) {
      await reader.cancel();
      const err = new Error('PDF file exceeds the 20 MB proxy limit.');
      err.status = 413;
      throw err;
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, totalBytes);
}

async function fetchExternalPdf(targetUrl) {
  const parsed = new URL(targetUrl);
  if (isBlockedHostname(parsed.hostname)) {
    const err = new Error('Fetching from private or local network addresses is not allowed.');
    err.status = 403;
    throw err;
  }

  return fetch(targetUrl, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; HyperDocsPdfProxy/1.0; +https://github.com/trongdat-code/hyperdocs)',
      Accept: 'application/pdf, application/octet-stream, */*',
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  let rawUrl = '';
  if (req.method === 'GET') {
    rawUrl = String(req.query?.url || '').trim();
  } else {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON request body.' });
      }
    }
    rawUrl = String(body?.url || '').trim();
  }

  const normalized = normalizeTargetUrl(rawUrl);
  if (normalized.error) {
    return res.status(400).json({ code: 'INVALID_PDF_URL', error: normalized.error });
  }

  try {
    let response = await fetchExternalPdf(normalized.url);
    let buffer = await readResponseWithLimit(response);
    let contentType = String(response.headers.get('content-type') || '').toLowerCase();

    // Handle Google Drive large-file confirmation interstitial or Restricted page
    if (!isPdfBuffer(buffer) && normalized.isGoogleDrive) {
      const htmlText = buffer.toString('utf8');
      if (looksLikeRestrictedGoogleResponse(response, htmlText)) {
        return res.status(403).json({
          code: 'RESTRICTED_PDF',
          error:
            'This Google Drive PDF is set to "Restricted". Change sharing to "Anyone with the link — Viewer" and try again.',
        });
      }

      const confirmUrl = extractGoogleDriveConfirmUrl(htmlText, normalized.driveFileId);
      if (confirmUrl) {
        response = await fetchExternalPdf(confirmUrl);
        buffer = await readResponseWithLimit(response);
        contentType = String(response.headers.get('content-type') || '').toLowerCase();
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return res.status(403).json({
          code: 'RESTRICTED_PDF',
          error:
            'Access denied by the remote PDF host. Make sure the PDF link is publicly accessible.',
        });
      }
      if (response.status === 404) {
        return res.status(404).json({
          code: 'NOT_FOUND',
          error: 'PDF file not found at that URL (HTTP 404).',
        });
      }
      return res.status(502).json({
        error: `Failed to fetch remote PDF (HTTP ${response.status}).`,
      });
    }

    if (!isPdfBuffer(buffer) && !contentType.includes('application/pdf')) {
      if (normalized.isGoogleDrive && looksLikeRestrictedGoogleResponse(response, buffer.toString('utf8'))) {
        return res.status(403).json({
          code: 'RESTRICTED_PDF',
          error:
            'This Google Drive PDF is set to "Restricted". Change sharing to "Anyone with the link — Viewer" and try again.',
        });
      }
      return res.status(422).json({
        code: 'NOT_A_PDF',
        error:
          'The provided URL did not return a valid PDF document. Ensure it points directly to a .pdf file or a public Google Drive PDF link.',
      });
    }

    const filename = extractFilenameFromHeadersOrUrl(
      response.headers.get('content-disposition'),
      response.url || normalized.url
    );
    const safeAsciiFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeAsciiFilename || 'document.pdf'}"; filename*=UTF-8''${encodeURIComponent(
        filename || 'document.pdf'
      )}`
    );
    res.setHeader('X-PDF-Filename', encodeURIComponent(filename || 'document.pdf'));
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(buffer);
  } catch (err) {
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const status = err?.status || (isTimeout ? 504 : 500);
    console.error('[api/fetch-pdf] failed:', err?.message || err);
    return res.status(status).json({
      error: isTimeout
        ? 'Timed out while downloading the remote PDF. Please try again.'
        : err?.message || 'Failed to fetch PDF from the provided URL.',
    });
  }
}

import mammoth from 'mammoth';
import TurndownService from 'turndown';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { sanitizeImportedMarkdown } from '../utils/katexSanitizer';
import { convertPdfWithGemini } from './geminiService';

/**
 * Client-Side Document Import Service
 *  1. importGoogleDoc(url, opts)            — Calls server-side `/api/import-gdoc`
 *  2. convertDocxFileToMarkdown(file, opts) — Converts `.docx` -> HTML (mammoth) -> Markdown (turndown)
 *  3. importPdfFile(file, opts)             — PDF <= 4MB via `/api/gemini` (action: "pdf"),
 *                                             PDF > 4MB via zero-token local `pdfjs-dist` + KaTeX sanitizer
 *  4. normalizePdfUrl(url) & fetchPdfFileFromUrl(url) — Direct `.pdf` & Google Drive PDF URL importer
 *                                             with automatic `/api/fetch-pdf` CORS proxy fallback
 */

const GDOC_IMPORT_ENDPOINT = '/api/import-gdoc';
const PDF_PROXY_ENDPOINT = '/api/fetch-pdf';
export const PDF_GEMINI_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

const DRIVE_FILE_D_REGEX =
  /^https?:\/\/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})(?:\/|$|\?|#)/i;
const DRIVE_OPEN_OR_UC_REGEX =
  /^https?:\/\/drive\.google\.com\/(?:open|uc)\?.*?(?:^|[?&])id=([a-zA-Z0-9_-]{10,120})(?:&|$|#)/i;

/**
 * Normalize an external PDF URL.
 * Automatically converts Google Drive share URLs (`drive.google.com/file/d/<ID>/view`)
 * into direct download (`https://drive.google.com/uc?export=download&id=<ID>`) and preview URLs.
 */
export function normalizePdfUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('Please enter a PDF URL.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Please enter a valid http(s) PDF URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// PDF URLs are supported.');
  }

  const driveMatch = trimmed.match(DRIVE_FILE_D_REGEX) || trimmed.match(DRIVE_OPEN_OR_UC_REGEX);
  if (driveMatch?.[1]) {
    const driveFileId = driveMatch[1];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
      driveFileId
    )}`;
    return {
      originalUrl: trimmed,
      downloadUrl,
      previewUrl: `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/preview`,
      proxyUrl: `${PDF_PROXY_ENDPOINT}?url=${encodeURIComponent(downloadUrl)}`,
      isGoogleDrive: true,
      driveFileId,
    };
  }

  const cleanUrl = parsed.toString();
  return {
    originalUrl: trimmed,
    downloadUrl: cleanUrl,
    previewUrl: cleanUrl,
    proxyUrl: `${PDF_PROXY_ENDPOINT}?url=${encodeURIComponent(cleanUrl)}`,
    isGoogleDrive: false,
    driveFileId: null,
  };
}

export function derivePdfTitleFromUrl(rawUrl, fallback = 'Imported PDF') {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    const lastSegment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    const cleaned = lastSegment.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    if (cleaned && cleaned.toLowerCase() !== 'view' && cleaned.toLowerCase() !== 'uc') {
      return cleaned.slice(0, 120);
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function readFileAsPdfDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

export function pdfDataUrlToBlob(dataUrl) {
  const str = String(dataUrl || '');
  const commaIdx = str.indexOf(',');
  const base64 = commaIdx >= 0 ? str.slice(commaIdx + 1) : str;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

async function blobStartsWithPdfSignature(blob) {
  if (!blob || blob.size < 5) return false;
  try {
    const headBuf = await blob.slice(0, Math.min(blob.size, 1024)).arrayBuffer();
    const headText = new TextDecoder('latin1').decode(headBuf);
    return headText.includes('%PDF-');
  } catch {
    return false;
  }
}

/**
 * Fetch an external PDF URL as a File + Blob.
 * - For non-Drive direct URLs, tries browser fetch first; on CORS/network failure, falls back
 *   seamlessly to the server-side CORS proxy (`/api/fetch-pdf`).
 * - For Google Drive URLs, routes directly through `/api/fetch-pdf` (Google Drive blocks browser CORS).
 */
export async function fetchPdfFileFromUrl(rawUrl) {
  const info = normalizePdfUrl(rawUrl);

  // 1. Try direct browser fetch first for non-Drive URLs (zero server overhead when CORS permits)
  if (!info.isGoogleDrive) {
    try {
      const directRes = await fetch(info.downloadUrl, { mode: 'cors' });
      if (directRes.ok) {
        const directBlob = await directRes.blob();
        if (await blobStartsWithPdfSignature(directBlob)) {
          const pdfBlob =
            directBlob.type === 'application/pdf'
              ? directBlob
              : new Blob([directBlob], { type: 'application/pdf' });
          const title = derivePdfTitleFromUrl(info.downloadUrl);
          const file = new File([pdfBlob], `${title}.pdf`, { type: 'application/pdf' });
          return {
            ...info,
            file,
            blob: pdfBlob,
            title,
            viaProxy: false,
          };
        }
      }
    } catch {
      // Blocked by CORS or network restriction — fall back cleanly to /api/fetch-pdf proxy
    }
  }

  // 2. Server-side CORS proxy fallback (`/api/fetch-pdf`)
  let proxyRes;
  try {
    proxyRes = await fetch(info.proxyUrl, { method: 'GET' });
  } catch {
    throw new Error(
      'Network error reaching /api/fetch-pdf proxy. Ensure the server is running.'
    );
  }

  if (!proxyRes.ok) {
    let errData = null;
    try {
      errData = await proxyRes.json();
    } catch {
      // non-JSON response
    }
    const err = new Error(
      errData?.error || `Failed to fetch remote PDF (HTTP ${proxyRes.status}).`
    );
    if (errData?.code) err.code = errData.code;
    err.status = proxyRes.status;
    throw err;
  }

  const proxyBlob = await proxyRes.blob();
  if (!(await blobStartsWithPdfSignature(proxyBlob))) {
    const err = new Error(
      'The URL did not return a valid PDF document. Make sure it points to a public .pdf file.'
    );
    err.code = 'NOT_A_PDF';
    throw err;
  }

  const headerFilename = proxyRes.headers.get('x-pdf-filename');
  let title = '';
  if (headerFilename) {
    try {
      title = decodeURIComponent(headerFilename).replace(/\.pdf$/i, '').trim();
    } catch {
      title = headerFilename.replace(/\.pdf$/i, '').trim();
    }
  }
  if (!title || title.toLowerCase() === 'document') {
    title = derivePdfTitleFromUrl(info.originalUrl, 'Imported PDF');
  }

  const pdfBlob =
    proxyBlob.type === 'application/pdf'
      ? proxyBlob
      : new Blob([proxyBlob], { type: 'application/pdf' });
  const file = new File([pdfBlob], `${title}.pdf`, { type: 'application/pdf' });

  return {
    ...info,
    file,
    blob: pdfBlob,
    title,
    viaProxy: true,
  };
}

export async function importGoogleDoc(url, { sanitizeKatex = true } = {}) {
  let response;
  try {
    response = await fetch(GDOC_IMPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: String(url || '').trim() }),
    });
  } catch {
    throw new Error('Network error reaching /api/import-gdoc. Ensure the server is running.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const err = new Error(
      data?.error || `Failed to import Google Doc (HTTP ${response.status}).`
    );
    if (data?.code) err.code = data.code;
    err.status = response.status;
    throw err;
  }

  const rawMarkdown = data?.markdown || '';
  return {
    title: data?.title || 'Imported Google Doc',
    markdown: sanitizeKatex ? sanitizeImportedMarkdown(rawMarkdown) : rawMarkdown,
    format: data?.format || 'md',
  };
}

export async function convertDocxFileToMarkdown(file, { sanitizeKatex = true } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Preserve simple HTML tables as GFM tables
  turndown.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows.map((row) =>
        Array.from(row.querySelectorAll('th, td')).map((cell) =>
          (cell.textContent || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
        )
      );
      const colCount = Math.max(...matrix.map((r) => r.length), 1);
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

  const baseName = file.name.replace(/\.docx$/i, '').trim() || 'Imported Word Document';
  const markdown = turndown.turndown(html || '').replace(/\n{3,}/g, '\n\n').trim();
  const rawContent = markdown.startsWith('#') ? markdown : `# ${baseName}\n\n${markdown}`;
  const content = sanitizeKatex ? sanitizeImportedMarkdown(rawContent) : rawContent;

  return {
    title: baseName,
    content,
  };
}

function readFileAsRawBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read PDF file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Zero-token local PDF text extraction via pdfjs-dist + optional KaTeX sanitizer.
 */
export async function extractPdfTextLocally(file, { sanitizeKatex = true } = {}) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdfDoc = await loadingTask.promise;

  const pageBlocks = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lines = [];
    let currentLine = '';
    let lastY = null;

    for (const item of textContent.items) {
      if (typeof item.str !== 'string') continue;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      const yChanged = lastY !== null && y !== null && Math.abs(y - lastY) > 4;

      if (yChanged && currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = '';
      }

      currentLine += item.str;
      if (item.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      } else if (item.str && !item.str.endsWith(' ')) {
        currentLine += ' ';
      }

      if (y !== null) lastY = y;
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    const pageText = lines.join('\n').trim();
    if (pageText) {
      pageBlocks.push(pdfDoc.numPages > 1 ? `## Page ${pageNum}\n\n${pageText}` : pageText);
    }
  }

  const baseName = file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF';
  const rawCombined = `# ${baseName}\n\n${pageBlocks.join('\n\n')}`;
  const content = sanitizeKatex ? sanitizeImportedMarkdown(rawCombined) : rawCombined;

  return {
    title: baseName,
    content,
    method: 'local',
  };
}

/**
 * Unified PDF importer:
 *  - <= 4MB: sends to `/api/gemini` (`action: "pdf"`) for high-accuracy Markdown + KaTeX
 *  - > 4MB (or if serverless returns 413 / forceLocal): falls back to zero-token local `pdfjs-dist` extraction
 */
export async function importPdfFile(
  file,
  { language = 'en', onProgress, sanitizeKatex = true, forceLocal = false } = {}
) {
  if (!forceLocal && file.size <= PDF_GEMINI_MAX_BYTES) {
    onProgress?.('ai');
    try {
      const base64Data = await readFileAsRawBase64(file);
      const { markdown, suggestedTitle } = await convertPdfWithGemini({
        base64Data,
        fileName: file.name,
        language,
      });
      const content = sanitizeKatex ? sanitizeImportedMarkdown(markdown) : markdown;
      return {
        title: suggestedTitle || file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF',
        content,
        method: 'gemini',
      };
    } catch (err) {
      // If payload hits serverless 413 limit or AI proxy is unavailable, transparently fall back to local pdfjs-dist
      if (err?.status === 413) {
        onProgress?.('local');
        return extractPdfTextLocally(file, { sanitizeKatex });
      }
      throw err;
    }
  }

  onProgress?.('local');
  return extractPdfTextLocally(file, { sanitizeKatex });
}

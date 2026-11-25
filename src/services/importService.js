import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { sanitizeImportedMarkdown } from '../utils/katexSanitizer';
import { formatImportedText } from '../utils/formatImportedText';
import {
  loadPdfDocument,
  renderPdfPageToCompressedImage,
  stripDataUrlPrefix,
} from '../utils/documentProcessor';
import { convertPdfWithGemini, ocrPdfPageBatch, scanA4Document } from './geminiService';

export { formatImportedText };

/**
 * Client-Side Document Import Service
 *  1. importGoogleDoc(url, opts)            — Calls server-side `/api/import-gdoc`
 *  2. convertDocxFileToMarkdown(file, opts) — Converts `.docx` -> HTML (mammoth) -> Markdown (turndown)
 *  3. importPdfFile(file, opts)             — PDF <= 4MB via `/api/gemini` (action: "pdf") with
 *                                             automatic `pdfjs-dist` + Vision OCR fallback;
 *                                             PDF > 4MB via `pdfjs-dist` across all pages + automatic
 *                                             Gemini Vision OCR batch fallback for scanned/image-only PDFs
 *  4. normalizePdfUrl(url) & fetchPdfFileFromUrl(url) — Direct `.pdf` & Google Drive PDF URL importer
 *                                             with automatic `/api/fetch-pdf` CORS proxy fallback
 *  5. fixUtf8FilenameMojibake(str)          — Recovers UTF-8 Vietnamese filenames from RFC 5987 & Latin-1 mojibake
 */

const GDOC_IMPORT_ENDPOINT = '/api/import-gdoc';
const PDF_PROXY_ENDPOINT = '/api/fetch-pdf';
export const PDF_GEMINI_MAX_BYTES = 4 * 1024 * 1024; // 4 MB
const MIN_MEANINGFUL_TEXT_CHARS = 100;
const MIN_AVG_CHARS_PER_PAGE = 25;
const OCR_BATCH_SIZE = 3;
const MAX_OCR_SCANNED_PAGES = 45;

const DRIVE_FILE_D_REGEX =
  /^https?:\/\/drive\.google\.com\/file\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,120})(?:\/|$|\?|#)/i;
const DRIVE_OPEN_OR_UC_REGEX =
  /^https?:\/\/drive\.google\.com\/(?:open|uc)\?.*?(?:^|[?&])id=([a-zA-Z0-9_-]{10,120})(?:&|$|#)/i;

/**
 * Decode RFC 5987 / percent-encoded / Latin-1 UTF-8 mojibake strings (e.g. "Tuyá»ƒn táº­p")
 * cleanly back into normalized NFC UTF-8 Vietnamese text.
 */
export function fixUtf8FilenameMojibake(raw) {
  let str = String(raw || '').trim();
  if (!str) return '';

  // Decode percent-encoded UTF-8 sequences if present
  if (/%[0-9a-f]{2}/i.test(str)) {
    try {
      str = decodeURIComponent(str);
    } catch {
      // Keep original if percent encoding is incomplete
    }
  }

  // Detect UTF-8 bytes interpreted as Latin-1 (all char codes <= 0xFF with bytes in 0x80..0xFF)
  const hasHighLatin1 = /[\u0080-\u00FF]/.test(str);
  const hasNonLatin1 = /[^\u0000-\u00FF]/.test(str);
  if (hasHighLatin1 && !hasNonLatin1) {
    try {
      const bytes = new Uint8Array([...str].map((ch) => ch.charCodeAt(0) & 0xff));
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (decoded && decoded !== str) {
        str = decoded;
      }
    } catch {
      // Not valid UTF-8 byte sequence — leave original intact
    }
  }

  return str.normalize('NFC');
}

/**
 * Extract a clean UTF-8 filename from an HTTP Content-Disposition header,
 * prioritizing RFC 5987 `filename*=UTF-8''...` and recovering Latin-1 mojibake from `filename="..."`.
 */
export function parseContentDispositionFilename(disposition) {
  if (!disposition) return '';

  const rfc5987Match = disposition.match(
    /filename\*\s*=\s*"?(?:utf-?8)'[^']*'([^";\r\n]+)"?/i
  );
  if (rfc5987Match?.[1]) {
    try {
      const decoded = decodeURIComponent(rfc5987Match[1].trim())
        .replace(/["\r\n]/g, '')
        .trim();
      if (decoded) return fixUtf8FilenameMojibake(decoded);
    } catch {
      // fall through
    }
  }

  const quotedMatch = disposition.match(/filename\s*=\s*"([^"\r\n]+)"/i);
  const unquotedMatch = disposition.match(/filename\s*=\s*([^;\r\n]+)/i);
  const rawName = (quotedMatch?.[1] || unquotedMatch?.[1] || '').replace(/["\r\n]/g, '').trim();
  return rawName ? fixUtf8FilenameMojibake(rawName) : '';
}

export function cleanPdfTitle(rawName, fallback = 'Imported PDF') {
  const fixed = fixUtf8FilenameMojibake(rawName)
    .replace(/\.pdf$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return fixed || fallback;
}

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
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decoded = fixUtf8FilenameMojibake(lastSegment);
    const cleaned = decoded.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
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
          const dispName = parseContentDispositionFilename(
            directRes.headers.get('content-disposition')
          );
          const title = cleanPdfTitle(
            dispName || derivePdfTitleFromUrl(info.downloadUrl),
            'Imported PDF'
          );
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
  const dispFilename = parseContentDispositionFilename(
    proxyRes.headers.get('content-disposition')
  );
  let title = '';
  if (headerFilename) {
    title = cleanPdfTitle(headerFilename, '');
  }
  if (!title && dispFilename) {
    title = cleanPdfTitle(dispFilename, '');
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
  const sanitized = sanitizeKatex ? sanitizeImportedMarkdown(rawMarkdown) : rawMarkdown;
  const markdown = formatImportedText(sanitized);
  return {
    title: fixUtf8FilenameMojibake(data?.title || '') || 'Imported Google Doc',
    markdown,
    format: data?.format || 'html',
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

function measureMeaningfulMarkdownLength(markdown, title = '') {
  let body = String(markdown || '');
  if (title) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    body = body.replace(new RegExp(`^#\\s+${escaped}\\s*$`, 'im'), '');
  }
  body = body
    .replace(/^##\s+(?:Page|Trang)\s+\d+\s*$/gim, '')
    .replace(/[\s#*_`>-]+/g, '');
  return body.length;
}

/**
 * Render a single pdfjs-dist page to a crisp JPEG base64 string via documentProcessor
 * (`scale: 2.0`, max `1500px`, `#FFFFFF` background, JPEG `quality: 0.8`).
 */
async function renderPdfPageToJpegBase64(pdfDoc, pageNum) {
  const rendered = await renderPdfPageToCompressedImage(pdfDoc, pageNum);
  return rendered.base64;
}

/**
 * Send client-prepared (compressed / cropped) page images to Gemini Vision OCR in batches.
 * Preserves live progress notifications and handles 413 single-page fallback automatically.
 */
export async function ocrPreparedImages(
  preparedImages,
  { baseName = '', language = 'en', onProgress, sanitizeKatex = true } = {}
) {
  const validImages = (Array.isArray(preparedImages) ? preparedImages : [])
    .map((img, idx) => ({
      pageNumber: img?.pageNumber || idx + 1,
      mimeType: img?.mimeType || 'image/jpeg',
      data: stripDataUrlPrefix(img?.base64 || img?.data || img?.dataUrl || ''),
    }))
    .filter((img) => img.data.length > 0);

  if (validImages.length === 0) {
    const err = new Error(
      language === 'vi'
        ? 'Không có trang ảnh hợp lệ để quét OCR.'
        : 'No valid page images available for OCR scanning.'
    );
    err.code = 'EMPTY_PDF_CONTENT';
    throw err;
  }

  const total = validImages.length;

  // Fast path for a single uploaded image (or single cropped region)
  if (total === 1) {
    onProgress?.({
      stage: 'ocr',
      currentPage: 1,
      endPage: 1,
      totalPages: 1,
    });
    const single = validImages[0];
    const { markdown, suggestedTitle } = await scanA4Document({
      base64Data: single.data,
      mimeType: single.mimeType,
      language,
    });
    const combined = (markdown || '').trim();
    if (!combined) {
      const err = new Error(
        language === 'vi'
          ? 'Không thể trích xuất nội dung từ hình ảnh này.'
          : 'Could not extract readable content from this image.'
      );
      err.code = 'EMPTY_PDF_CONTENT';
      throw err;
    }
    return {
      title: cleanPdfTitle(
        baseName || suggestedTitle,
        suggestedTitle || (language === 'vi' ? 'Tài liệu đã quét' : 'Scanned Document')
      ),
      content: sanitizeKatex ? sanitizeImportedMarkdown(combined) : combined,
      method: 'ocr-fallback',
    };
  }

  const transcribedChunks = [];
  let suggestedTitleFromOcr = '';

  for (let startIdx = 0; startIdx < total; startIdx += OCR_BATCH_SIZE) {
    const batch = validImages.slice(startIdx, startIdx + OCR_BATCH_SIZE);
    const currentPos = startIdx + 1;
    const endPos = Math.min(total, startIdx + batch.length);

    onProgress?.({
      stage: 'ocr',
      currentPage: currentPos,
      endPage: endPos,
      totalPages: total,
    });

    try {
      const { markdown, suggestedTitle } = await ocrPdfPageBatch({
        images: batch,
        language,
      });
      if (!suggestedTitleFromOcr && suggestedTitle) {
        suggestedTitleFromOcr = suggestedTitle;
      }
      if (markdown && markdown.trim()) {
        transcribedChunks.push(markdown.trim());
      }
    } catch (batchErr) {
      if (batch.length > 1 && batchErr?.status === 413) {
        for (let j = 0; j < batch.length; j++) {
          const singleImg = batch[j];
          const pos = startIdx + j + 1;
          onProgress?.({
            stage: 'ocr',
            currentPage: pos,
            endPage: pos,
            totalPages: total,
          });
          const { markdown, suggestedTitle } = await ocrPdfPageBatch({
            images: [singleImg],
            language,
          });
          if (!suggestedTitleFromOcr && suggestedTitle) {
            suggestedTitleFromOcr = suggestedTitle;
          }
          if (markdown && markdown.trim()) {
            transcribedChunks.push(markdown.trim());
          }
        }
      } else {
        throw batchErr;
      }
    }
  }

  const combined = transcribedChunks.join('\n\n').trim();
  if (!combined || measureMeaningfulMarkdownLength(combined, baseName) < 10) {
    const err = new Error(
      language === 'vi'
        ? 'Không thể trích xuất nội dung từ các trang đã chọn.'
        : 'Could not extract readable content from the selected pages.'
    );
    err.code = 'EMPTY_PDF_CONTENT';
    throw err;
  }

  return {
    title: cleanPdfTitle(baseName, suggestedTitleFromOcr || 'Imported PDF'),
    content: sanitizeKatex ? sanitizeImportedMarkdown(combined) : combined,
    method: 'ocr-fallback',
  };
}

/**
 * Fallback for scanned / image-only PDFs:
 * Renders PDF pages to JPEG images and sends them in batches of 3 to `/api/gemini` (`action: 'ocr'`).
 */
async function ocrScannedPdfPages(pdfDoc, { baseName, language = 'en', onProgress, sanitizeKatex = true }) {
  const totalPages = pdfDoc.numPages;
  const pagesToProcess = Math.min(totalPages, MAX_OCR_SCANNED_PAGES);
  const transcribedChunks = [];
  let suggestedTitleFromOcr = '';

  for (let startPage = 1; startPage <= pagesToProcess; startPage += OCR_BATCH_SIZE) {
    const endPage = Math.min(pagesToProcess, startPage + OCR_BATCH_SIZE - 1);
    onProgress?.({
      stage: 'ocr',
      currentPage: startPage,
      endPage,
      totalPages: pagesToProcess,
    });

    const batchImages = [];
    for (let p = startPage; p <= endPage; p++) {
      const data = await renderPdfPageToJpegBase64(pdfDoc, p);
      batchImages.push({
        pageNumber: p,
        mimeType: 'image/jpeg',
        data,
      });
    }

    try {
      const { markdown, suggestedTitle } = await ocrPdfPageBatch({
        images: batchImages,
        language,
      });
      if (!suggestedTitleFromOcr && suggestedTitle) {
        suggestedTitleFromOcr = suggestedTitle;
      }
      if (markdown && markdown.trim()) {
        transcribedChunks.push(markdown.trim());
      }
    } catch (batchErr) {
      // If a multi-page batch exceeds payload size (413), retry page-by-page
      if (batchImages.length > 1 && batchErr?.status === 413) {
        for (const singleImg of batchImages) {
          onProgress?.({
            stage: 'ocr',
            currentPage: singleImg.pageNumber,
            endPage: singleImg.pageNumber,
            totalPages: pagesToProcess,
          });
          const { markdown, suggestedTitle } = await ocrPdfPageBatch({
            images: [singleImg],
            language,
          });
          if (!suggestedTitleFromOcr && suggestedTitle) {
            suggestedTitleFromOcr = suggestedTitle;
          }
          if (markdown && markdown.trim()) {
            transcribedChunks.push(markdown.trim());
          }
        }
      } else {
        throw batchErr;
      }
    }
  }

  let combined = transcribedChunks.join('\n\n').trim();
  if (!combined || measureMeaningfulMarkdownLength(combined, baseName) < 20) {
    const err = new Error(
      language === 'vi'
        ? 'Không thể trích xuất nội dung từ tệp PDF này (tệp có thể trống hoặc bị khóa).'
        : 'Could not extract any readable content from this PDF (it may be blank or protected).'
    );
    err.code = 'EMPTY_PDF_CONTENT';
    throw err;
  }

  if (totalPages > MAX_OCR_SCANNED_PAGES) {
    const truncationNote =
      language === 'vi'
        ? `\n\n---\n> *Lưu ý: Tệp PDF quét có ${totalPages} trang; đã trích xuất ${MAX_OCR_SCANNED_PAGES} trang đầu bằng OCR.*`
        : `\n\n---\n> *Note: This scanned PDF has ${totalPages} pages; the first ${MAX_OCR_SCANNED_PAGES} pages were transcribed via OCR.*`;
    combined += truncationNote;
  }

  const content = sanitizeKatex ? sanitizeImportedMarkdown(combined) : combined;
  return {
    title: cleanPdfTitle(baseName, suggestedTitleFromOcr || 'Imported PDF'),
    content,
    method: 'ocr-fallback',
  };
}

/**
 * Full-document PDF text extraction via pdfjs-dist across all pages, preserving headings,
 * line breaks, and paragraphs — with automatic Gemini Vision OCR fallback when a PDF is
 * scanned / image-only / yields < 100 meaningful characters.
 */
export async function extractPdfTextLocally(
  file,
  { sanitizeKatex = true, onProgress, language = 'en', allowOcrFallback = true } = {}
) {
  const { pdfDoc, numPages: totalPages } = await loadPdfDocument(file);
  const pageBlocks = [];
  let totalMeaningfulChars = 0;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.({
      stage: 'local',
      currentPage: pageNum,
      totalPages,
    });

    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Estimate median body font height on this page for heading detection
    const heights = textContent.items
      .map((item) =>
        Math.abs(
          Number(item.height) || (Array.isArray(item.transform) ? item.transform[0] : 0) || 0
        )
      )
      .filter((h) => h > 2)
      .sort((a, b) => a - b);
    const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 11;

    const lines = [];
    let currentLine = '';
    let currentLineMaxHeight = 0;
    let lastY = null;

    const flushLine = (addParagraphBreak = false) => {
      const trimmed = currentLine.replace(/\s+/g, ' ').trim();
      if (trimmed) {
        const isHeading =
          currentLineMaxHeight >= medianHeight * 1.28 &&
          trimmed.length <= 120 &&
          !/^[•\-*]\s/.test(trimmed);
        lines.push(isHeading ? `### ${trimmed}` : trimmed);
        if (addParagraphBreak) lines.push('');
      }
      currentLine = '';
      currentLineMaxHeight = 0;
    };

    for (const item of textContent.items) {
      if (typeof item.str !== 'string') continue;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      const itemHeight = Math.abs(
        Number(item.height) || (Array.isArray(item.transform) ? item.transform[0] : 0) || medianHeight
      );
      const yDelta = lastY !== null && y !== null ? Math.abs(y - lastY) : 0;

      if (lastY !== null && y !== null && yDelta > Math.max(4, medianHeight * 0.45)) {
        const isParagraphGap = yDelta > Math.max(16, medianHeight * 1.65);
        flushLine(isParagraphGap);
      }

      currentLine += item.str;
      if (itemHeight > currentLineMaxHeight) currentLineMaxHeight = itemHeight;

      if (item.hasEOL) {
        flushLine(false);
      } else if (item.str && !item.str.endsWith(' ')) {
        currentLine += ' ';
      }

      if (y !== null) lastY = y;
    }
    flushLine(false);

    const pageText = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (pageText) {
      totalMeaningfulChars += pageText.replace(/\s+/g, '').length;
      pageBlocks.push(totalPages > 1 ? `## Page ${pageNum}\n\n${pageText}` : pageText);
    }
  }

  const baseName = cleanPdfTitle(file.name, 'Imported PDF');
  const isLikelyScannedOrEmpty =
    totalMeaningfulChars < MIN_MEANINGFUL_TEXT_CHARS ||
    (totalPages >= 3 && totalMeaningfulChars / totalPages < MIN_AVG_CHARS_PER_PAGE);

  if (isLikelyScannedOrEmpty) {
    if (allowOcrFallback) {
      return ocrScannedPdfPages(pdfDoc, {
        baseName,
        language,
        onProgress,
        sanitizeKatex,
      });
    }
    const err = new Error(
      language === 'vi'
        ? 'Tệp PDF này là bản scan/ảnh không có lớp chữ. Không thể trích xuất văn bản.'
        : 'This PDF appears to be scanned/image-only with no selectable text layer.'
    );
    err.code = 'EMPTY_PDF_CONTENT';
    throw err;
  }

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
 *  - <= 4MB: sends to `/api/gemini` (`action: "pdf"`) for high-accuracy Markdown + KaTeX,
 *    with automatic fallback to `pdfjs-dist` + Vision OCR if response is empty or 413.
 *  - > 4MB (or forceLocal): extracts text across all pages via `pdfjs-dist` with live
 *    page progress, and automatically triggers batched Gemini Vision OCR for scanned/image-only PDFs.
 *  - Never returns an empty body with only `# Title`.
 */
export async function importPdfFile(
  file,
  { language = 'en', onProgress, sanitizeKatex = true, forceLocal = false } = {}
) {
  const cleanName = cleanPdfTitle(file.name, 'Imported PDF');

  if (!forceLocal && file.size <= PDF_GEMINI_MAX_BYTES) {
    onProgress?.({ stage: 'ai' });
    try {
      const base64Data = await readFileAsRawBase64(file);
      const { markdown, suggestedTitle } = await convertPdfWithGemini({
        base64Data,
        fileName: `${cleanName}.pdf`,
        language,
      });
      const content = sanitizeKatex ? sanitizeImportedMarkdown(markdown) : markdown;
      if (measureMeaningfulMarkdownLength(content, cleanName) >= 30) {
        return {
          title: cleanPdfTitle(suggestedTitle || cleanName, 'Imported PDF'),
          content,
          method: 'gemini',
        };
      }
      // If Gemini returned empty/near-empty output, fall through to pdfjs-dist + OCR pipeline
    } catch (err) {
      // On 413 or transient error, fall back to local pdfjs-dist + Vision OCR batch pipeline
      if (err?.code === 'MISSING_API_KEY') {
        // Still try local text extraction first (works zero-token for text-layer PDFs!)
        return extractPdfTextLocally(file, {
          sanitizeKatex,
          onProgress,
          language,
          allowOcrFallback: false,
        });
      }
      if (err?.status !== 413 && err?.status !== 502 && err?.status !== 504) {
        // Try local text extraction as resilient fallback before giving up
        try {
          return await extractPdfTextLocally(file, {
            sanitizeKatex,
            onProgress,
            language,
            allowOcrFallback: false,
          });
        } catch {
          throw err;
        }
      }
    }
  }

  return extractPdfTextLocally(file, {
    sanitizeKatex,
    onProgress,
    language,
    allowOcrFallback: true,
  });
}

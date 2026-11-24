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
 */

const GDOC_IMPORT_ENDPOINT = '/api/import-gdoc';
export const PDF_GEMINI_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

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
 * Zero-token local PDF text extraction via pdfjs-dist + KaTeX sanitizer.
 */
export async function extractPdfTextLocally(file) {
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
  const content = sanitizeImportedMarkdown(rawCombined);

  return {
    title: baseName,
    content,
    method: 'local',
  };
}

/**
 * Unified PDF importer:
 *  - <= 4MB: sends to `/api/gemini` (`action: "pdf"`) for high-accuracy Markdown + KaTeX
 *  - > 4MB (or if serverless returns 413): falls back to zero-token local `pdfjs-dist` extraction
 */
export async function importPdfFile(file, { language = 'en', onProgress } = {}) {
  if (file.size <= PDF_GEMINI_MAX_BYTES) {
    onProgress?.('ai');
    try {
      const base64Data = await readFileAsRawBase64(file);
      const { markdown, suggestedTitle } = await convertPdfWithGemini({
        base64Data,
        fileName: file.name,
        language,
      });
      const content = sanitizeImportedMarkdown(markdown);
      return {
        title: suggestedTitle || file.name.replace(/\.pdf$/i, '').trim() || 'Imported PDF',
        content,
        method: 'gemini',
      };
    } catch (err) {
      // If payload hits serverless 413 limit (base64 expansion), transparently fall back to local pdfjs-dist
      if (err?.status === 413) {
        onProgress?.('local');
        return extractPdfTextLocally(file);
      }
      throw err;
    }
  }

  onProgress?.('local');
  return extractPdfTextLocally(file);
}

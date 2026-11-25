/**
 * Frontend Gemini AI Client Service
 *
 * Strictly communicates with the server-side Vercel Serverless Function (`/api/gemini`).
 * No `@google/genai` SDK or API keys are ever loaded or bundled on the client.
 *
 * Capabilities:
 *  1. scanA4Document              — POST /api/gemini { action: 'ocr', imageData, mimeType }
 *  2. extractFlashcardsFromDocument — POST /api/gemini { action: 'flashcards', text, title }
 *  3. generateDocumentQuiz        — POST /api/gemini { action: 'quiz', text, questionCount }
 */

import { compressImageFile } from '../utils/documentProcessor';

const API_ENDPOINT = '/api/gemini';

async function postGeminiAction(payload) {
  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Network error reaching /api/gemini. Ensure the server is running.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response (e.g., local Vite dev server without serverless runtime)
  }

  if (!response.ok) {
    const err = new Error(
      data?.error || `AI service returned HTTP ${response.status}`
    );
    if (data?.code) err.code = data.code;
    err.status = response.status;
    throw err;
  }

  return data;
}

/**
 * Optional lightweight status check against `/api/gemini` (GET).
 */
export async function checkGeminiProxyStatus() {
  try {
    const res = await fetch(API_ENDPOINT, { method: 'GET' });
    if (!res.ok) return { reachable: false, configured: false };
    const data = await res.json();
    return {
      reachable: true,
      configured: Boolean(data?.configured),
      rateLimitPerHour: data?.rateLimitPerHour || 30,
    };
  } catch {
    return { reachable: false, configured: false };
  }
}

/**
 * Convert an image File/Blob to a standardized compressed JPEG Base64 string + mimeType.
 * Uses `documentProcessor.compressImageFile` (max 1500px longest side, `#FFFFFF` background,
 * JPEG quality 0.8) so payloads stay well under Vercel's 4.5MB body limit while keeping
 * A4 text and math/chemistry equations crisp.
 */
export async function fileToBase64(file) {
  if (file?.type?.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file?.name || '')) {
    try {
      const compressed = await compressImageFile(file);
      return {
        data: compressed.base64,
        mimeType: compressed.mimeType,
        dataUrl: compressed.dataUrl,
        width: compressed.width,
        height: compressed.height,
        byteSize: compressed.byteSize,
      };
    } catch {
      // Fall back to raw FileReader below if canvas decoding fails
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        data: base64,
        mimeType: file.type || 'image/jpeg',
      });
    };
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

/**
 * 1. A4 Document OCR Scanner -> Structured Markdown + KaTeX
 */
export async function scanA4Document({ base64Data, mimeType, language = 'en' }) {
  const data = await postGeminiAction({
    action: 'ocr',
    imageData: base64Data,
    mimeType: mimeType || 'image/jpeg',
    language,
  });

  return {
    markdown: data?.markdown || '',
    suggestedTitle:
      data?.suggestedTitle ||
      (language === 'vi' ? 'Tài liệu A4 đã quét' : 'Scanned A4 Document'),
  };
}

/**
 * 1a. Batched Scanned PDF Page OCR -> Structured Markdown + KaTeX
 * Sends 1-3 rendered JPEG page images per call to `/api/gemini` (`action: 'ocr'`).
 */
export async function ocrPdfPageBatch({ images, language = 'en' }) {
  const data = await postGeminiAction({
    action: 'ocr',
    images,
    language,
  });

  return {
    markdown: data?.markdown || '',
    suggestedTitle: data?.suggestedTitle || '',
  };
}

/**
 * 1b. PDF Document to Markdown + KaTeX (for PDFs <= 4MB via Gemini inlineData)
 */
export async function convertPdfWithGemini({ base64Data, fileName = '', language = 'en' }) {
  const data = await postGeminiAction({
    action: 'pdf',
    pdfData: base64Data,
    fileName,
    language,
  });

  return {
    markdown: data?.markdown || '',
    suggestedTitle:
      data?.suggestedTitle ||
      fileName.replace(/\.pdf$/i, '').trim() ||
      (language === 'vi' ? 'Tài liệu PDF' : 'Imported PDF'),
  };
}

/**
 * 2. AI Flashcard Extraction from Selected Document
 */
export async function extractFlashcardsFromDocument({ document, count = 6, language = 'en' }) {
  const data = await postGeminiAction({
    action: 'flashcards',
    title: document?.title || 'Study Document',
    text: document?.content || '',
    count,
    language,
  });

  return Array.isArray(data?.cards) ? data.cards : [];
}

/**
 * 3. Strict Source-Grounded Document Quiz Generator
 */
export async function generateDocumentQuiz({
  documents,
  questionCount = 5,
  language = 'en',
}) {
  const combinedCorpus = documents
    .map(
      (doc, idx) =>
        `=== SOURCE DOCUMENT ${idx + 1}: "${doc.title}" ===\n${doc.content}\n=== END DOCUMENT ${idx + 1} ===`
    )
    .join('\n\n');

  const fallbackTitle = documents.map((d) => d.title).join(' + ').slice(0, 60);

  const data = await postGeminiAction({
    action: 'quiz',
    title: fallbackTitle,
    text: combinedCorpus,
    questionCount,
    language,
  });

  return {
    title: data?.title || fallbackTitle,
    questions: Array.isArray(data?.questions) ? data.questions : [],
  };
}

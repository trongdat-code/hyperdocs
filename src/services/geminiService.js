import { GoogleGenAI, Type } from '@google/genai';

/**
 * Modular Gemini AI Service using the official @google/genai SDK
 * via `ai.models.generateContent` with standard `inlineData` multimodal parts,
 * structured JSON response schemas, and automatic 503/429 retry + model fallback.
 *
 * Primary model: `gemini-4-hydrogen` (override via VITE_GEMINI_MODEL)
 * Secondary fallback models: `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`
 * (override via comma-separated VITE_GEMINI_FALLBACK_MODELS)
 *
 * Capabilities:
 *  1. scanA4Document      — Multimodal A4 OCR -> clean Markdown + KaTeX
 *  2. extractFlashcards   — Extract structured SRS flashcards from selected document
 *  3. generateDocumentQuiz — Strict source-grounded MCQ quiz (NO external facts)
 */

const PRIMARY_MODEL = (import.meta.env.VITE_GEMINI_MODEL || 'gemini-4-hydrogen').trim();
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const RETRY_DELAY_MS = 2000;

function getModelChain() {
  const customFallbacks = (import.meta.env.VITE_GEMINI_FALLBACK_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const fallbacks = customFallbacks.length > 0 ? customFallbacks : DEFAULT_FALLBACK_MODELS;
  return Array.from(new Set([PRIMARY_MODEL, ...fallbacks]));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatusCode(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.code,
    error?.error?.code,
    error?.cause?.status,
  ];
  for (const val of candidates) {
    const num = Number(val);
    if (Number.isFinite(num) && num >= 100 && num < 600) return num;
  }
  const msg = String(error?.message || '');
  const match = msg.match(/\b(429|503|500|502|504|404)\b/);
  return match ? Number(match[1]) : null;
}

function isHighDemandOrRateLimitError(error) {
  const code = getErrorStatusCode(error);
  if (code === 503 || code === 429) return true;
  const statusText = String(error?.error?.status || error?.status || '').toUpperCase();
  if (statusText === 'UNAVAILABLE' || statusText === 'RESOURCE_EXHAUSTED') return true;
  const msg = String(error?.message || '');
  return /high demand|overloaded|unavailable|resource_exhausted|rate limit|too many requests|quota/i.test(
    msg
  );
}

function isModelUnavailableError(error) {
  const code = getErrorStatusCode(error);
  if (code === 404) return true;
  const statusText = String(error?.error?.status || '').toUpperCase();
  return statusText === 'NOT_FOUND' || /model.*not found|not supported for generateContent/i.test(String(error?.message || ''));
}

/**
 * Wraps `ai.models.generateContent` with automatic retry + fallback:
 *  - If the primary model throws 503 (high demand) or 429 (rate limit),
 *    retries the primary model once after 2 seconds.
 *  - If it still fails (or is unavailable), automatically falls back through
 *    secondary Gemini Flash-Lite models in order.
 */
async function generateContentWithRetryAndFallback(ai, requestParams) {
  const models = getModelChain();
  let lastError = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const isPrimary = i === 0;

    try {
      return await ai.models.generateContent({
        ...requestParams,
        model,
      });
    } catch (err) {
      lastError = err;

      if (isPrimary && isHighDemandOrRateLimitError(err)) {
        console.warn(
          `[GeminiService] Primary model "${model}" returned 503/429. Retrying once in ${RETRY_DELAY_MS}ms...`
        );
        await sleep(RETRY_DELAY_MS);

        try {
          return await ai.models.generateContent({
            ...requestParams,
            model,
          });
        } catch (retryErr) {
          lastError = retryErr;
          if (!isHighDemandOrRateLimitError(retryErr) && !isModelUnavailableError(retryErr)) {
            throw retryErr;
          }
          console.warn(
            `[GeminiService] Primary model "${model}" retry failed. Falling back to secondary Flash models...`
          );
          continue;
        }
      }

      if (isHighDemandOrRateLimitError(err) || isModelUnavailableError(err)) {
        console.warn(
          `[GeminiService] Model "${model}" unavailable (${getErrorStatusCode(err) || 'error'}). Trying next fallback...`
        );
        continue;
      }

      // Non-retryable error (e.g., 400 bad request, 401/403 invalid API key)
      throw err;
    }
  }

  throw lastError;
}

export function isGeminiConfigured() {
  return Boolean((import.meta.env.VITE_GEMINI_API_KEY || '').trim());
}

function getClient() {
  const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error('MISSING_API_KEY');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Helper to extract text safely from a GenerateContentResponse.
 */
function extractTextFromResponse(response) {
  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  const parts = response?.candidates?.[0]?.content?.parts || [];
  const joined = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return joined;
}

/**
 * Safely parse JSON text from model output, stripping accidental markdown fences.
 */
function parseJsonResponse(rawText) {
  const cleaned = (rawText || '')
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Convert a File/Blob to raw base64 string (without data URL prefix) + mimeType.
 */
export function fileToBase64(file) {
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
 * Uses standard `ai.models.generateContent` with `inlineData` base64 image payload.
 */
export async function scanA4Document({ base64Data, mimeType, language = 'en' }) {
  const ai = getClient();

  const langHint =
    language === 'vi'
      ? 'Preserve the original language of the document (Vietnamese or English).'
      : 'Preserve the original language of the document accurately.';

  const systemInstruction = `You are a precision academic OCR and scientific typesetting engine.
Your task is to transcribe photographed or scanned A4 study documents into clean, publication-grade Markdown with KaTeX-compatible LaTeX math and chemical equations.

Strict Formatting Rules:
1. Preserve document hierarchy using Markdown headings (#, ##, ###), bullet/numbered lists, bold key terms, and Markdown tables when present.
2. Convert ALL inline mathematical/physical/chemical symbols and formulas into inline LaTeX wrapped in single dollar signs: $...$ (e.g., $\\Delta G = \\Delta H - T\\Delta S$, $\\text{H}_2\\text{SO}_4$).
3. Convert ALL standalone or multi-line equations into display LaTeX wrapped in double dollar signs on their own lines:
$$
...
$$
4. Do NOT wrap the entire response in triple-backtick markdown code fences. Return raw Markdown directly.
5. Do NOT invent content that is not on the page. ${langHint}`;

  const response = await generateContentWithRetryAndFallback(ai, {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Transcribe this A4 page into clean Markdown with KaTeX math/chemical formulas. Provide a clear # Heading title at the top matching the document.',
          },
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Data,
            },
          },
        ],
      },
    ],
    config: {
      systemInstruction,
    },
  });

  let markdown = extractTextFromResponse(response);
  // Strip accidental wrapping fences if model adds them
  markdown = markdown.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();

  // Extract a suggested title from the first H1/H2 heading if present
  const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m);
  const suggestedTitle = headingMatch
    ? headingMatch[1].replace(/[*_`]/g, '').trim().slice(0, 80)
    : language === 'vi'
      ? 'Tài liệu A4 đã quét'
      : 'Scanned A4 Document';

  return { markdown, suggestedTitle };
}

/**
 * 2. AI Flashcard Extraction from Selected Document
 */
export async function extractFlashcardsFromDocument({ document, count = 6, language = 'en' }) {
  const ai = getClient();

  const flashcardSchema = {
    type: Type.OBJECT,
    properties: {
      cards: {
        type: Type.ARRAY,
        description: 'Key concept flashcards extracted strictly from the provided document.',
        items: {
          type: Type.OBJECT,
          properties: {
            front: {
              type: Type.STRING,
              description: 'Concise question or prompt (supports KaTeX $...$ math).',
            },
            back: {
              type: Type.STRING,
              description: 'Clear, accurate answer or formula (supports KaTeX $...$ and $$...$$).',
            },
          },
          required: ['front', 'back'],
        },
      },
    },
    required: ['cards'],
  };

  const outputLang =
    language === 'vi'
      ? 'Write the flashcards in Vietnamese (or match technical terms from the document).'
      : 'Write the flashcards in English (matching the document language where appropriate).';

  const response = await generateContentWithRetryAndFallback(ai, {
    contents: `Generate up to ${count} high-yield flashcards from this study document:\n\nTITLE: ${document.title}\n\nCONTENT:\n${document.content}`,
    config: {
      systemInstruction: `You are an expert study coach creating high-retention Spaced Repetition flashcards.
Extract ONLY key definitions, theorems, formulas, and concepts explicitly stated in the provided document.
Use valid KaTeX LaTeX ($...$ or $$...$$) for mathematical and chemical equations. ${outputLang}`,
      responseMimeType: 'application/json',
      responseSchema: flashcardSchema,
    },
  });

  const rawText = extractTextFromResponse(response);
  const parsed = parseJsonResponse(rawText);
  return Array.isArray(parsed?.cards) ? parsed.cards : [];
}

/**
 * 3. Strict Source-Grounded Document Quiz Generator
 * Explicitly forbids pulling external facts outside the provided document text.
 */
export async function generateDocumentQuiz({
  documents,
  questionCount = 5,
  language = 'en',
}) {
  const ai = getClient();

  const quizSchema = {
    type: Type.OBJECT,
    properties: {
      title: {
        type: Type.STRING,
        description: 'Short quiz title derived from the source documents.',
      },
      questions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: {
              type: Type.STRING,
              description: 'Multiple-choice question strictly grounded in the provided document text.',
            },
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Exactly 4 distinct answer choices (A, B, C, D).',
            },
            correctIndex: {
              type: Type.INTEGER,
              description: '0-based index (0 to 3) of the single correct option.',
            },
            explanation: {
              type: Type.STRING,
              description: 'Brief explanation citing only facts/formulas present in the source document.',
            },
          },
          required: ['question', 'options', 'correctIndex', 'explanation'],
        },
      },
    },
    required: ['title', 'questions'],
  };

  const combinedCorpus = documents
    .map(
      (doc, idx) =>
        `=== SOURCE DOCUMENT ${idx + 1}: "${doc.title}" ===\n${doc.content}\n=== END DOCUMENT ${idx + 1} ===`
    )
    .join('\n\n');

  const langRule =
    language === 'vi'
      ? 'Write all questions, options, and explanations in Vietnamese.'
      : 'Write all questions, options, and explanations in English.';

  const systemInstruction = `You are a strictly source-grounded academic quiz generator.

CRITICAL ANTI-HALLUCINATION & GROUNDING RULES:
1. You MUST generate questions, options, correct answers, and explanations EXCLUSIVELY from the provided source document text below.
2. NEVER pull external facts, outside theorems, historical dates, or background knowledge that are NOT explicitly present in the provided document text.
3. If the document is brief, create fewer or tightly focused questions rather than inventing outside information.
4. Every question must have exactly 4 choices, 1 unambiguous correct answer verified against the source text, and a concise explanation referencing the source text.
5. Use KaTeX syntax ($...$) for any mathematical or chemical formulas.
6. ${langRule}`;

  const response = await generateContentWithRetryAndFallback(ai, {
    contents: `Create a ${questionCount}-question multiple-choice quiz strictly from the following document(s):\n\n${combinedCorpus}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: quizSchema,
    },
  });

  const rawText = extractTextFromResponse(response);
  const parsed = parseJsonResponse(rawText);
  const questions = (parsed?.questions || [])
    .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      question: q.question,
      options: q.options.slice(0, 4),
      correctIndex: Math.min(Math.max(0, Number(q.correctIndex) || 0), q.options.slice(0, 4).length - 1),
      explanation: q.explanation || '',
    }));

  return {
    title: parsed?.title || documents.map((d) => d.title).join(' + ').slice(0, 60),
    questions,
  };
}

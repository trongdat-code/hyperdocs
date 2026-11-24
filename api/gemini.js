import { GoogleGenAI, Type } from '@google/genai';

/**
 * Vercel Serverless Function: Server-Side Gemini AI Proxy (`/api/gemini`)
 *
 * Security & Architecture:
 *  - Reads `process.env.GEMINI_API_KEY` strictly on the server (never exposed to browser bundle).
 *  - Supports POST actions: `ocr`, `flashcards`, `quiz` (and GET health/status check).
 *  - Model routing:
 *      - `ocr`: Primary `gemini-4-hydrogen` (high math/chemistry accuracy) with 503/429 retry
 *        after 2s and fallback to `gemini-3.5-flash-lite` -> `gemini-3.1-flash-lite`.
 *      - `flashcards` & `quiz`: Routed directly to `gemini-3.5-flash-lite` (low-cost fast tier)
 *        with 503/429 retry after 2s and fallback to `gemini-3.1-flash-lite` -> `gemini-4-hydrogen`.
 *  - IP-based rate limiting: max 30 requests per hour per client.
 */

const OCR_PRIMARY_MODEL = (process.env.GEMINI_OCR_MODEL || 'gemini-4-hydrogen').trim();
const LITE_MODEL = (process.env.GEMINI_LITE_MODEL || 'gemini-3.5-flash-lite').trim();
const SECONDARY_LITE_MODEL = 'gemini-3.1-flash-lite';

const RETRY_DELAY_MS = 2000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// In-memory IP rate-limit store (persists across warm serverless invocations)
const rateLimitStore = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  return (
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown-client'
  );
}

function checkRateLimit(clientIp) {
  const now = Date.now();

  // Opportunistic cleanup to keep memory bounded
  if (rateLimitStore.size > 2000) {
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now >= entry.resetAt) rateLimitStore.delete(key);
    }
  }

  let record = rateLimitStore.get(clientIp);
  if (!record || now >= record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  record.count += 1;
  rateLimitStore.set(clientIp, record);

  const remaining = Math.max(0, RATE_LIMIT_MAX_REQUESTS - record.count);
  const allowed = record.count <= RATE_LIMIT_MAX_REQUESTS;
  const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));

  return {
    allowed,
    limit: RATE_LIMIT_MAX_REQUESTS,
    remaining,
    resetAt: record.resetAt,
    retryAfterSeconds,
  };
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
  return (
    statusText === 'NOT_FOUND' ||
    /model.*not found|not supported for generateContent/i.test(String(error?.message || ''))
  );
}

async function generateWithRetryAndFallback(ai, modelChain, requestParams) {
  const uniqueModels = Array.from(new Set(modelChain.filter(Boolean)));
  let lastError = null;

  for (let i = 0; i < uniqueModels.length; i++) {
    const model = uniqueModels[i];
    const isPrimary = i === 0;

    try {
      return await ai.models.generateContent({
        ...requestParams,
        model,
      });
    } catch (err) {
      lastError = err;

      if (isPrimary && isHighDemandOrRateLimitError(err)) {
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
          continue;
        }
      }

      if (isHighDemandOrRateLimitError(err) || isModelUnavailableError(err)) {
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

function extractTextFromResponse(response) {
  if (typeof response?.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function parseJsonResponse(rawText) {
  const cleaned = (rawText || '')
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

async function handleOcr(ai, body) {
  const imageData = body.imageData || body.base64Data;
  const mimeType = body.mimeType || 'image/jpeg';
  const language = body.language === 'vi' ? 'vi' : 'en';

  if (!imageData || typeof imageData !== 'string') {
    const err = new Error('Missing base64 imageData payload.');
    err.httpStatus = 400;
    throw err;
  }

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

  const response = await generateWithRetryAndFallback(
    ai,
    [OCR_PRIMARY_MODEL, LITE_MODEL, SECONDARY_LITE_MODEL],
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe this A4 page into clean Markdown with KaTeX math/chemical formulas. Provide a clear # Heading title at the top matching the document.',
            },
            {
              inlineData: {
                mimeType,
                data: imageData,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction,
      },
    }
  );

  let markdown = extractTextFromResponse(response);
  markdown = markdown.replace(/^```(?:markdown|md)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();

  const headingMatch = markdown.match(/^#{1,2}\s+(.+)$/m);
  const suggestedTitle = headingMatch
    ? headingMatch[1].replace(/[*_`]/g, '').trim().slice(0, 80)
    : language === 'vi'
      ? 'Tài liệu A4 đã quét'
      : 'Scanned A4 Document';

  return { markdown, suggestedTitle };
}

async function handleFlashcards(ai, body) {
  const text = String(body.text || '').trim();
  const title = String(body.title || 'Study Document').trim();
  const count = Math.min(12, Math.max(1, Number(body.count) || 5));
  const language = body.language === 'vi' ? 'vi' : 'en';

  if (!text) {
    const err = new Error('Missing document text for flashcard extraction.');
    err.httpStatus = 400;
    throw err;
  }

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

  const response = await generateWithRetryAndFallback(
    ai,
    [LITE_MODEL, SECONDARY_LITE_MODEL, OCR_PRIMARY_MODEL],
    {
      contents: `Generate up to ${count} high-yield flashcards from this study document:\n\nTITLE: ${title}\n\nCONTENT:\n${text}`,
      config: {
        systemInstruction: `You are an expert study coach creating high-retention Spaced Repetition flashcards.
Extract ONLY key definitions, theorems, formulas, and concepts explicitly stated in the provided document.
Use valid KaTeX LaTeX ($...$ or $$...$$) for mathematical and chemical equations. ${outputLang}`,
        responseMimeType: 'application/json',
        responseSchema: flashcardSchema,
      },
    }
  );

  const parsed = parseJsonResponse(extractTextFromResponse(response));
  return {
    cards: Array.isArray(parsed?.cards) ? parsed.cards : [],
  };
}

async function handleQuiz(ai, body) {
  const text = String(body.text || '').trim();
  const fallbackTitle = String(body.title || 'Document Quiz').trim();
  const questionCount = Math.min(10, Math.max(1, Number(body.questionCount) || 5));
  const language = body.language === 'vi' ? 'vi' : 'en';

  if (!text) {
    const err = new Error('Missing document text for quiz generation.');
    err.httpStatus = 400;
    throw err;
  }

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

  const response = await generateWithRetryAndFallback(
    ai,
    [LITE_MODEL, SECONDARY_LITE_MODEL, OCR_PRIMARY_MODEL],
    {
      contents: `Create a ${questionCount}-question multiple-choice quiz strictly from the following document(s):\n\n${text}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: quizSchema,
      },
    }
  );

  const parsed = parseJsonResponse(extractTextFromResponse(response));
  const questions = (parsed?.questions || [])
    .filter((q) => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => {
      const sliced = q.options.slice(0, 4);
      return {
        question: q.question,
        options: sliced,
        correctIndex: Math.min(Math.max(0, Number(q.correctIndex) || 0), sliced.length - 1),
        explanation: q.explanation || '',
      };
    });

  return {
    title: parsed?.title || fallbackTitle.slice(0, 60),
    questions,
  };
}

export default async function handler(req, res) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  // Lightweight status check for UI settings badge (never leaks any key)
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: Boolean(apiKey),
      rateLimitPerHour: RATE_LIMIT_MAX_REQUESTS,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // Enforce IP-based rate limit (max 30 requests/hour per client)
  const clientIp = getClientIp(req);
  const rate = checkRateLimit(clientIp);
  res.setHeader('X-RateLimit-Limit', String(rate.limit));
  res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(rate.resetAt / 1000)));

  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({
      code: 'RATE_LIMITED',
      error: `Rate limit exceeded (${rate.limit} AI requests per hour). Please try again later.`,
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      code: 'MISSING_API_KEY',
      error: 'Server GEMINI_API_KEY environment variable is not configured.',
    });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
  }

  const action = body?.action;
  if (!['ocr', 'flashcards', 'quiz'].includes(action)) {
    return res.status(400).json({
      error: 'Invalid or missing action. Expected "ocr", "flashcards", or "quiz".',
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    if (action === 'ocr') {
      const result = await handleOcr(ai, body);
      return res.status(200).json(result);
    }
    if (action === 'flashcards') {
      const result = await handleFlashcards(ai, body);
      return res.status(200).json(result);
    }
    const result = await handleQuiz(ai, body);
    return res.status(200).json(result);
  } catch (err) {
    const status = err?.httpStatus || getErrorStatusCode(err) || 500;
    const message = err?.message || 'Gemini AI request failed.';
    console.error(`[api/gemini] action="${action}" failed (${status}):`, message);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: message,
    });
  }
}

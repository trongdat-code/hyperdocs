import { GoogleGenAI } from '@google/genai';

/**
 * Modular Gemini AI Service using the current @google/genai Interactions API
 * with the fast multimodal model `gemini-4-hydrogen`.
 *
 * Capabilities:
 *  1. scanA4Document      — Multimodal A4 OCR -> clean Markdown + KaTeX
 *  2. extractFlashcards   — Extract structured SRS flashcards from selected document
 *  3. generateDocumentQuiz — Strict source-grounded MCQ quiz (NO external facts)
 */

const MODEL_ID = 'gemini-4-hydrogen';

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
 * Helper to extract text safely from an Interaction response.
 */
function extractTextFromInteraction(interaction) {
  if (interaction?.output_text) {
    return interaction.output_text.trim();
  }
  const steps = interaction?.steps || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type === 'model_output' && Array.isArray(step.content)) {
      const textParts = step.content
        .filter((part) => part?.type === 'text' && part.text)
        .map((part) => part.text);
      if (textParts.length > 0) return textParts.join('\n').trim();
    }
  }
  return '';
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

  const interaction = await ai.interactions.create({
    model: MODEL_ID,
    system_instruction: systemInstruction,
    input: [
      {
        type: 'text',
        text: 'Transcribe this A4 page into clean Markdown with KaTeX math/chemical formulas. Provide a clear # Heading title at the top matching the document.',
      },
      {
        type: 'image',
        data: base64Data,
        mime_type: mimeType || 'image/jpeg',
      },
    ],
    store: false,
  });

  let markdown = extractTextFromInteraction(interaction);
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
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        description: 'Key concept flashcards extracted strictly from the provided document.',
        items: {
          type: 'object',
          properties: {
            front: {
              type: 'string',
              description: 'Concise question or prompt (supports KaTeX $...$ math).',
            },
            back: {
              type: 'string',
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

  const interaction = await ai.interactions.create({
    model: MODEL_ID,
    system_instruction: `You are an expert study coach creating high-retention Spaced Repetition flashcards.
Extract ONLY key definitions, theorems, formulas, and concepts explicitly stated in the provided document.
Use valid KaTeX LaTeX ($...$ or $$...$$) for mathematical and chemical equations. ${outputLang}`,
    input: `Generate up to ${count} high-yield flashcards from this study document:\n\nTITLE: ${document.title}\n\nCONTENT:\n${document.content}`,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: flashcardSchema,
    },
    store: false,
  });

  const rawText = extractTextFromInteraction(interaction);
  const parsed = JSON.parse(rawText);
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
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short quiz title derived from the source documents.',
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Multiple-choice question strictly grounded in the provided document text.',
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Exactly 4 distinct answer choices (A, B, C, D).',
            },
            correctIndex: {
              type: 'integer',
              description: '0-based index (0 to 3) of the single correct option.',
            },
            explanation: {
              type: 'string',
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

  const interaction = await ai.interactions.create({
    model: MODEL_ID,
    system_instruction: systemInstruction,
    input: `Create a ${questionCount}-question multiple-choice quiz strictly from the following document(s):\n\n${combinedCorpus}`,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: quizSchema,
    },
    store: false,
  });

  const rawText = extractTextFromInteraction(interaction);
  const parsed = JSON.parse(rawText);
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

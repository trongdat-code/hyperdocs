import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { normalizeMathDelimiters } from '../utils/katexSanitizer';

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

const INLINE_COMPONENTS = {
  p: ({ children }) => (
    <span className="inline [&:not(:last-child)]:block [&:not(:last-child)]:mb-1.5">
      {children}
    </span>
  ),
};

/**
 * Shared Markdown + KaTeX renderer for Quiz questions, options, explanations,
 * and Flashcard front/back faces.
 *
 * Automatically normalizes bare LaTeX commands (e.g. `\text{CuSO}_4\cdot 5\text{H}_2\text{O}`,
 * `\frac{...}{...}`, `_{...}`, `^{...}`) into valid `$ ... $` delimiters before rendering.
 *
 * Use `inline={true}` inside flexbox option buttons or inline text to avoid `<p>` nesting
 * and keep vertical alignment crisp.
 */
export default function MathText({ text, content, inline = false, className = '' }) {
  const raw = text !== undefined ? text : content;
  const normalized = useMemo(() => normalizeMathDelimiters(raw || ''), [raw]);

  if (inline) {
    return (
      <span
        className={`inline max-w-full leading-relaxed break-words [&_.katex]:text-[1.03em] [&_.katex-display]:my-1.5 [&_.katex-display]:py-1 ${className}`.trim()}
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={INLINE_COMPONENTS}
        >
          {normalized}
        </ReactMarkdown>
      </span>
    );
  }

  return (
    <div
      className={`study-markdown text-[15px] overflow-x-auto max-w-full [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 ${className}`.trim()}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

import katex from 'katex';
import TurndownService from 'turndown';

/**
 * Bidirectional Markdown + KaTeX <-> Editable WYSIWYG HTML Serializer & Rich Formatter
 *
 * Preserves:
 *  - Headings, paragraphs, soft line breaks, lists, blockquotes, fenced code, inline code,
 *    bold/italic/strikethrough, links, and GFM tables
 *  - Inline `$...$` and block `$$...$$` KaTeX formulas as atomic `contenteditable="false"`
 *    rendered elements carrying lossless `data-latex` attributes
 *  - Styled `<span class="doc-text-color" style="color: #HEX">` and
 *    `<mark class="doc-highlight" style="background-color: #HEX">` annotations
 */

const SAFE_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

/**
 * Normalize a CSS color value (`#dc2626`, `rgb(220, 38, 38)`, etc.) to canonical `#RRGGBB`.
 */
export function normalizeCssColorToHex(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (SAFE_HEX_RE.test(raw)) {
    if (raw.length === 4) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
    }
    return raw.toUpperCase();
  }
  const rgbMatch = raw.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i
  );
  if (rgbMatch) {
    const [r, g, b] = [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])].map((n) =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
    );
    return `#${r}${g}${b}`.toUpperCase();
  }
  return null;
}

/**
 * Render a LaTeX expression into an atomic non-editable KaTeX chip HTML string.
 */
export function renderMathChipHtml(latex, displayMode = false) {
  const cleanLatex = String(latex || '').trim();
  let rendered = '';
  try {
    rendered = katex.renderToString(cleanLatex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    rendered = escapeHtml(cleanLatex);
  }
  const encoded = escapeAttr(cleanLatex);
  if (displayMode) {
    return `<div class="hd-math-block" contenteditable="false" data-math-kind="block" data-latex="${encoded}">${rendered}</div>`;
  }
  return `<span class="hd-math-inline" contenteditable="false" data-math-kind="inline" data-latex="${encoded}">${rendered}</span>`;
}

function formatInlineMarkdown(rawLine, tokens) {
  let out = rawLine;

  // Mask inline code spans first
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = tokens.length;
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE010TOK${idx}\uE011`;
  });

  // Mask inline KaTeX math ($...$) — avoid currency ranges like `$10 to $20`
  out = out.replace(/(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)/g, (match, inner) => {
    if (/^\d[\d,.]*\s+(?:to|and|or|đến|và|hoặc|per|mỗi)\s*$/i.test(inner.trim())) {
      return match;
    }
    const idx = tokens.length;
    tokens.push(renderMathChipHtml(inner.trim(), false));
    return `\uE010TOK${idx}\uE011`;
  });

  // Mask safe allowlisted annotation tags (<span class="doc-text-color" ...>, <mark class="doc-highlight" ...>, <br>)
  out = out.replace(
    /<span\s+class="doc-text-color"\s+style="color:\s*(#[0-9a-fA-F]{3,8});?"\s*>/gi,
    (_m, hex) => {
      const idx = tokens.length;
      tokens.push(`<span class="doc-text-color" style="color: ${hex.toUpperCase()}">`);
      return `\uE010TOK${idx}\uE011`;
    }
  );
  out = out.replace(/<\/span>/gi, () => {
    const idx = tokens.length;
    tokens.push('</span>');
    return `\uE010TOK${idx}\uE011`;
  });
  out = out.replace(
    /<mark\s+class="doc-highlight"\s+style="background-color:\s*(#[0-9a-fA-F]{3,8});?"\s*>/gi,
    (_m, hex) => {
      const idx = tokens.length;
      tokens.push(`<mark class="doc-highlight" style="background-color: ${hex.toUpperCase()}">`);
      return `\uE010TOK${idx}\uE011`;
    }
  );
  out = out.replace(/<\/mark>/gi, () => {
    const idx = tokens.length;
    tokens.push('</mark>');
    return `\uE010TOK${idx}\uE011`;
  });
  out = out.replace(/<br\s*\/?>/gi, () => {
    const idx = tokens.length;
    tokens.push('<br>');
    return `\uE010TOK${idx}\uE011`;
  });

  // Escape any remaining unsafe HTML
  out = escapeHtml(out);

  // Markdown links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const cleanHref = href.replace(/&amp;/g, '&').trim();
    if (!/^(?:https?:|mailto:|\/|#)/i.test(cleanHref)) return match;
    return `<a href="${escapeAttr(cleanHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold + Italic, Bold, Italic, Strikethrough
  out = out.replace(/\*\*\*([^\n*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^\n_]+?)__/g, '<strong>$1</strong>');
  out = out.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  out = out.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');

  // Restore tokens (may be nested if markdown formatting wrapped a token)
  let guard = 0;
  while (/\uE010TOK\d+\uE011/.test(out) && guard < 6) {
    out = out.replace(/\uE010TOK(\d+)\uE011/g, (_m, idx) => tokens[Number(idx)] ?? '');
    guard += 1;
  }

  return out;
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

/**
 * Convert stored Markdown + KaTeX + safe color/highlight annotations into
 * rich editable HTML for the always-editable WYSIWYG canvas.
 */
export function markdownToEditorHtml(markdown) {
  const raw = String(markdown || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return '';

  const blockTokens = [];
  const inlineTokens = [];

  // 1. Mask fenced code blocks
  let text = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = blockTokens.length;
    const langAttr = lang ? ` class="language-${escapeAttr(lang)}"` : '';
    blockTokens.push(`<pre><code${langAttr}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`);
    return `\n\n\uE012BLK${idx}\uE013\n\n`;
  });

  // 2. Mask display math blocks ($$...$$)
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, latex) => {
    const idx = blockTokens.length;
    blockTokens.push(renderMathChipHtml(latex.trim(), true));
    return `\n\n\uE012BLK${idx}\uE013\n\n`;
  });

  const lines = text.split('\n');
  const htmlBlocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Masked block token (fenced code or display math)
    const blkMatch = line.trim().match(/^\uE012BLK(\d+)\uE013$/);
    if (blkMatch) {
      htmlBlocks.push(blockTokens[Number(blkMatch[1])] || '');
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      htmlBlocks.push('<hr>');
      i += 1;
      continue;
    }

    // Headings (# .. ######)
    const headingMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlBlocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2], inlineTokens)}</h${level}>`);
      i += 1;
      continue;
    }

    // GFM Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        bodyRows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${headers
        .map((h) => `<th>${formatInlineMarkdown(h, inlineTokens)}</th>`)
        .join('')}</tr></thead>`;
      const tbody =
        bodyRows.length > 0
          ? `<tbody>${bodyRows
              .map(
                (row) =>
                  `<tr>${headers
                    .map((_, colIdx) => `<td>${formatInlineMarkdown(row[colIdx] || '', inlineTokens)}</td>`)
                    .join('')}</tr>`
              )
              .join('')}</tbody>`
          : '';
      htmlBlocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const inner = quoteLines
        .map((ql) => formatInlineMarkdown(ql, inlineTokens))
        .join('<br>');
      htmlBlocks.push(`<blockquote><p>${inner}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(`<li>${formatInlineMarkdown(itemText, inlineTokens)}</li>`);
        i += 1;
      }
      htmlBlocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(`<li>${formatInlineMarkdown(itemText, inlineTokens)}</li>`);
        i += 1;
      }
      htmlBlocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Standard paragraph (preserve intentional single line breaks inside paragraph via <br>)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\uE012BLK\d+\uE013$/.test(lines[i].trim()) &&
      !/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(lines[i]) &&
      !/^\s*#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      paraLines.push(formatInlineMarkdown(lines[i], inlineTokens));
      i += 1;
    }
    if (paraLines.length > 0) {
      htmlBlocks.push(`<p>${paraLines.join('<br>')}</p>`);
    }
  }

  return htmlBlocks.join('\n');
}

/**
 * Create a TurndownService instance configured to losslessly preserve KaTeX chips,
 * `.doc-text-color` spans, `.doc-highlight` marks, GFM tables, and user-typed `$...$` math.
 */
function createMarkdownTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // Preserve user-typed $...$ and $$...$$ without backslash-escaping math characters
  const originalEscape = td.escape.bind(td);
  td.escape = (str) => {
    if (!str || !str.includes('$')) return originalEscape(str);
    const saved = [];
    const masked = str.replace(/\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)[^\n$]+?(?<!\$)\$(?!\$)/g, (m) => {
      const idx = saved.length;
      saved.push(m);
      return `HDMATHPLACEHOLDER${idx}END`;
    });
    const escaped = originalEscape(masked);
    return escaped.replace(/HDMATHPLACEHOLDER(\d+)END/g, (_m, idx) => saved[Number(idx)] ?? '');
  };

  // Lossless KaTeX math blocks & inline chips
  td.addRule('hdMath', {
    filter: (node) => node.nodeType === 1 && node.hasAttribute('data-latex'),
    replacement: (_content, node) => {
      const latex = (node.getAttribute('data-latex') || '').trim();
      if (!latex) return '';
      if (node.getAttribute('data-math-kind') === 'block') {
        return `\n\n$$\n${latex}\n$$\n\n`;
      }
      return `$${latex}$`;
    },
  });

  // Preserve styled text color annotations
  td.addRule('docTextColor', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      (node.classList?.contains('doc-text-color') || Boolean(node.style?.color)),
    replacement: (content, node) => {
      if (!content) return '';
      const hex = normalizeCssColorToHex(node.style?.color);
      if (!hex) return content;
      return `<span class="doc-text-color" style="color: ${hex}">${content}</span>`;
    },
  });

  // Preserve styled highlight annotations
  td.addRule('docHighlight', {
    filter: (node) =>
      node.nodeName === 'MARK' ||
      (node.nodeName === 'SPAN' &&
        (node.classList?.contains('doc-highlight') || Boolean(node.style?.backgroundColor))),
    replacement: (content, node) => {
      if (!content) return '';
      const hex = normalizeCssColorToHex(node.style?.backgroundColor);
      if (!hex) return content;
      return `<mark class="doc-highlight" style="background-color: ${hex}">${content}</mark>`;
    },
  });

  // Strikethrough
  td.addRule('strikethrough', {
    filter: ['del', 's', 'strike'],
    replacement: (content) => (content ? `~~${content}~~` : ''),
  });

  // GFM Table serializer
  td.addRule('gfmTable', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const matrix = rows.map((tr) =>
        Array.from(tr.children).map((cell) =>
          td
            .turndown(cell.innerHTML || '')
            .replace(/\n+/g, ' ')
            .replace(/\|/g, '\\|')
            .trim()
        )
      );
      const colCount = Math.max(...matrix.map((r) => r.length), 1);
      const padRow = (r) =>
        `| ${Array.from({ length: colCount }, (_, idx) => r[idx] || '').join(' | ')} |`;
      const header = padRow(matrix[0]);
      const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
      const body = matrix.slice(1).map(padRow);
      return `\n\n${[header, sep, ...body].join('\n')}\n\n`;
    },
  });

  // Keep single <br> inside paragraphs clean
  td.addRule('lineBreak', {
    filter: 'br',
    replacement: (_content, node) => {
      // Ignore trailing filler <br> inside otherwise empty or block-ending paragraphs
      const parent = node.parentNode;
      if (parent && parent.lastChild === node && parent.childNodes.length === 1) {
        return '';
      }
      if (parent && parent.lastChild === node && !node.nextSibling) {
        return '';
      }
      return '\n';
    },
  });

  return td;
}

const turndownInstance = createMarkdownTurndown();

/**
 * Normalize cloned DOM element before Turndown conversion so browser `contentEditable`
 * quirks (`<font>`, nested color spans, empty wrappers) serialize to clean Markdown.
 */
function normalizeClonedEditorDom(clone) {
  // Replace deprecated <font color="..."> with canonical doc-text-color spans
  clone.querySelectorAll('font[color]').forEach((fontEl) => {
    const hex = normalizeCssColorToHex(fontEl.getAttribute('color'));
    const span = clone.ownerDocument.createElement('span');
    if (hex) {
      span.className = 'doc-text-color';
      span.style.color = hex;
    }
    while (fontEl.firstChild) span.appendChild(fontEl.firstChild);
    fontEl.replaceWith(span);
  });

  // Convert bare `<div>` lines inserted by Chrome/Edge Enter key (excluding math blocks) into `<p>`
  clone.querySelectorAll('div:not([data-latex])').forEach((divEl) => {
    if (divEl.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, div[data-latex]')) {
      return;
    }
    const p = clone.ownerDocument.createElement('p');
    while (divEl.firstChild) p.appendChild(divEl.firstChild);
    divEl.replaceWith(p);
  });

  // Remove empty annotation spans/marks (keep ones containing KaTeX or visible text)
  clone.querySelectorAll('span.doc-text-color, mark.doc-highlight').forEach((el) => {
    if (!el.textContent && !el.querySelector('[data-latex]')) {
      el.remove();
    }
  });
}

/**
 * Serialize a live WYSIWYG `contentEditable` root element (or HTML string) back into
 * clean Markdown + KaTeX + styled `.doc-text-color` / `.doc-highlight` annotations.
 */
export function editorHtmlToMarkdown(rootEl) {
  if (!rootEl) return '';

  let workingEl;
  if (typeof rootEl === 'string') {
    if (typeof document === 'undefined') return '';
    workingEl = document.createElement('div');
    workingEl.innerHTML = rootEl;
  } else {
    workingEl = rootEl.cloneNode(true);
  }

  normalizeClonedEditorDom(workingEl);

  const rawMd = turndownInstance.turndown(workingEl);
  return rawMd
    .replace(/\u200B/g, '')
    .replace(/^([ \t]*)-[ ]{2,}/gm, '$1- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Sanitize external pasted HTML so pasted text retains structure without bringing in
 * unwanted fonts, backgrounds, scripts, or inline layout styles.
 */
export function sanitizePastedHtml(html) {
  if (typeof document === 'undefined' || !html) return '';
  const container = document.createElement('div');
  container.innerHTML = html;

  container
    .querySelectorAll('script, style, meta, link, iframe, object, embed, form, input, button')
    .forEach((el) => el.remove());

  const allowedTags = new Set([
    'P',
    'BR',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'UL',
    'OL',
    'LI',
    'STRONG',
    'B',
    'EM',
    'I',
    'DEL',
    'S',
    'BLOCKQUOTE',
    'PRE',
    'CODE',
    'HR',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TH',
    'TD',
    'A',
    'SPAN',
    'MARK',
    'DIV',
  ]);

  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 8) {
        child.remove();
        return;
      }
      if (child.nodeType !== 1) return;

      walk(child);

      if (!allowedTags.has(child.nodeName)) {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        return;
      }

      const keepHref =
        child.nodeName === 'A' && /^(?:https?:|mailto:)/i.test(child.getAttribute('href') || '')
          ? child.getAttribute('href')
          : null;
      const keepColor =
        child.classList.contains('doc-text-color')
          ? normalizeCssColorToHex(child.style.color)
          : null;
      const keepBg =
        child.nodeName === 'MARK' || child.classList.contains('doc-highlight')
          ? normalizeCssColorToHex(child.style.backgroundColor)
          : null;

      Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));

      if (keepHref) {
        child.setAttribute('href', keepHref);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (keepColor) {
        child.className = 'doc-text-color';
        child.style.color = keepColor;
      } else if (keepBg) {
        child.className = 'doc-highlight';
        child.style.backgroundColor = keepBg;
      } else if (child.nodeName === 'SPAN') {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
      }
    });
  };

  walk(container);
  return container.innerHTML;
}

// ============================================================================
// Direct WYSIWYG DOM Range Formatting (`doc-text-color` & `doc-highlight`)
// ============================================================================

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'TD', 'TH']);

function findMatchingAnnotationAncestor(node, editorEl, kind) {
  let curr = node.nodeType === 3 ? node.parentElement : node;
  while (curr && curr !== editorEl) {
    if (kind === 'color' && curr.nodeName === 'SPAN' && curr.classList.contains('doc-text-color')) {
      return curr;
    }
    if (kind === 'highlight' && curr.nodeName === 'MARK' && curr.classList.contains('doc-highlight')) {
      return curr;
    }
    curr = curr.parentElement;
  }
  return null;
}

function isInsideNonEditable(node, editorEl) {
  let curr = node.nodeType === 3 ? node.parentElement : node;
  while (curr && curr !== editorEl) {
    if (curr.getAttribute?.('contenteditable') === 'false' || curr.hasAttribute?.('data-latex')) {
      return true;
    }
    curr = curr.parentElement;
  }
  return false;
}

function findClosestBlock(node, editorEl) {
  let curr = node.nodeType === 3 ? node.parentElement : node;
  while (curr && curr !== editorEl) {
    if (BLOCK_TAGS.has(curr.nodeName) && curr.getAttribute('contenteditable') !== 'false') {
      return curr;
    }
    curr = curr.parentElement;
  }
  return null;
}

/**
 * Split an existing wrapper element around a specific descendant text node so that
 * `before` and `after` remain wrapped in copies of the wrapper, while the middle
 * target node is returned directly in place for re-wrapping or unwrapping.
 */
function splitWrapperAroundTextNode(wrapper, targetTextNode) {
  const doc = wrapper.ownerDocument;

  const beforeRange = doc.createRange();
  beforeRange.setStart(wrapper, 0);
  beforeRange.setEndBefore(targetTextNode);

  const afterRange = doc.createRange();
  afterRange.setStartAfter(targetTextNode);
  afterRange.setEnd(wrapper, wrapper.childNodes.length);

  const beforeFrag = beforeRange.extractContents();
  const afterFrag = afterRange.extractContents();

  const parent = wrapper.parentNode;
  if (beforeFrag.textContent || beforeFrag.querySelector?.('[data-latex]')) {
    const beforeClone = wrapper.cloneNode(false);
    beforeClone.appendChild(beforeFrag);
    parent.insertBefore(beforeClone, wrapper);
  }

  // Extract remaining inner content around targetTextNode (preserving inner nested highlight/color if any!)
  const middleFrag = doc.createDocumentFragment();
  while (wrapper.firstChild) {
    middleFrag.appendChild(wrapper.firstChild);
  }
  parent.insertBefore(middleFrag, wrapper);

  if (afterFrag.textContent || afterFrag.querySelector?.('[data-latex]')) {
    const afterClone = wrapper.cloneNode(false);
    afterClone.appendChild(afterFrag);
    parent.insertBefore(afterClone, wrapper);
  }

  wrapper.remove();
}

function mergeAdjacentAnnotations(editorEl) {
  const selector = 'span.doc-text-color, mark.doc-highlight';
  const elements = Array.from(editorEl.querySelectorAll(selector));
  for (const el of elements) {
    if (!el.isConnected) continue;
    if (!el.textContent && !el.querySelector('[data-latex]')) {
      el.remove();
      continue;
    }
    let next = el.nextSibling;
    while (
      next &&
      next.nodeType === 1 &&
      next.nodeName === el.nodeName &&
      next.className === el.className &&
      next.getAttribute('style') === el.getAttribute('style')
    ) {
      while (next.firstChild) {
        el.appendChild(next.firstChild);
      }
      const toRemove = next;
      next = el.nextSibling;
      toRemove.remove();
    }
  }
}

/**
 * Apply (or clear when `hex === null`) rich text color or highlight directly on the
 * current selection inside `editorEl` as rendered `<span class="doc-text-color">` or
 * `<mark class="doc-highlight">` elements — never inserting raw HTML text.
 *
 * Returns `{ applied: boolean }`.
 */
export function applyRichAnnotationToSelection(editorEl, savedRange, kind, hex) {
  if (!editorEl) return { applied: false };

  const selection = window.getSelection();
  let range = null;

  if (selection && selection.rangeCount > 0) {
    const liveRange = selection.getRangeAt(0);
    if (editorEl.contains(liveRange.commonAncestorContainer)) {
      range = liveRange.cloneRange();
    }
  }

  if (!range && savedRange && editorEl.contains(savedRange.commonAncestorContainer)) {
    range = savedRange.cloneRange();
  }

  if (!range) return { applied: false };

  // If caret is collapsed: either clear enclosing annotation, or target the current block (for block highlight/color)
  if (range.collapsed) {
    const existing = findMatchingAnnotationAncestor(range.startContainer, editorEl, kind);
    if (existing && !hex) {
      const targetRange = document.createRange();
      targetRange.selectNodeContents(existing);
      range = targetRange;
    } else {
      const block = findClosestBlock(range.startContainer, editorEl);
      if (block && block.textContent.trim().length > 0) {
        const blockRange = document.createRange();
        blockRange.selectNodeContents(block);
        range = blockRange;
      } else {
        return { applied: false };
      }
    }
  }

  if (range.collapsed) return { applied: false };

  // Collect all editable text nodes intersecting `range`
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue || node.nodeValue.length === 0) return NodeFilter.FILTER_REJECT;
      if (isInsideNonEditable(node, editorEl)) return NodeFilter.FILTER_REJECT;
      try {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } catch {
        return NodeFilter.FILTER_REJECT;
      }
    },
  });

  const textNodes = [];
  let currentNode;
  while ((currentNode = walker.nextNode())) {
    textNodes.push(currentNode);
  }

  if (textNodes.length === 0) return { applied: false };

  // Split boundary text nodes so we only format the exact selected substring
  const targetNodes = [];
  const startContainer = range.startContainer;
  const startOffset = range.startOffset;
  const endContainer = range.endContainer;
  const endOffset = range.endOffset;

  for (const node of textNodes) {
    let working = node;
    const isStart = node === startContainer;
    const isEnd = node === endContainer;

    if (isEnd && endOffset < working.nodeValue.length) {
      working.splitText(endOffset);
    }
    if (isStart && startOffset > 0) {
      working = working.splitText(startOffset);
    }

    if (working.nodeValue.length > 0) {
      targetNodes.push(working);
    }
  }

  if (targetNodes.length === 0) return { applied: false };

  const normalizedHex = hex ? normalizeCssColorToHex(hex) : null;

  for (const textNode of targetNodes) {
    const existingWrapper = findMatchingAnnotationAncestor(textNode, editorEl, kind);

    if (existingWrapper) {
      splitWrapperAroundTextNode(existingWrapper, textNode);
    }

    if (normalizedHex) {
      const el = document.createElement(kind === 'color' ? 'span' : 'mark');
      if (kind === 'color') {
        el.className = 'doc-text-color';
        el.style.color = normalizedHex;
      } else {
        el.className = 'doc-highlight';
        el.style.backgroundColor = normalizedHex;
      }
      textNode.parentNode.insertBefore(el, textNode);
      el.appendChild(textNode);
    }
  }

  mergeAdjacentAnnotations(editorEl);

  // Restore clean selection spanning the formatted nodes
  try {
    const first = targetNodes.find((n) => n.isConnected);
    const last = [...targetNodes].reverse().find((n) => n.isConnected);
    if (first && last && selection) {
      const nextRange = document.createRange();
      nextRange.setStart(first, 0);
      nextRange.setEnd(last, last.nodeValue.length);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    }
  } catch {
    // Ignore selection restoration edge cases
  }

  return { applied: true };
}

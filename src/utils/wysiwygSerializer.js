import katex from 'katex';
import TurndownService from 'turndown';
import {
  createMathNode,
  createMathWidgetElement,
  createRootExprTree,
  extractMathTreesFromEditor,
  findSlotFirstSeg,
  focusSegInput,
  handleRecursiveMathKeyDown,
  insertNestedNodeAtSeg,
  normalizeNodeType,
  parseLatexToMathTree,
  readMathTreeFromDom,
  refreshPrintKatexForEditor,
  renderMathWidgetHtml,
  serializeMathTreeToLatex,
  syncMathWidgetState,
  syncSegInputSize,
} from './mathTree';

export { extractMathTreesFromEditor, refreshPrintKatexForEditor, syncMathWidgetState };

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
 * Resize an inline `<input class="hd-seg">` smoothly to fit its content width
 * and keep the enclosing recursive `.hd-eq` widget's `data-math-tree`, `data-latex`,
 * and print-only KaTeX span synchronized in-place with zero outer DOM churn.
 */
export function syncSlotInputSize(inputEl) {
  if (!inputEl || inputEl.tagName !== 'INPUT') return;
  syncSegInputSize(inputEl);
  const rootEqEl = inputEl.closest?.('.hd-eq');
  if (rootEqEl) {
    syncMathWidgetState(rootEqEl, true);
  }
}

/**
 * Compile a recursive inline interactive `.hd-eq` widget DOM node into clean standard LaTeX.
 */
export function buildLatexFromEqElement(eqEl) {
  if (!eqEl) return { latex: '', displayMode: false };
  const tree = readMathTreeFromDom(eqEl);
  return serializeMathTreeToLatex(tree);
}

/**
 * Render an atomic recursive inline interactive visual formula widget (`contenteditable="false"`)
 * powered by `MathNode` trees.
 */
export function renderInteractiveEqHtml(eqType) {
  const node = createMathNode(normalizeNodeType(eqType));
  if (!node) return '';
  return renderMathWidgetHtml(createRootExprTree(node));
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
    return `<div class="inline-formula-node hd-math-block" contenteditable="false" data-math-kind="block" data-latex="${encoded}">${rendered}</div>`;
  }
  return `<span class="inline-formula-node hd-math-inline" contenteditable="false" data-math-kind="inline" data-latex="${encoded}">${rendered}</span>`;
}

function renderHydratedMathHtml(latex, displayMode, options = {}) {
  const cleanLatex = String(latex || '').trim();
  const savedTree = options?.interactiveFormulas && options?.mathNodes?.[cleanLatex];
  if (savedTree && typeof document !== 'undefined') {
    const widgetHtml = renderMathWidgetHtml(savedTree);
    if (widgetHtml) return widgetHtml;
  }
  return renderMathChipHtml(cleanLatex, displayMode);
}

function formatInlineMarkdown(rawLine, tokens, options = {}) {
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
    tokens.push(renderHydratedMathHtml(inner.trim(), false, options));
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

function parseListLineInfo(line) {
  const expanded = line.replace(/\t/g, '  ');
  const checklistMatch = expanded.match(/^([ ]*)[-*+]\s+\[([ xX])\]\s*(.*)$/);
  if (checklistMatch) {
    return {
      indent: checklistMatch[1].length,
      kind: 'checklist',
      checked: checklistMatch[2].toLowerCase() === 'x',
      content: checklistMatch[3],
    };
  }
  const ulMatch = expanded.match(/^([ ]*)[-*+]\s+(.*)$/);
  if (ulMatch) {
    return {
      indent: ulMatch[1].length,
      kind: 'ul',
      checked: false,
      content: ulMatch[2],
    };
  }
  const olMatch = expanded.match(/^([ ]*)\d+\.\s+(.*)$/);
  if (olMatch) {
    return {
      indent: olMatch[1].length,
      kind: 'ol',
      checked: false,
      content: olMatch[2],
    };
  }
  return null;
}

function buildNestedListHtml(items, inlineTokens, options = {}) {
  let idx = 0;

  const renderLevel = (baseIndent, listKind) => {
    const tag = listKind === 'ol' ? 'ol' : 'ul';
    const cls = listKind === 'checklist' ? ' class="hd-checklist"' : '';
    let html = `<${tag}${cls}>`;

    while (idx < items.length) {
      const item = items[idx];
      if (item.indent < baseIndent) break;
      if (item.indent === baseIndent && item.kind !== listKind) break;

      idx += 1;

      // Consume any deeper nested child lists belonging to this item
      let childrenHtml = '';
      while (idx < items.length && items[idx].indent > item.indent) {
        childrenHtml += renderLevel(items[idx].indent, items[idx].kind);
      }

      const formatted = formatInlineMarkdown(item.content, inlineTokens, options);
      if (item.kind === 'checklist') {
        const checkedAttr = item.checked ? ' checked' : '';
        html += `<li class="hd-checklist-item" data-checked="${item.checked ? 'true' : 'false'}"><input type="checkbox" class="hd-checklist-box" contenteditable="false"${checkedAttr} /><span class="hd-checklist-text">${formatted || '<br>'}</span>${childrenHtml}</li>`;
      } else {
        html += `<li>${formatted}${childrenHtml}</li>`;
      }
    }

    html += `</${tag}>`;
    return html;
  };

  let out = '';
  while (idx < items.length) {
    out += renderLevel(items[idx].indent, items[idx].kind);
  }
  return out;
}

/**
 * Convert stored Markdown + KaTeX + safe color/highlight annotations into
 * rich editable HTML for the always-editable WYSIWYG canvas.
 * When `options.interactiveFormulas` & `options.mathNodes` are provided,
 * saved Desmos `MathNode` formulas hydrate losslessly as live recursive editors.
 */
export function markdownToEditorHtml(markdown, options = {}) {
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
    blockTokens.push(renderHydratedMathHtml(latex.trim(), true, options));
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
      htmlBlocks.push(`<h${level}>${formatInlineMarkdown(headingMatch[2], inlineTokens, options)}</h${level}>`);
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
        .map((h) => `<th>${formatInlineMarkdown(h, inlineTokens, options)}</th>`)
        .join('')}</tr></thead>`;
      const tbody =
        bodyRows.length > 0
          ? `<tbody>${bodyRows
              .map(
                (row) =>
                  `<tr>${headers
                    .map((_, colIdx) => `<td>${formatInlineMarkdown(row[colIdx] || '', inlineTokens, options)}</td>`)
                    .join('')}</tr>`
              )
              .join('')}</tbody>`
          : '';
      htmlBlocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote OR Structured Callout / Summary Box (`> [!NOTE] ...`)
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const calloutHeader = quoteLines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|SUMMARY)\]\s*(.*)$/i);
      if (calloutHeader) {
        const calloutType = calloutHeader[1].toLowerCase();
        const bodyLines = [];
        if (calloutHeader[2]?.trim()) bodyLines.push(calloutHeader[2]);
        for (let k = 1; k < quoteLines.length; k += 1) {
          bodyLines.push(quoteLines[k]);
        }
        const inner = bodyLines
          .map((ql) => formatInlineMarkdown(ql, inlineTokens, options))
          .join('<br>');
        htmlBlocks.push(
          `<div class="hd-callout" data-callout="${escapeAttr(calloutType)}"><span class="hd-callout-icon" contenteditable="false">💡</span><div class="hd-callout-body"><p>${inner || '<br>'}</p></div></div>`
        );
      } else {
        const inner = quoteLines
          .map((ql) => formatInlineMarkdown(ql, inlineTokens, options))
          .join('<br>');
        htmlBlocks.push(`<blockquote><p>${inner}</p></blockquote>`);
      }
      continue;
    }

    // Multi-level Indented Lists & Checklists (unordered, ordered, `- [ ]`, `- [x]`)
    const firstListItem = parseListLineInfo(line);
    if (firstListItem) {
      const listItems = [];
      while (i < lines.length) {
        const info = parseListLineInfo(lines[i]);
        if (!info) break;
        listItems.push(info);
        i += 1;
      }
      htmlBlocks.push(buildNestedListHtml(listItems, inlineTokens, options));
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
      !parseListLineInfo(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      paraLines.push(formatInlineMarkdown(lines[i], inlineTokens, options));
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

  // Recursive inline interactive visual equation widgets (`.hd-eq`) -> standard KaTeX `$...$` / `$$...$$`
  td.addRule('hdInlineEq', {
    filter: (node) =>
      node.nodeType === 1 &&
      (node.classList?.contains('hd-eq') ||
        node.hasAttribute('data-math-tree') ||
        node.hasAttribute('data-eq-type')),
    replacement: (_content, node) => {
      const { latex, displayMode } = buildLatexFromEqElement(node);
      if (!latex) return '';
      return displayMode ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
    },
  });

  // Lossless KaTeX math blocks & inline chips (excluding `.hd-eq` handled above)
  td.addRule('hdMath', {
    filter: (node) =>
      node.nodeType === 1 &&
      node.hasAttribute('data-latex') &&
      !node.classList?.contains('hd-eq'),
    replacement: (_content, node) => {
      const latex = (node.getAttribute('data-latex') || '').trim();
      if (!latex) return '';
      if (node.getAttribute('data-math-kind') === 'block') {
        return `\n\n$$\n${latex}\n$$\n\n`;
      }
      return `$${latex}$`;
    },
  });

  // Ignore decorative callout icon, print-only KaTeX mirror & checklist checkbox inputs during Turndown extraction
  td.addRule('hdChromeIgnore', {
    filter: (node) =>
      node.nodeType === 1 &&
      (node.classList?.contains('hd-callout-icon') ||
        node.classList?.contains('hd-checklist-box') ||
        node.classList?.contains('hd-eq-print-katex')),
    replacement: () => '',
  });

  // Structured Callout / Summary Box -> GitHub/Notion `> [!NOTE]` blockquote syntax
  td.addRule('hdCallout', {
    filter: (node) => node.nodeType === 1 && node.classList?.contains('hd-callout'),
    replacement: (_content, node) => {
      const bodyEl = node.querySelector?.('.hd-callout-body') || node;
      const innerMd = td.turndown(bodyEl.innerHTML || '').trim();
      const lines = (innerMd || '').split('\n').map((l) => `> ${l}`.trimEnd());
      return `\n\n> [!NOTE]\n${lines.join('\n')}\n\n`;
    },
  });

  // Interactive Checklist items (`- [ ]` / `- [x]`) with multi-level nesting
  td.addRule('hdChecklistItem', {
    filter: (node) =>
      node.nodeName === 'LI' &&
      (node.classList?.contains('hd-checklist-item') ||
        Boolean(node.querySelector?.(':scope > input.hd-checklist-box'))),
    replacement: (content, node) => {
      const checkbox = node.querySelector?.(':scope > input.hd-checklist-box');
      const checked =
        node.getAttribute?.('data-checked') === 'true' || Boolean(checkbox?.checked);
      const cleaned = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n/gm, '\n  ');
      const marker = checked ? '- [x] ' : '- [ ] ';
      return `${marker}${cleaned}${node.nextSibling ? '\n' : ''}`;
    },
  });

  // Clean 2-space indented list items for standard UL/OL nesting
  td.addRule('hdListItem', {
    filter: (node) =>
      node.nodeName === 'LI' &&
      !node.classList?.contains('hd-checklist-item') &&
      !node.querySelector?.(':scope > input.hd-checklist-box'),
    replacement: (content, node) => {
      const cleaned = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '')
        .replace(/\n/gm, '\n  ');
      const parent = node.parentNode;
      let prefix = '- ';
      if (parent && parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute?.('start') || 1);
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start + Math.max(0, index)}. `;
      }
      return `${prefix}${cleaned}${node.nextSibling ? '\n' : ''}`;
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

  // Convert bare `<div>` lines inserted by Chrome/Edge Enter key (excluding math & callout blocks) into `<p>`
  clone.querySelectorAll('div:not([data-latex]):not(.hd-callout):not(.hd-callout-body)').forEach((divEl) => {
    if (
      divEl.querySelector(
        'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, div[data-latex], div.hd-callout'
      )
    ) {
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
    // Sync live `<input>` properties & recursive math trees into HTML attributes before cloning
    rootEl.querySelectorAll?.('input.hd-seg, input.hd-slot').forEach((inp) => {
      inp.setAttribute('value', inp.value || '');
    });
    rootEl.querySelectorAll?.('.hd-eq').forEach((eqEl) => {
      syncMathWidgetState(eqEl, false);
    });
    rootEl.querySelectorAll?.('input.hd-checklist-box').forEach((cb) => {
      if (cb.checked) cb.setAttribute('checked', '');
      else cb.removeAttribute('checked');
    });
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
    // Editable `.hd-slot` inside a `contenteditable="false"` `.hd-eq` IS editable!
    if (curr.classList?.contains('hd-slot')) {
      return false;
    }
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

// ============================================================================
// Block Formatting Helpers: Headings (H1-H3), Multi-Level Lists, Checklists & Callouts
// ============================================================================

function getActiveRangeInEditor(editorEl, savedRange) {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const live = selection.getRangeAt(0);
    if (editorEl.contains(live.commonAncestorContainer)) {
      return live;
    }
  }
  if (savedRange && editorEl.contains(savedRange.commonAncestorContainer)) {
    return savedRange.cloneRange();
  }
  return null;
}

function setCaretInsideElement(el, toEnd = true) {
  const sel = window.getSelection();
  if (!sel || !el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!toEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

function getEditableTopBlock(node, editorEl) {
  let curr = node?.nodeType === 3 ? node.parentElement : node;
  while (curr && curr !== editorEl) {
    if (curr.classList?.contains('hd-callout-body')) {
      return curr.firstElementChild || curr;
    }
    if (
      curr.parentElement === editorEl ||
      curr.parentElement?.classList?.contains('hd-callout-body')
    ) {
      return curr;
    }
    curr = curr.parentElement;
  }
  return null;
}

function getClosestListItem(node, editorEl) {
  let curr = node?.nodeType === 3 ? node.parentElement : node;
  while (curr && curr !== editorEl) {
    if (curr.nodeName === 'LI') return curr;
    curr = curr.parentElement;
  }
  return null;
}

function createChecklistLi(doc, textHtml = '<br>', checked = false) {
  const li = doc.createElement('li');
  li.className = 'hd-checklist-item';
  li.setAttribute('data-checked', checked ? 'true' : 'false');

  const input = doc.createElement('input');
  input.type = 'checkbox';
  input.className = 'hd-checklist-box';
  input.setAttribute('contenteditable', 'false');
  input.checked = checked;

  const span = doc.createElement('span');
  span.className = 'hd-checklist-text';
  span.innerHTML = textHtml || '<br>';

  li.appendChild(input);
  li.appendChild(span);
  return li;
}

/**
 * Toggle the active block between `H1`/`H2`/`H3` and normal `<p>`.
 */
export function toggleHeadingBlock(editorEl, savedRange, level = 2) {
  if (!editorEl) return false;
  const targetTag = `H${Math.min(3, Math.max(1, level))}`;
  const range = getActiveRangeInEditor(editorEl, savedRange);

  if (!range) {
    const heading = document.createElement(targetTag);
    heading.innerHTML = '<br>';
    editorEl.appendChild(heading);
    editorEl.focus();
    setCaretInsideElement(heading, true);
    return true;
  }

  const block = getEditableTopBlock(range.startContainer, editorEl);
  if (!block || block === editorEl) {
    const heading = document.createElement(targetTag);
    const selectedText = range.toString();
    heading.textContent = selectedText || '';
    if (!selectedText) heading.innerHTML = '<br>';
    editorEl.appendChild(heading);
    setCaretInsideElement(heading, true);
    return true;
  }

  // If inside a list item, convert that single list item's text into a heading after the list
  const li = getClosestListItem(range.startContainer, editorEl);
  if (li) {
    const heading = document.createElement(targetTag);
    const textEl = li.querySelector(':scope > .hd-checklist-text');
    heading.innerHTML = textEl ? textEl.innerHTML : li.innerHTML;
    if (!heading.innerHTML.trim()) heading.innerHTML = '<br>';
    const topList = block;
    topList.parentNode.insertBefore(heading, topList.nextSibling);
    li.remove();
    if (!topList.querySelector('li')) topList.remove();
    setCaretInsideElement(heading, true);
    return true;
  }

  const nextTag = block.nodeName === targetTag ? 'P' : targetTag;
  const replacement = document.createElement(nextTag);
  while (block.firstChild) {
    replacement.appendChild(block.firstChild);
  }
  if (!replacement.innerHTML.trim()) replacement.innerHTML = '<br>';
  block.replaceWith(replacement);
  setCaretInsideElement(replacement, true);
  return true;
}

/**
 * Toggle or convert the current block into a bulleted list (`ul`), numbered list (`ol`),
 * or interactive checklist (`checklist`).
 */
export function toggleListBlock(editorEl, savedRange, listType = 'ul') {
  if (!editorEl) return false;
  const range = getActiveRangeInEditor(editorEl, savedRange);
  const doc = editorEl.ownerDocument;

  const makeListEl = (type) => {
    const el = doc.createElement(type === 'ol' ? 'ol' : 'ul');
    if (type === 'checklist') el.className = 'hd-checklist';
    return el;
  };

  if (!range) {
    const list = makeListEl(listType);
    const li =
      listType === 'checklist' ? createChecklistLi(doc, '<br>', false) : doc.createElement('li');
    if (listType !== 'checklist') li.innerHTML = '<br>';
    list.appendChild(li);
    editorEl.appendChild(list);
    editorEl.focus();
    setCaretInsideElement(
      listType === 'checklist' ? li.querySelector('.hd-checklist-text') : li,
      true
    );
    return true;
  }

  const existingLi = getClosestListItem(range.startContainer, editorEl);
  if (existingLi) {
    const parentList = existingLi.parentElement;
    const isChecklist =
      existingLi.classList.contains('hd-checklist-item') ||
      parentList?.classList.contains('hd-checklist');
    const currentType = isChecklist ? 'checklist' : parentList?.nodeName === 'OL' ? 'ol' : 'ul';

    // Extract inner text content (excluding nested child sublists)
    const nestedLists = Array.from(existingLi.children).filter(
      (ch) => ch.nodeName === 'UL' || ch.nodeName === 'OL'
    );
    const textHolder = existingLi.querySelector(':scope > .hd-checklist-text');
    const innerHtml = textHolder
      ? textHolder.innerHTML
      : Array.from(existingLi.childNodes)
          .filter((n) => n.nodeName !== 'UL' && n.nodeName !== 'OL')
          .map((n) => (n.nodeType === 3 ? escapeHtml(n.nodeValue) : n.outerHTML))
          .join('');

    if (currentType === listType) {
      // Toggle off back to normal paragraph
      const p = doc.createElement('p');
      p.innerHTML = innerHtml || '<br>';
      parentList.parentNode.insertBefore(p, parentList.nextSibling);
      existingLi.remove();
      if (!parentList.querySelector('li')) parentList.remove();
      setCaretInsideElement(p, true);
      return true;
    }

    // Convert current list type to target listType
    const newList = makeListEl(listType);
    Array.from(parentList.children).forEach((childLi) => {
      if (childLi.nodeName !== 'LI') return;
      const childNested = Array.from(childLi.children).filter(
        (ch) => ch.nodeName === 'UL' || ch.nodeName === 'OL'
      );
      const childTextEl = childLi.querySelector(':scope > .hd-checklist-text');
      const childHtml = childTextEl
        ? childTextEl.innerHTML
        : Array.from(childLi.childNodes)
            .filter((n) => n.nodeName !== 'UL' && n.nodeName !== 'OL')
            .map((n) => (n.nodeType === 3 ? escapeHtml(n.nodeValue) : n.outerHTML))
            .join('');
      const nextLi =
        listType === 'checklist'
          ? createChecklistLi(doc, childHtml || '<br>', childLi.getAttribute('data-checked') === 'true')
          : doc.createElement('li');
      if (listType !== 'checklist') nextLi.innerHTML = childHtml || '<br>';
      childNested.forEach((nl) => nextLi.appendChild(nl));
      newList.appendChild(nextLi);
    });
    parentList.replaceWith(newList);
    const targetLi = newList.lastElementChild || newList.firstElementChild;
    setCaretInsideElement(
      listType === 'checklist' ? targetLi?.querySelector('.hd-checklist-text') : targetLi,
      true
    );
    return true;
  }

  // Convert current paragraph/heading block into a list
  const block = getEditableTopBlock(range.startContainer, editorEl);
  const list = makeListEl(listType);
  const contentHtml = block && block !== editorEl ? block.innerHTML : '<br>';
  const li =
    listType === 'checklist'
      ? createChecklistLi(doc, contentHtml || '<br>', false)
      : doc.createElement('li');
  if (listType !== 'checklist') li.innerHTML = contentHtml || '<br>';
  list.appendChild(li);

  if (block && block !== editorEl && block.parentNode) {
    block.replaceWith(list);
  } else {
    editorEl.appendChild(list);
  }

  setCaretInsideElement(
    listType === 'checklist' ? li.querySelector('.hd-checklist-text') : li,
    true
  );
  return true;
}

/**
 * Multi-level list indentation (`Tab` to indent right, `Shift+Tab` to outdent left).
 */
export function indentListItem(editorEl, savedRange, direction = 'indent') {
  if (!editorEl) return false;
  const range = getActiveRangeInEditor(editorEl, savedRange);
  if (!range) return false;

  const li = getClosestListItem(range.startContainer, editorEl);
  if (!li) return false;

  const parentList = li.parentElement;
  if (!parentList || (parentList.nodeName !== 'UL' && parentList.nodeName !== 'OL')) return false;

  const focusTarget = li.querySelector(':scope > .hd-checklist-text') || li;

  if (direction === 'indent') {
    const prevLi = li.previousElementSibling;
    if (!prevLi || prevLi.nodeName !== 'LI') return false;

    let subList = Array.from(prevLi.children).find(
      (ch) => ch.nodeName === parentList.nodeName && ch.className === parentList.className
    );
    if (!subList) {
      subList = editorEl.ownerDocument.createElement(parentList.nodeName.toLowerCase());
      if (parentList.className) subList.className = parentList.className;
      prevLi.appendChild(subList);
    }
    subList.appendChild(li);
    setCaretInsideElement(focusTarget, true);
    return true;
  }

  // Outdent (`Shift+Tab`): lift `li` out of nested list into grandparent list (or to `<p>` if already top-level)
  const grandParentLi = parentList.parentElement;
  if (grandParentLi && grandParentLi.nodeName === 'LI' && grandParentLi.parentElement) {
    // Move any following siblings in `parentList` into a child sublist of `li` to preserve hierarchy
    const trailingSiblings = [];
    let next = li.nextElementSibling;
    while (next) {
      trailingSiblings.push(next);
      next = next.nextElementSibling;
    }
    if (trailingSiblings.length > 0) {
      const childList = editorEl.ownerDocument.createElement(parentList.nodeName.toLowerCase());
      if (parentList.className) childList.className = parentList.className;
      trailingSiblings.forEach((sib) => childList.appendChild(sib));
      li.appendChild(childList);
    }

    grandParentLi.parentElement.insertBefore(li, grandParentLi.nextSibling);
    if (!parentList.querySelector('li')) parentList.remove();
    setCaretInsideElement(focusTarget, true);
    return true;
  }

  // Already at top level: convert to paragraph below list
  const p = editorEl.ownerDocument.createElement('p');
  const textEl = li.querySelector(':scope > .hd-checklist-text');
  p.innerHTML = textEl ? textEl.innerHTML : li.innerHTML;
  if (!p.innerHTML.trim()) p.innerHTML = '<br>';
  parentList.parentNode.insertBefore(p, parentList.nextSibling);
  li.remove();
  if (!parentList.querySelector('li')) parentList.remove();
  setCaretInsideElement(p, true);
  return true;
}

/**
 * Insert a structured Callout / Summary Box at the active cursor position.
 */
export function insertCalloutBlock(editorEl, savedRange, defaultText = '') {
  if (!editorEl) return false;
  const doc = editorEl.ownerDocument;
  const range = getActiveRangeInEditor(editorEl, savedRange);

  const callout = doc.createElement('div');
  callout.className = 'hd-callout';
  callout.setAttribute('data-callout', 'note');

  const icon = doc.createElement('span');
  icon.className = 'hd-callout-icon';
  icon.setAttribute('contenteditable', 'false');
  icon.textContent = '💡';

  const body = doc.createElement('div');
  body.className = 'hd-callout-body';
  const p = doc.createElement('p');

  const block = range ? getEditableTopBlock(range.startContainer, editorEl) : null;
  const blockText = block && block !== editorEl && !block.classList?.contains('hd-callout') ? block.textContent.trim() : '';

  if (block && block !== editorEl && block.nodeName === 'P' && !blockText) {
    p.textContent = defaultText || '';
    if (!defaultText) p.innerHTML = '<br>';
    body.appendChild(p);
    callout.appendChild(icon);
    callout.appendChild(body);
    block.replaceWith(callout);
  } else {
    p.textContent = defaultText || '';
    if (!defaultText) p.innerHTML = '<br>';
    body.appendChild(p);
    callout.appendChild(icon);
    callout.appendChild(body);
    if (block && block !== editorEl && block.parentNode) {
      block.parentNode.insertBefore(callout, block.nextSibling);
    } else {
      editorEl.appendChild(callout);
    }
  }

  editorEl.focus();
  const sel = window.getSelection();
  if (sel) {
    const r = doc.createRange();
    r.selectNodeContents(p);
    if (!defaultText) r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  return true;
}

/**
 * Handle Enter key cleanly inside interactive checklist items:
 *  - On non-empty item: inserts a new unchecked checklist item right below.
 *  - On empty item: exits the checklist into a normal `<p>`.
 */
export function handleChecklistEnter(editorEl) {
  if (!editorEl) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const li = getClosestListItem(range.startContainer, editorEl);
  if (!li || !li.classList.contains('hd-checklist-item')) return false;

  const doc = editorEl.ownerDocument;
  const textEl = li.querySelector(':scope > .hd-checklist-text');
  const currentText = (textEl ? textEl.textContent : li.textContent || '').trim();

  if (!currentText) {
    // Exit checklist on empty item
    const parentList = li.parentElement;
    const p = doc.createElement('p');
    p.innerHTML = '<br>';
    if (parentList.parentElement?.nodeName === 'LI') {
      // Nested empty item: outdent instead of breaking out completely
      return indentListItem(editorEl, range, 'outdent');
    }
    parentList.parentNode.insertBefore(p, parentList.nextSibling);
    li.remove();
    if (!parentList.querySelector('li')) parentList.remove();
    setCaretInsideElement(p, true);
    return true;
  }

  const nextLi = createChecklistLi(doc, '<br>', false);
  li.parentElement.insertBefore(nextLi, li.nextSibling);
  setCaretInsideElement(nextLi.querySelector('.hd-checklist-text'), true);
  return true;
}

/**
 * Insert a rendered KaTeX math chip (`$...$` inline or `$$...$$` display block)
 * directly at the active cursor position inside the WYSIWYG Note editor.
 * Places the caret cleanly right after the inserted formula so typing continues seamlessly.
 */
export function insertMathChipAtSelection(editorEl, savedRange, latex, displayMode = false) {
  if (!editorEl) return false;
  const cleanLatex = String(latex || '').trim();
  if (!cleanLatex) return false;

  const doc = editorEl.ownerDocument;
  const temp = doc.createElement('div');
  temp.innerHTML = renderMathChipHtml(cleanLatex, displayMode);
  const chipEl = temp.firstElementChild;
  if (!chipEl) return false;

  const sel = window.getSelection();
  let range = getActiveRangeInEditor(editorEl, savedRange);

  if (displayMode) {
    const block = range ? getEditableTopBlock(range.startContainer, editorEl) : null;
    const afterP = doc.createElement('p');
    afterP.innerHTML = '<br>';

    if (block && block !== editorEl && block.parentNode) {
      block.parentNode.insertBefore(chipEl, block.nextSibling);
      chipEl.parentNode.insertBefore(afterP, chipEl.nextSibling);
    } else {
      editorEl.appendChild(chipEl);
      editorEl.appendChild(afterP);
    }

    editorEl.focus();
    setCaretInsideElement(afterP, true);
    return true;
  }

  // Inline math chip insertion at exact caret position
  if (!range) {
    let targetP = editorEl.lastElementChild;
    if (!targetP || targetP.nodeName !== 'P') {
      targetP = doc.createElement('p');
      editorEl.appendChild(targetP);
    }
    targetP.appendChild(chipEl);
    const trailingSpace = doc.createTextNode(' ');
    targetP.appendChild(trailingSpace);
    editorEl.focus();
    if (sel) {
      const nextRange = doc.createRange();
      nextRange.setStart(trailingSpace, trailingSpace.nodeValue.length);
      nextRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nextRange);
    }
    return true;
  }

  // If caret is inside a non-editable math chip, insert immediately after it
  if (isInsideNonEditable(range.startContainer, editorEl)) {
    const mathAncestor =
      (range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement
      )?.closest?.('[data-latex]');
    if (mathAncestor && mathAncestor.parentNode) {
      range = doc.createRange();
      range.setStartAfter(mathAncestor);
      range.collapse(true);
    }
  }

  range.deleteContents();
  range.insertNode(chipEl);
  const trailingSpace = doc.createTextNode(' ');
  chipEl.parentNode.insertBefore(trailingSpace, chipEl.nextSibling);

  editorEl.focus();
  if (sel) {
    const nextRange = doc.createRange();
    nextRange.setStart(trailingSpace, trailingSpace.nodeValue.length);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
  }
  return true;
}

/**
 * Place caret immediately before or after an atomic inline `.hd-eq` widget in normal text.
 */
function exitInlineEq(editorEl, eqEl, side = 'after') {
  if (!editorEl || !eqEl || !eqEl.parentNode) return;
  const doc = editorEl.ownerDocument;
  const sel = window.getSelection();
  if (!sel) return;

  editorEl.focus({ preventScroll: true });

  if (side === 'after') {
    let nextNode = eqEl.nextSibling;
    if (!nextNode || nextNode.nodeType !== 3 || !nextNode.nodeValue) {
      nextNode = doc.createTextNode('\u00A0');
      eqEl.parentNode.insertBefore(nextNode, eqEl.nextSibling);
    }
    const r = doc.createRange();
    r.setStart(nextNode, nextNode.nodeValue.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  } else {
    let prevNode = eqEl.previousSibling;
    if (!prevNode || prevNode.nodeType !== 3) {
      prevNode = doc.createTextNode('');
      eqEl.parentNode.insertBefore(prevNode, eqEl);
    }
    const r = doc.createRange();
    r.setStart(prevNode, prevNode.nodeValue.length);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}

/**
 * Insert an atomic recursive Desmos-style visual formula widget (`.inline-formula-node.hd-eq`):
 *  - If the user is currently focused inside an existing formula's `<input class="hd-seg">` slot,
 *    inserts the new formula **nested inside that active slot** infinitely deep!
 *  - Otherwise inserts a new root `.hd-eq` widget at the caret in normal prose and focuses its first slot.
 */
export function insertInteractiveEqAtSelection(editorEl, savedRange, eqType, fallbackSlotEl = null) {
  if (!editorEl || !eqType) return false;
  const normalizedType = normalizeNodeType(eqType);
  const doc = editorEl.ownerDocument;

  // 1. Check if focused inside an existing formula slot -> NEST inside that active slot!
  const activeEl = doc.activeElement;
  const activeSeg =
    activeEl &&
    activeEl.tagName === 'INPUT' &&
    activeEl.classList.contains('hd-seg') &&
    editorEl.contains(activeEl)
      ? activeEl
      : fallbackSlotEl &&
          fallbackSlotEl.isConnected &&
          fallbackSlotEl.tagName === 'INPUT' &&
          fallbackSlotEl.classList.contains('hd-seg') &&
          editorEl.contains(fallbackSlotEl)
        ? fallbackSlotEl
        : null;

  if (activeSeg) {
    return insertNestedNodeAtSeg(activeSeg, normalizedType);
  }

  // 2. Otherwise insert a new root recursive `.hd-eq` widget at the document cursor
  const initialChild = createMathNode(normalizedType);
  if (!initialChild) return false;
  const eqEl = createMathWidgetElement(doc, createRootExprTree(initialChild));
  if (!eqEl) return false;

  let range = getActiveRangeInEditor(editorEl, savedRange);
  if (range) {
    const startNode =
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement;
    const existingFormula = startNode?.closest?.('.inline-formula-node, .hd-eq, [data-latex]');
    if (existingFormula && editorEl.contains(existingFormula)) {
      range = doc.createRange();
      range.setStartAfter(existingFormula);
      range.collapse(true);
    }
  }

  if (!range) {
    let targetP = editorEl.lastElementChild;
    if (!targetP || targetP.nodeName !== 'P') {
      targetP = doc.createElement('p');
      editorEl.appendChild(targetP);
    }
    targetP.appendChild(eqEl);
    targetP.appendChild(doc.createTextNode('\u00A0'));
  } else {
    range.deleteContents();
    range.insertNode(eqEl);
    const afterSpace = doc.createTextNode('\u00A0');
    eqEl.parentNode.insertBefore(afterSpace, eqEl.nextSibling);
  }

  // Focus the first inner slot of the newly inserted formula node (not the empty root boundary seg)
  const firstChildNode = eqEl.querySelector('.hd-node');
  const firstSlot = firstChildNode
    ? findSlotFirstSeg(firstChildNode, 0)
    : eqEl.querySelector('input.hd-seg');
  if (firstSlot) {
    focusSegInput(firstSlot, firstSlot.value.length);
  }

  return true;
}

/**
 * Convert a clicked static KaTeX chip (`[data-latex]:not(.hd-eq)`) inside a Note into a
 * live editable recursive `.hd-eq` widget so saved/imported formulas can be nested & edited.
 */
export function convertStaticMathChipToInteractive(editorEl, chipEl, savedMathNodes = null) {
  if (!editorEl || !chipEl || !editorEl.contains(chipEl)) return false;
  if (chipEl.classList.contains('hd-eq')) return false;
  const latex = (chipEl.getAttribute('data-latex') || '').trim();
  if (!latex) return false;

  const doc = editorEl.ownerDocument;
  const tree = savedMathNodes?.[latex] || parseLatexToMathTree(latex);
  const eqEl = createMathWidgetElement(doc, tree);
  if (!eqEl) return false;

  chipEl.replaceWith(eqEl);
  const firstNode = eqEl.querySelector('.hd-node');
  const targetSeg = firstNode ? findSlotFirstSeg(firstNode, 0) : eqEl.querySelector('input.hd-seg');
  if (targetSeg) {
    focusSegInput(targetSeg, targetSeg.value.length);
  }
  return true;
}

/**
 * Insert a single math/science symbol cleanly:
 *  - If caret is inside a focused native `<input class="hd-seg">`, inserts the symbol glyph
 *    directly into that slot input without touching the parent `contentEditable` DOM.
 *  - Otherwise inserts an atomic KaTeX chip directly at the cursor and places the caret right after it.
 */
export function insertSymbolAtSelection(
  editorEl,
  savedRange,
  latex,
  inlineGlyph = '',
  fallbackSlotEl = null
) {
  if (!editorEl) return false;
  const doc = editorEl.ownerDocument;
  const activeEl = doc.activeElement;
  const activeSeg =
    activeEl &&
    activeEl.tagName === 'INPUT' &&
    activeEl.classList.contains('hd-seg') &&
    editorEl.contains(activeEl)
      ? activeEl
      : fallbackSlotEl &&
          fallbackSlotEl.isConnected &&
          fallbackSlotEl.tagName === 'INPUT' &&
          fallbackSlotEl.classList.contains('hd-seg') &&
          editorEl.contains(fallbackSlotEl)
        ? fallbackSlotEl
        : null;

  if (activeSeg && inlineGlyph) {
    const start = activeSeg.selectionStart ?? activeSeg.value.length;
    const end = activeSeg.selectionEnd ?? start;
    const nextVal = activeSeg.value.slice(0, start) + inlineGlyph + activeSeg.value.slice(end);
    activeSeg.value = nextVal;
    syncSlotInputSize(activeSeg);
    const nextCaret = start + inlineGlyph.length;
    focusSegInput(activeSeg, nextCaret);
    return true;
  }

  return insertMathChipAtSelection(editorEl, savedRange, latex, false);
}

/**
 * Smooth, zero-flicker Desmos keyboard shortcuts & navigation inside recursive `.hd-eq` widgets:
 *  - `/` wraps preceding term into fraction numerator and moves focus into denominator.
 *  - `^` creates inline superscript exponent; `_` creates inline subscript.
 *  - `ArrowRight` / `ArrowLeft` steps smoothly into & out of child slots.
 *  - `Tab` / `Shift+Tab` / `Enter` / `Escape` jumps across slots or exits cleanly.
 *  - `Backspace` on an empty slot cleanly unwraps/deletes that nested block without flickering.
 *
 * Returns `{ handled: boolean, mutated: boolean }`.
 */
export function handleInlineEqKeyDown(editorEl, e) {
  return handleRecursiveMathKeyDown(editorEl, e, exitInlineEq);
}

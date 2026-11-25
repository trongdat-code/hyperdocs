/**
 * Smart Exam & Study Document Paragraph Formatter (`formatImportedText`)
 *
 * Post-processes imported Google Docs / document Markdown so paragraphs,
 * Vietnamese problem headers (`Câu 1:`, `Câu 28:`, `Bài 1:`, `Phần I:`),
 * and sub-question markers (`a)`, `b)`, `c)`, `d)`) preserve crisp spacing
 * and line breaks without collapsing in CommonMark/GFM renderers, while
 * keeping Markdown lists, tables, blockquotes, fenced code blocks, and
 * `$$...$$` display math blocks completely intact.
 */

// Vietnamese & English problem headers (optionally wrapped in bold/italic markers)
const PROBLEM_HEADER_PATTERN =
  '(?:\\*{1,2}|_{1,2})?' +
  '(?:Câu|CÂU|Bài(?:[ \\t]+(?:tập|Tập|TẬP))?|BÀI(?:[ \\t]+TẬP)?|Phần|PHẦN|Chương|CHƯƠNG|Mục|MỤC|Ví[ \\t]+(?:dụ|Dụ|DỤ)|VÍ[ \\t]+DỤ|Đề|ĐỀ|Question|QUESTION|Problem|PROBLEM|Part|PART)' +
  '[ \\t]+(?:\\d+[a-zA-Z]?|[IVXLCDM]+|[A-Z](?=[ \\t]*[:.)\\-–—]|(?:\\*{1,2}|_{1,2})))' +
  '(?:[ \\t]*\\([^)\\n]{1,40}\\))?' +
  '(?:\\*{1,2}|_{1,2})?' +
  '[ \\t]*[:.\\-–—)]';

// Sub-question markers such as a), b), c), d), A), B), C), D), ii), iii), iv)
const SUB_QUESTION_PATTERN =
  '(?:\\*{1,2}|_{1,2})?' +
  '(?:[a-z]|[A-D]|ii|iii|iv)' +
  '(?:\\*{1,2}|_{1,2})?' +
  '\\)' +
  '(?:\\*{1,2}|_{1,2})?' +
  '(?=[ \\t]+\\S)';

// Sentence-ending punctuation (. ? : ) !) optionally followed by closing quotes or emphasis,
// followed by horizontal whitespace and a problem header or sub-question marker.
const MIDLINE_PROBLEM_HEADER_RE = new RegExp(
  `([.?:)!]['"”’*_]{0,2})[ \\t]+(?=${PROBLEM_HEADER_PATTERN})`,
  'gu'
);

const MIDLINE_SUB_QUESTION_RE = new RegExp(
  `([.?:)!]['"”’*_]{0,2})[ \\t]+(?=${SUB_QUESTION_PATTERN})`,
  'gu'
);

const LINE_START_PROBLEM_OR_SUB_RE = new RegExp(
  `^[ \\t]*(?:${PROBLEM_HEADER_PATTERN}|${SUB_QUESTION_PATTERN})`,
  'u'
);

function isTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Standard GFM table row `| ... |` or table delimiter `--- | ---`
  if (/^\|.*\|$/.test(trimmed)) return true;
  if (/^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed) && trimmed.includes('-')) return true;
  return false;
}

function isMarkdownListItem(line) {
  // CommonMark unordered list (`- `, `* `, `+ `) or numeric ordered list (`1. `, `1) `)
  return /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/.test(line);
}

function isBlockquoteLine(line) {
  return /^[ \t]*>/.test(line);
}

function isHeadingLine(line) {
  return /^[ \t]*#{1,6}[ \t]+\S/.test(line);
}

function isHorizontalRule(line) {
  return /^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/.test(line);
}

function isLinkRefDefinition(line) {
  return /^[ \t]*\[[^\]]+\]:[ \t]+\S/.test(line);
}

function isBlockPlaceholder(line) {
  return /^[ \t]*\uE010BLOCK_\d+\uE011[ \t]*$/.test(line);
}

function isIndentedContinuation(line) {
  return /^(?:[ ]{2,}|\t+)\S/.test(line);
}

/**
 * Format imported text/Markdown from Google Docs into clean, paragraph-separated Markdown.
 */
export function formatImportedText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  // 1. Normalize line endings and invisible whitespace characters
  let text = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');

  // 2. Mask multi-line protected blocks first: fenced code blocks & display math blocks
  const blockPlaceholders = [];
  text = text.replace(
    /```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]*?\$\$|(?:\\{1,2}\$){2}[\s\S]*?(?:\\{1,2}\$){2}|\\{1,2}\[[\s\S]*?\\{1,2}\]/g,
    (match) => {
      const idx = blockPlaceholders.length;
      blockPlaceholders.push(match);
      return `\uE010BLOCK_${idx}\uE011`;
    }
  );

  // 3. Mask inline code spans and inline math so mid-line splitting never touches them
  const inlinePlaceholders = [];
  text = text.replace(
    /`[^`\n]+`|(?<!\$)\$(?!\$)[^\n$]+?(?<!\$)\$(?!\$)|\\{1,2}\([^\n]*?\\{1,2}\)/g,
    (match) => {
      const idx = inlinePlaceholders.length;
      inlinePlaceholders.push(match);
      return `\uE012INLINE_${idx}\uE013`;
    }
  );

  // Remove Google Docs single-backslash hard line-break artifacts (`\` right before `\n`)
  // while leaving double backslashes (`\\`) untouched.
  text = text.replace(/(?<!\\)\\[ \t]*\n/g, '\n');

  // 4. Insert clear paragraph breaks (\n\n) before Vietnamese problem headers & sub-question markers
  //    when they follow a sentence-ending punctuation mark (., ?, :, ), !) on the same line.
  const splitLines = text.split('\n').map((rawLine) => {
    const line = rawLine.replace(/[ \t]+$/g, '');
    if (!line.trim() || isTableLine(line) || isBlockPlaceholder(line)) {
      return line;
    }

    let formatted = line.replace(MIDLINE_PROBLEM_HEADER_RE, '$1\n\n');
    formatted = formatted.replace(MIDLINE_SUB_QUESTION_RE, '$1\n\n');
    return formatted;
  });

  // Re-split after mid-line paragraph insertions
  const expandedLines = splitLines.join('\n').split('\n');

  // 5. Convert single line breaks (\n) between distinct sentences/paragraphs into double newlines (\n\n)
  //    while keeping Markdown lists, tables, blockquotes, and link reference definitions intact.
  const output = [];
  let inListContext = false;

  for (let i = 0; i < expandedLines.length; i++) {
    const line = expandedLines[i].replace(/[ \t]+$/g, '');
    const trimmed = line.trim();

    if (!trimmed) {
      inListContext = false;
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (output.length === 0 || output[output.length - 1] === '') {
      output.push(line);
      inListContext = isMarkdownListItem(line);
      continue;
    }

    const prev = output[output.length - 1];

    const keepSingleNewline =
      // Keep consecutive Markdown table rows together
      (isTableLine(prev) && isTableLine(line)) ||
      // Keep consecutive Markdown list items together
      (isMarkdownListItem(prev) && isMarkdownListItem(line)) ||
      // Keep indented continuation lines inside a list item (unless starting a new header/sub-item/block)
      (inListContext &&
        isIndentedContinuation(line) &&
        !isTableLine(line) &&
        !isHeadingLine(line) &&
        !isHorizontalRule(line) &&
        !isBlockPlaceholder(line) &&
        !LINE_START_PROBLEM_OR_SUB_RE.test(line)) ||
      // Keep consecutive blockquote lines together (unless a new problem header/sub-item begins)
      (isBlockquoteLine(prev) && isBlockquoteLine(line)) ||
      // Keep consecutive reference-style link definitions together
      (isLinkRefDefinition(prev) && isLinkRefDefinition(line));

    if (!keepSingleNewline) {
      output.push('');
    }

    output.push(line);

    if (isMarkdownListItem(line)) {
      inListContext = true;
    } else if (!keepSingleNewline) {
      inListContext = false;
    }
  }

  // Collapse excess blank lines before restoring protected multi-line blocks
  let result = output
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 6. Restore inline code & inline math placeholders
  result = result.replace(/\uE012INLINE_(\d+)\uE013/g, (_m, idx) => inlinePlaceholders[Number(idx)]);

  // 7. Restore fenced code & display math block placeholders
  result = result.replace(/\uE010BLOCK_(\d+)\uE011/g, (_m, idx) => blockPlaceholders[Number(idx)]);

  return result.trim();
}

export default formatImportedText;

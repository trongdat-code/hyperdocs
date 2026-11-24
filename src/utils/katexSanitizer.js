/**
 * Math & Chemistry KaTeX Sanitizer for Google Docs & DOCX Imported Markdown
 *
 * `sanitizeImportedMarkdown(rawText)`:
 *  1. Preserves fenced code blocks and inline code spans untouched.
 *  2. Unescapes Google Docs / Turndown escaped LaTeX delimiters
 *     (`\$` -> `$`, `\\(` -> `$`, `\\)` -> `$`, `\\[` -> `$$`, `\\]` -> `$$`)
 *     and fixes double-escaped LaTeX commands (`\\frac` -> `\frac`, etc.) inside math blocks.
 *  3. Converts unformatted chemical formulas, hydrates, and ions outside math, code,
 *     URLs, and Markdown headings into valid inline KaTeX
 *     (e.g., `H2SO4` -> `$\text{H}_2\text{SO}_4$`,
 *            `CuSO4.5H2O` -> `$\text{CuSO}_4\cdot 5\text{H}_2\text{O}$`,
 *            `Fe3+` -> `$\text{Fe}^{3+}$`,
 *            `SO4^2-` -> `$\text{SO}_4^{2-}$`)
 *     without altering normal Vietnamese/English prose or headings.
 *  4. Cleans up redundant blank lines and broken list indentation from Google Docs exports.
 */

const ELEMENTS = new Set([
  'H', 'He',
  'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn',
  'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu',
]);

// Common diatomic/triatomic pure-element formulas allowed without a second element
const PURE_ELEMENT_MOLECULES = new Set(['H2', 'O2', 'O3', 'N2', 'F2', 'Cl2', 'Br2', 'I2', 'P4', 'S8']);

// Common simple monoatomic/polyatomic single-charge ions without numeric coefficient
const SIMPLE_UNIT_IONS = new Set([
  'H+', 'Li+', 'Na+', 'K+', 'Ag+', 'Cu+', 'NH4+', 'H3O+',
  'OH-', 'F-', 'Cl-', 'Br-', 'I-', 'CN-', 'NO2-', 'NO3-', 'HCO3-', 'HSO4-', 'HSO3-',
  'MnO4-', 'ClO-', 'ClO3-', 'ClO4-', 'CH3COO-', 'AlO2-', 'HS-', 'H2PO4-',
]);

/**
 * Parse a single chemical formula segment (no hydrate dot, no trailing charge)
 * into `{ valid, elementCount, hasDigitOrGroup, latex }`.
 */
function parseChemicalCore(segment) {
  if (!segment) return { valid: false };
  let i = 0;
  let elementCount = 0;
  let hasDigitOrGroup = false;
  let parenDepth = 0;
  let latex = '';
  let textRun = '';

  const flushText = () => {
    if (textRun) {
      latex += `\\text{${textRun}}`;
      textRun = '';
    }
  };

  while (i < segment.length) {
    const ch = segment[i];

    if (ch === '(' || ch === '[') {
      flushText();
      parenDepth += 1;
      hasDigitOrGroup = true;
      latex += ch;
      i += 1;
      continue;
    }

    if (ch === ')' || ch === ']') {
      if (parenDepth === 0) return { valid: false };
      flushText();
      parenDepth -= 1;
      latex += ch;
      i += 1;
      // Optional subscript after closing parenthesis
      let num = '';
      while (i < segment.length && /[0-9]/.test(segment[i])) {
        num += segment[i];
        i += 1;
      }
      if (num) {
        hasDigitOrGroup = true;
        latex += num.length > 1 ? `_{${num}}` : `_${num}`;
      }
      continue;
    }

    // Match 2-letter or 1-letter valid element symbol
    if (/[A-Z]/.test(ch)) {
      let sym = '';
      if (i + 1 < segment.length && /[a-z]/.test(segment[i + 1]) && ELEMENTS.has(segment.slice(i, i + 2))) {
        sym = segment.slice(i, i + 2);
        i += 2;
      } else if (ELEMENTS.has(ch)) {
        sym = ch;
        i += 1;
      } else {
        return { valid: false };
      }

      elementCount += 1;
      textRun += sym;

      let num = '';
      while (i < segment.length && /[0-9]/.test(segment[i])) {
        num += segment[i];
        i += 1;
      }
      if (num) {
        hasDigitOrGroup = true;
        flushText();
        latex += num.length > 1 ? `_{${num}}` : `_${num}`;
      }
      continue;
    }

    return { valid: false };
  }

  if (parenDepth !== 0 || elementCount === 0) return { valid: false };
  flushText();

  return {
    valid: true,
    elementCount,
    hasDigitOrGroup,
    latex,
  };
}

/**
 * Attempt to format a candidate token into inline KaTeX chemistry notation.
 * Returns null if the token is ordinary text / code / non-chemical abbreviation.
 */
function formatChemicalToken(token) {
  if (!token || token.length < 2) return null;

  // 1. Hydrates: e.g., CuSO4.5H2O, FeSO4·7H2O, Na2CO3.10H2O
  if (/[.·]/.test(token)) {
    const hydrateMatch = token.match(/^([A-Za-z0-9()[\]]+)[.·](\d*)([A-Za-z0-9()[\]]+)$/);
    if (!hydrateMatch) return null;
    const [, leftRaw, coeff, rightRaw] = hydrateMatch;
    const left = parseChemicalCore(leftRaw);
    const right = parseChemicalCore(rightRaw);
    if (!left.valid || !right.valid) return null;
    if (!left.hasDigitOrGroup && left.elementCount < 2) return null;
    if (!right.hasDigitOrGroup && right.elementCount < 2) return null;
    const coeffStr = coeff ? `${coeff}` : '';
    return `$${left.latex}\\cdot ${coeffStr}${right.latex}$`;
  }

  // 2. Ions with explicit caret charge: e.g., SO4^2-, Fe^3+, Cr2O7^2-, NH4^+, Cu^{2+}
  const caretIonMatch = token.match(/^([A-Za-z0-9()[\]]+)\^\{?([0-9]*[+-])\}?$/);
  if (caretIonMatch) {
    const [, coreRaw, charge] = caretIonMatch;
    const core = parseChemicalCore(coreRaw);
    if (!core.valid) return null;
    return `$${core.latex}^{${charge}}$`;
  }

  // 3. Ions with trailing charge without caret: e.g., Fe3+, Cu2+, Al3+, NH4+, OH-, SO42-?
  const trailingIonMatch = token.match(/^([A-Za-z0-9()[\]]+?)([0-9]*)([+-])$/);
  if (trailingIonMatch) {
    const [, basePart, chargeNum, sign] = trailingIonMatch;

    // Exact match for well-known unit ions (e.g., NH4+, OH-, Cl-, H+, NO3-, MnO4-)
    if (SIMPLE_UNIT_IONS.has(token)) {
      const core = parseChemicalCore(token.slice(0, -1));
      if (core.valid) {
        return `$${core.latex}^{${sign}}$`;
      }
    }

    // Monoatomic / multi-charge ion like Fe3+, Fe2+, Cu2+, Al3+, Mg2+, Ca2+, Zn2+, S2-, O2-, N3-
    if (chargeNum && /^[1-7]$/.test(chargeNum)) {
      // Check if basePart is a single element (e.g., Fe3+, Cu2+, S2-)
      if (ELEMENTS.has(basePart)) {
        return `$\\text{${basePart}}^{${chargeNum}${sign}}$`;
      }
      // Or polyatomic ion where basePart ends with a subscript before charge (rare without ^, e.g. CO3^2- handled above)
      const fullCore = parseChemicalCore(basePart);
      if (fullCore.valid && fullCore.elementCount >= 2 && fullCore.hasDigitOrGroup) {
        return `$${fullCore.latex}^{${chargeNum}${sign}}$`;
      }
    }

    // Polyatomic unit ion like H2PO4-, HSO4-
    if (!chargeNum) {
      const core = parseChemicalCore(basePart);
      if (core.valid && core.elementCount >= 2 && core.hasDigitOrGroup) {
        return `$${core.latex}^{${sign}}$`;
      }
    }

    return null;
  }

  // 4. Neutral chemical formulas: e.g., H2SO4, H2O, CO2, Ca(OH)2, Fe2(SO4)3, CH3COOH, O2, Cl2
  if (PURE_ELEMENT_MOLECULES.has(token)) {
    const core = parseChemicalCore(token);
    return core.valid ? `$${core.latex}$` : null;
  }

  // Require at least 2 elements AND at least one digit or parenthesis group to avoid false positives on prose/codes
  const core = parseChemicalCore(token);
  if (core.valid && core.elementCount >= 2 && core.hasDigitOrGroup) {
    return `$${core.latex}$`;
  }

  return null;
}

/**
 * Fix double-escaped LaTeX commands and markdown-escaped symbols inside a math body.
 */
function cleanMathBody(body) {
  let cleaned = body;

  // Fix double-escaped LaTeX commands (e.g., \\frac -> \frac, \\rightarrow -> \rightarrow, \\Delta -> \Delta)
  // Does NOT touch row breaks like `\\ ` or `\\\n` or `\\[4pt]`
  cleaned = cleaned.replace(/\\\\([a-zA-Z]+)/g, '\\$1');

  // Fix Markdown-escaped math operators commonly introduced by Google Docs / Turndown
  cleaned = cleaned
    .replace(/\\_/g, '_')
    .replace(/\\\^/g, '^')
    .replace(/\\\*/g, '*')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\\~/g, '~');

  return cleaned;
}

/**
 * Unescape Google Docs / Turndown escaped LaTeX delimiters and normalize math blocks.
 */
function normalizeMathDelimiters(text) {
  let out = text;

  // 1. Display math delimiters: \\[...] or \[...\] -> $$...$$
  out = out.replace(/\\{1,2}\[([\s\S]*?)\\{1,2}\]/g, (_m, inner) => {
    const body = cleanMathBody(inner.trim());
    return `\n$$\n${body}\n$$\n`;
  });

  // 2. Inline math delimiters: \\(...\\) or \(...\) -> $...$
  out = out.replace(/\\{1,2}\(([^\n]*?)\\{1,2}\)/g, (_m, inner) => {
    const body = cleanMathBody(inner.trim());
    return `$${body}$`;
  });

  // 3. Escaped display dollar blocks: \$\$...\$\$ or \\$\\$...\\$\\$ -> $$...$$
  out = out.replace(/(?:\\{1,2}\$){2}([\s\S]*?)(?:\\{1,2}\$){2}/g, (_m, inner) => {
    const body = cleanMathBody(inner.trim());
    return `\n$$\n${body}\n$$\n`;
  });

  // 4. Escaped inline dollar pairs on the same line: \$...\$ -> $...$
  // Guard: require non-empty content not starting/ending with space so literal prices like `\$10 and \$20` don't merge
  out = out.replace(/\\{1,2}\$([^\s$\n](?:[^$\n]*?[^\s$\\])?)\\{1,2}\$/g, (match, inner) => {
    // Skip obvious currency range prose like `$10 to $20` where inner starts with digits + words
    if (/^\d[\d,.]*\s+(?:to|and|or|đến|và|hoặc|per|mỗi)\s*$/i.test(inner)) {
      return match;
    }
    const body = cleanMathBody(inner.trim());
    return `$${body}$`;
  });

  // 5. Clean existing unescaped $$...$$ display math blocks
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => {
    const body = cleanMathBody(inner.trim());
    return `$$\n${body}\n$$`;
  });

  // 6. Clean existing unescaped $...$ inline math blocks
  out = out.replace(/(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)/g, (_m, inner) => {
    const body = cleanMathBody(inner);
    return `$${body}$`;
  });

  return out;
}

/**
 * Convert unformatted chemical formulas & ions in plain prose lines (skipping headings & URLs).
 */
function convertChemistryInProse(text) {
  const lines = text.split('\n');

  return lines
    .map((line) => {
      // Never alter Markdown headings
      if (/^\s*#{1,6}\s+/.test(line)) {
        return line;
      }

      // Mask URLs and markdown link destinations `](...)` inside this line
      const urlPlaceholders = [];
      const maskedLine = line.replace(
        /(https?:\/\/[^\s)\]]+|\]\([^)]+\))/g,
        (match) => {
          const idx = urlPlaceholders.length;
          urlPlaceholders.push(match);
          return `\uE002URL${idx}\uE003`;
        }
      );

      // Match candidate chemical tokens bounded by non-letter/non-digit characters (Unicode-aware for Vietnamese!)
      const replaced = maskedLine.replace(
        /(?<![\p{L}\p{N}_])([A-Z][A-Za-z0-9()[\].·^+-]*[A-Za-z0-9)\]+-])(?![\p{L}\p{N}_])/gu,
        (fullMatch, candidate) => {
          // Strip trailing punctuation accidentally captured (e.g., period at end of sentence)
          let core = candidate;
          let trailing = '';
          while (/[.,;:!?)]$/.test(core)) {
            // Keep closing paren if balanced with an opening paren inside the formula
            if (core.endsWith(')')) {
              const opens = (core.match(/\(/g) || []).length;
              const closes = (core.match(/\)/g) || []).length;
              if (closes <= opens) break;
            }
            trailing = core.slice(-1) + trailing;
            core = core.slice(0, -1);
          }

          const converted = formatChemicalToken(core);
          return converted ? `${converted}${trailing}` : fullMatch;
        }
      );

      return replaced.replace(/\uE002URL(\d+)\uE003/g, (_m, idx) => urlPlaceholders[Number(idx)]);
    })
    .join('\n');
}

/**
 * Clean up redundant blank lines and broken list indentation from Google Docs exports.
 */
function cleanupGoogleDocsFormatting(text) {
  let out = text
    .replace(/^\uFEFF/, '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');

  const lines = out.split('\n').map((rawLine) => {
    const line = rawLine.replace(/[ \t]+$/g, '');

    // Convert unicode bullet characters exported by Google Docs/Word into standard `- `
    const unicodeBullet = line.match(/^([ \t]*)[•◦▪▫●○■□]\s+(.*)$/);
    if (unicodeBullet) {
      const indentSpaces = unicodeBullet[1].replace(/\t/g, '  ').length;
      const level = indentSpaces < 4 ? 0 : Math.min(3, Math.floor((indentSpaces - 2) / 2));
      return `${'  '.repeat(level)}- ${unicodeBullet[2]}`;
    }

    // Normalize broken indentation on Markdown unordered/ordered list items
    const mdList = line.match(/^([ \t]*)([-*+]|\d+\.)[ \t]+(.*)$/);
    if (mdList) {
      const rawIndent = mdList[1].replace(/\t/g, '  ').length;
      // Avoid accidental 4-space CommonMark code blocks on slightly indented Google Docs top-level lists
      const level = rawIndent < 4 ? 0 : Math.min(3, Math.floor((rawIndent - 2) / 2));
      const marker = mdList[2] === '*' || mdList[2] === '+' ? '-' : mdList[2];
      return `${'  '.repeat(level)}${marker} ${mdList[3]}`;
    }

    return line;
  });

  // Tighten single blank lines between consecutive simple list items
  const compacted = [];
  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i];
    const prev = compacted[compacted.length - 1] ?? '';
    const next = lines[i + 1] ?? '';
    const isListLine = (s) => /^[ ]*(?:-|\d+\.) /.test(s);

    if (curr === '' && isListLine(prev) && isListLine(next)) {
      continue;
    }
    compacted.push(curr);
  }

  return compacted
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Main entrypoint: sanitizes imported Markdown from Google Docs or `.docx` files.
 */
export function sanitizeImportedMarkdown(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  // 1. Mask fenced code blocks and inline code spans first
  const codeSegments = [];
  let text = rawText.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = codeSegments.length;
    codeSegments.push(match);
    return `\uE000CODE${idx}\uE001`;
  });

  // 2. Clean up Google Docs whitespace, bullets, and broken list indentation
  text = cleanupGoogleDocsFormatting(text);

  // 3. Unescape LaTeX delimiters and fix double-escaped backslashes inside math
  text = normalizeMathDelimiters(text);

  // 4. Mask all normalized math blocks ($$...$$ and $...$) before chemistry conversion
  const mathSegments = [];
  text = text.replace(/\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)[^\n$]+?(?<!\$)\$(?!\$)/g, (match) => {
    const idx = mathSegments.length;
    mathSegments.push(match);
    return `\uE000MATH${idx}\uE001`;
  });

  // 5. Convert unformatted chemical formulas & ions outside math, code, URLs, and headings
  text = convertChemistryInProse(text);

  // 6. Restore math and code placeholders
  text = text.replace(/\uE000MATH(\d+)\uE001/g, (_m, idx) => mathSegments[Number(idx)]);
  text = text.replace(/\uE000CODE(\d+)\uE001/g, (_m, idx) => codeSegments[Number(idx)]);

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

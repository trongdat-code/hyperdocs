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

const KNOWN_LATEX_CMD_RE =
  /^(?:text|textbf|textit|textrm|mathrm|mathbf|mathit|mathcal|mathbb|mathfrak|mathsf|mathtt|operatorname|ce|pu|frac|dfrac|tfrac|cfrac|binom|sqrt|cdot|cdots|ldots|dots|times|div|pm|mp|ast|star|circ|bullet|oplus|otimes|leq|le|geq|ge|neq|ne|approx|equiv|sim|simeq|cong|propto|ll|gg|subset|subseteq|supset|supseteq|in|notin|cup|cap|emptyset|varnothing|forall|exists|neg|land|lor|rightarrow|to|leftarrow|gets|leftrightarrow|Rightarrow|Leftarrow|Leftrightarrow|implies|iff|rightleftharpoons|xleftarrow|xrightarrow|uparrow|downarrow|updownarrow|mapsto|sum|prod|coprod|int|iint|iiint|oint|lim|limsup|liminf|sup|inf|max|min|arg|det|dim|gcd|hom|ker|lg|ln|log|exp|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|infty|partial|nabla|hbar|ell|Re|Im|aleph|angle|triangle|perp|parallel|degree|vec|hat|widehat|tilde|widetilde|bar|overline|underline|dot|ddot|overbrace|underbrace|left|right|big|Big|bigg|Bigg|quad|qquad|begin|end|boxed|cancel|overset|underset|stackrel|color)$/;

/**
 * Consume a balanced delimiter pair starting at `start` (e.g. `{...}` or `[...]`).
 * Returns index immediately after the matching closing char, or -1 if unbalanced.
 */
function consumeBalanced(str, start, openCh, closeCh) {
  if (str[start] !== openCh) return -1;
  let depth = 0;
  let i = start;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      i += 2;
      continue;
    }
    if (str[i] === openCh) depth += 1;
    else if (str[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/**
 * Consume a LaTeX command starting at `str[pos] === '\\'`, along with any
 * optional `[...]` and required `{...}` arguments (including `\begin{env}...\end{env}`).
 */
function consumeLatexCommand(str, pos, allowSpacingCmd = false) {
  if (str[pos] !== '\\' || pos + 1 >= str.length) return -1;

  if (allowSpacingCmd && /[,;:!]/.test(str[pos + 1])) {
    return pos + 2;
  }

  const nameMatch = str.slice(pos + 1).match(/^([a-zA-Z]+)/);
  if (!nameMatch) return -1;

  const cmdName = nameMatch[1];
  let end = pos + 1 + cmdName.length;
  const hasFollowingArg = end < str.length && (str[end] === '{' || str[end] === '[');

  if (!KNOWN_LATEX_CMD_RE.test(cmdName) && !hasFollowingArg) {
    return -1;
  }

  // Handle \begin{env}...\end{env}
  if (cmdName === 'begin' && str[end] === '{') {
    const envEnd = consumeBalanced(str, end, '{', '}');
    if (envEnd !== -1) {
      const envName = str.slice(end + 1, envEnd - 1);
      const closingTag = `\\end{${envName}}`;
      const closeIdx = str.indexOf(closingTag, envEnd);
      if (closeIdx !== -1) {
        return closeIdx + closingTag.length;
      }
      return envEnd;
    }
  }

  // Consume optional `[...]` and `{...}` arguments
  while (end < str.length) {
    if (str[end] === '[') {
      const nextEnd = consumeBalanced(str, end, '[', ']');
      if (nextEnd === -1) break;
      end = nextEnd;
    } else if (str[end] === '{') {
      const nextEnd = consumeBalanced(str, end, '{', '}');
      if (nextEnd === -1) break;
      end = nextEnd;
    } else {
      break;
    }
  }

  return end;
}

/**
 * Consume a LaTeX subscript `_...` or superscript `^...` starting at `pos`.
 */
function consumeSubOrSup(str, pos) {
  const ch = str[pos];
  if (ch !== '_' && ch !== '^') return -1;
  if (pos + 1 >= str.length) return -1;

  const next = str[pos + 1];
  if (next === '{') {
    return consumeBalanced(str, pos + 1, '{', '}');
  }
  if (next === '\\') {
    return consumeLatexCommand(str, pos + 1, false);
  }
  if (ch === '^') {
    const m = str.slice(pos + 1).match(/^(?:[+-]?\d+[+-]?|[+-]|[a-zA-Z](?![a-zA-Z0-9_]))/);
    return m ? pos + 1 + m[0].length : -1;
  }
  // Underscore without braces: digits or isolated single variable letter
  const m = str.slice(pos + 1).match(/^(?:\d+|[a-zA-Z](?![a-zA-Z0-9_]))/);
  return m ? pos + 1 + m[0].length : -1;
}

function countUnmatchedParens(slice, openCh, closeCh) {
  let depth = 0;
  for (let i = 0; i < slice.length; i += 1) {
    if (slice[i] === '\\' && i + 1 < slice.length) {
      i += 1;
      continue;
    }
    if (slice[i] === openCh) depth += 1;
    else if (slice[i] === closeCh && depth > 0) depth -= 1;
  }
  return depth;
}

function isSimpleMathGroup(inner) {
  // Reject groups containing non-ASCII prose (e.g. Vietnamese words) or multi-word prose
  if (/[^\x20-\x7E±×÷·≤≥≠≈→←↔⇌°]/.test(inner)) return false;
  if (/[a-zA-Z]{4,}\s+[a-zA-Z]{3,}/.test(inner)) return false;
  return true;
}

/**
 * Detect bare LaTeX expressions on a single line (with code & existing math already masked)
 * and wrap each contiguous mathematical/chemical expression in `$ ... $`.
 */
function wrapBareLatexInLine(rawLine) {
  if (!rawLine || !/[\\_^]/.test(rawLine)) return rawLine;

  // Unescape double-escaped known LaTeX commands outside math/code (e.g. \\text{CuSO}_4)
  const line = rawLine.replace(/\\\\([a-zA-Z]+)(?=\{|\[|[^a-zA-Z]|$)/g, (m, cmd, offset, full) => {
    const afterChar = full[offset + m.length];
    if (KNOWN_LATEX_CMD_RE.test(cmd) || afterChar === '{' || afterChar === '[') {
      return `\\${cmd}`;
    }
    return m;
  });

  if (!/[\\_^]/.test(line)) return line;

  const spans = [];
  let scanIdx = 0;

  while (scanIdx < line.length) {
    // Skip masked placeholders `\uE000...\uE001`
    if (line[scanIdx] === '\uE000') {
      const endPlaceholder = line.indexOf('\uE001', scanIdx + 1);
      scanIdx = endPlaceholder !== -1 ? endPlaceholder + 1 : line.length;
      continue;
    }

    let trigStart = -1;
    let trigEnd = -1;

    // Trigger 1: Bare LaTeX command (e.g. \text{...}, \frac{...}{...}, \cdot, \Delta)
    if (line[scanIdx] === '\\') {
      const cmdEnd = consumeLatexCommand(line, scanIdx, false);
      if (cmdEnd !== -1) {
        trigStart = scanIdx;
        trigEnd = cmdEnd;
      }
    }
    // Trigger 2: Bare subscript or superscript attached to a math/chem token (e.g. Fe^{3+}, H_{2}O, CO_2, 10^{-5})
    else if (line[scanIdx] === '_' || line[scanIdx] === '^') {
      const prevChar = scanIdx > 0 ? line[scanIdx - 1] : '';
      const isBraced = line[scanIdx + 1] === '{';
      if (/[A-Za-z0-9)\]]/.test(prevChar)) {
        const subEnd = consumeSubOrSup(line, scanIdx);
        if (subEnd !== -1) {
          // Walk back over the immediately attached base token
          let baseStart = scanIdx;
          if (prevChar === ')' || prevChar === ']') {
            const openCh = prevChar === ')' ? '(' : '[';
            let depth = 0;
            let k = scanIdx - 1;
            while (k >= 0) {
              if (line[k] === prevChar) depth += 1;
              else if (line[k] === openCh) {
                depth -= 1;
                if (depth === 0) {
                  baseStart = k;
                  break;
                }
              }
              k -= 1;
            }
          } else {
            while (baseStart > 0 && /[A-Za-z0-9]/.test(line[baseStart - 1])) {
              baseStart -= 1;
            }
          }

          const baseToken = line.slice(baseStart, scanIdx);
          const isLowercaseWord = /^[a-z]{2,}$/.test(baseToken);
          const allowTrigger =
            isBraced ||
            line[scanIdx] === '^' ||
            (!isLowercaseWord && /^[A-Z0-9()[\]]/.test(baseToken)) ||
            /^[a-zA-Z]$/.test(baseToken);

          // Avoid matching `word_1` inside snake_case identifiers
          const precededByUnderscoreOrNonAscii =
            baseStart > 0 && /[_]|[^\x00-\x7F]/.test(line[baseStart - 1]);

          if (allowTrigger && !precededByUnderscoreOrNonAscii) {
            trigStart = baseStart;
            trigEnd = subEnd;
          }
        }
      }
    }

    if (trigStart === -1) {
      scanIdx += 1;
      continue;
    }

    // Clamp leftward expansion so we never overlap a previously wrapped span or placeholder
    const minBound = spans.length > 0 ? spans[spans.length - 1].end : 0;
    let start = Math.max(minBound, trigStart);
    let end = trigEnd;

    // 1. Expand leftward across directly attached math/chem prefix (e.g., `2\text{H}_2\text{O}`, `-10^{-5}`, `[\text{H}^+]`)
    while (start > minBound) {
      const ch = line[start - 1];
      if (ch === '\uE001' || ch === '\uE000' || /[^\x20-\x7E±×÷·≤≥≠≈→←↔⇌]/.test(ch)) break;
      if (/[0-9.+\-=<>|±]/.test(ch)) {
        // Don't swallow a sentence-ending period or list numbering like `1.`
        if (ch === '.' && (start - 2 < minBound || !/\d/.test(line[start - 2]))) break;
        start -= 1;
        continue;
      }
      if (ch === '[') {
        start -= 1;
        continue;
      }
      if (/[A-Za-z]/.test(ch)) {
        // Pull directly adjacent short ASCII math/chem prefix (e.g. `T\Delta S`, `2k\cdot`, `Fe\text{...}`)
        let wordStart = start - 1;
        while (wordStart > minBound && /[A-Za-z0-9]/.test(line[wordStart - 1])) {
          wordStart -= 1;
        }
        const word = line.slice(wordStart, start);
        const beforeWord = wordStart > minBound ? line[wordStart - 1] : '';
        if (word.length <= 4 && !/[^\x00-\x7F]/.test(beforeWord)) {
          start = wordStart;
          continue;
        }
      }
      break;
    }

    // Also pull an immediately preceding simple equation LHS like `pH = `, `x = `, `v = `, `2 + `
    const prefixSlice = line.slice(minBound, start);
    const lhsMatch = prefixSlice.match(
      /(?:^|[\s:(;,])((?:[A-Za-z][A-Za-z0-9]{0,2}|\d+(?:\.\d+)?)\s*(?:=|[+\-<>≤≥≠≈]|->))\s*$/
    );
    if (lhsMatch) {
      const lhsText = lhsMatch[1];
      const lhsStart = start - lhsMatch[0].length + lhsMatch[0].indexOf(lhsText);
      if (lhsStart >= minBound && !/[^\x20-\x7E±×÷·≤≥≠≈]/.test(lhsText)) {
        start = lhsStart;
      }
    }

    // 2. Expand rightward across contiguous LaTeX commands, sub/superscripts, operators, and numbers
    while (end < line.length) {
      const ch = line[end];
      if (ch === '\uE000' || ch === '\uE001') break;

      // Directly attached LaTeX command or spacing command
      if (ch === '\\') {
        const nextEnd = consumeLatexCommand(line, end, true);
        if (nextEnd !== -1) {
          end = nextEnd;
          continue;
        }
        break;
      }

      // Directly attached subscript / superscript
      if (ch === '_' || ch === '^') {
        const nextEnd = consumeSubOrSup(line, end);
        if (nextEnd !== -1) {
          end = nextEnd;
          continue;
        }
        break;
      }

      // Directly attached digits, math signs, or short ASCII math/chem symbol
      if (/[0-9+\-*/=<>|!%°'±×÷·≤≥≠≈→←↔⇌]/.test(ch)) {
        // Don't swallow trailing sentence exclamation mark when preceded by a complete formula
        if (ch === '!' && (end + 1 >= line.length || /\s/.test(line[end + 1]))) break;
        end += 1;
        continue;
      }

      // Directly attached decimal point inside a number
      if (ch === '.' && end + 1 < line.length && /\d/.test(line[end + 1])) {
        end += 1;
        continue;
      }

      // Directly attached balanced `(...)` or `[...]` containing math/chem (e.g., `(\text{SO}_4)_3`, `[\text{OH}^-]`)
      if (ch === '(' || ch === '[') {
        const closeCh = ch === '(' ? ')' : ']';
        const groupEnd = consumeBalanced(line, end, ch, closeCh);
        if (groupEnd !== -1 && isSimpleMathGroup(line.slice(end + 1, groupEnd - 1))) {
          end = groupEnd;
          continue;
        }
        break;
      }

      // Directly attached closing `)` or `]` if matching an unmatched opening inside the span
      if (ch === ')' && countUnmatchedParens(line.slice(start, end), '(', ')') > 0) {
        end += 1;
        continue;
      }
      if (ch === ']' && countUnmatchedParens(line.slice(start, end), '[', ']') > 0) {
        end += 1;
        continue;
      }

      // Directly attached ASCII letters (e.g. `dx`, `mv`, `SO4`, `H2O` right after a command/number)
      if (/[A-Za-z]/.test(ch)) {
        const wordMatch = line.slice(end).match(/^[A-Za-z]{1,4}(?![A-Za-z\u00C0-\u1EF9])/);
        if (wordMatch) {
          end += wordMatch[0].length;
          continue;
        }
        break;
      }

      // Whitespace followed by another math continuation
      if (ch === ' ' || ch === '\t') {
        let wsEnd = end;
        while (wsEnd < line.length && (line[wsEnd] === ' ' || line[wsEnd] === '\t')) {
          wsEnd += 1;
        }
        if (wsEnd >= line.length || line[wsEnd] === '\uE000') break;

        const nextCh = line[wsEnd];

        // Space + LaTeX command (e.g. `\cdot \text{H}_2\text{O}`, `= \frac{1}{2}`)
        if (nextCh === '\\' && consumeLatexCommand(line, wsEnd, true) !== -1) {
          end = wsEnd;
          continue;
        }

        // Space + math operator followed by math/number/variable/command (e.g. ` + \text{H}_2\text{O}`, ` = -285.8`)
        if (/[+\-=<>≤≥≠≈→←↔⇌±×÷·/*]/.test(nextCh)) {
          const afterOp = line.slice(wsEnd + 1).match(/^\s*([\\0-9([A-Za-z+\-])/);
          if (afterOp) {
            const tokenAfterOp = line.slice(wsEnd + 1).trimStart();
            // Reject hyphenated prose like ` - màu xanh` (non-ASCII or long prose word after `-`)
            const isProseDash =
              nextCh === '-' &&
              !/^(?:\\|\d|[(\[]|[A-Za-z](?:[\\_^]|[\s+\-=<>)]|$))/.test(tokenAfterOp);
            if (!isProseDash) {
              end = wsEnd + 1;
              continue;
            }
          }
          break;
        }

        // Space + coefficient/number followed by math/LaTeX/unit/operator (e.g. `\cdot 5\text{H}_2\text{O}`, `= 2.5`)
        if (/\d/.test(nextCh)) {
          const numMatch = line.slice(wsEnd).match(/^\d+(?:\.\d+)?/);
          if (numMatch) {
            const afterNum = wsEnd + numMatch[0].length;
            const prevNonWs = line.slice(start, end).trimEnd().slice(-1);
            const afterNumIsMath =
              afterNum < line.length &&
              (/[\\_^+\-*/=<>()[\]%]/.test(line[afterNum]) ||
                /^\s*[\\+\-=<>≤≥≠≈→←↔⇌±×÷·]/.test(line.slice(afterNum)));
            const prevIsMathOpOrCmd =
              /[+\-*/=<>≤≥≠≈→←↔⇌±×÷·]/.test(prevNonWs) ||
              /\\(?:cdot|times|pm|mp|leq|geq|neq|approx|rightarrow|to|rightleftharpoons|quad|,|;)$/.test(
                line.slice(start, end).trimEnd()
              );
            if (afterNumIsMath || prevIsMathOpOrCmd) {
              end = afterNum;
              continue;
            }
          }
          break;
        }

        // Space + bracketed math/chem group like `[\text{OH}^-]`
        if (nextCh === '[') {
          const groupEnd = consumeBalanced(line, wsEnd, '[', ']');
          if (groupEnd !== -1 && isSimpleMathGroup(line.slice(wsEnd + 1, groupEnd - 1))) {
            end = groupEnd;
            continue;
          }
          break;
        }

        // Space + single/two-letter math variable (e.g. `\Delta G`, `\Delta H`, `x^2`, `dx`)
        const varMatch = line
          .slice(wsEnd)
          .match(/^([A-Za-z](?:[a-z](?=\b))?)(?=[\s.,;:!?)\]^_+\-*/=<>\\]|$)/);
        if (varMatch) {
          const sym = varMatch[1];
          const afterVarIdx = wsEnd + sym.length;
          const afterVarChar = line[afterVarIdx] || '';
          const hasSubSupAfter = afterVarChar === '_' || afterVarChar === '^';
          const prevTrimmed = line.slice(start, end).trimEnd();
          const prevEndsWithMath =
            /[+\-*/=<>≤≥≠≈→←↔⇌±×÷·]$/.test(prevTrimmed) ||
            /\\(?:Delta|Gamma|Lambda|Omega|Phi|Pi|Sigma|Theta|nabla|partial|vec|hat|bar|cdot|times|int|sum|prod|lim|,|;)$/.test(
              prevTrimmed
            );
          const isSingleVarNotArticle =
            sym.length === 1 &&
            !(/^[aI]$/.test(sym) && /^\s+[A-Za-z\u00C0-\u1EF9]{2,}/.test(line.slice(afterVarIdx)));
          const isDifferential = /^d[a-z]$/.test(sym);

          if (hasSubSupAfter || isDifferential || (prevEndsWithMath && isSingleVarNotArticle)) {
            end = afterVarIdx;
            continue;
          }
        }
      }

      break;
    }

    // Trim trailing whitespace & dangling sentence punctuation
    while (end > start && /[\s,;:.?]/.test(line[end - 1])) {
      end -= 1;
    }

    // If we captured an unbalanced leading `[` without a closing `]`, strip it
    if (line[start] === '[' && countUnmatchedParens(line.slice(start, end), '[', ']') > 0) {
      start += 1;
    }

    if (end > start) {
      spans.push({ start, end });
      scanIdx = end;
    } else {
      scanIdx += 1;
    }
  }

  if (spans.length === 0) return line;

  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += line.slice(cursor, span.start);
    const body = cleanMathBody(line.slice(span.start, span.end).trim());
    result += `$${body}$`;
    cursor = span.end;
  }
  result += line.slice(cursor);
  return result;
}

/**
 * Unescape LaTeX delimiters (`\(...\)`, `\[...\]`, `\$...\$`), clean double-escaped commands
 * inside existing `$ ... $` / `$$ ... $$`, and auto-wrap bare LaTeX expressions
 * (such as `\text{CuSO}_4\cdot 5\text{H}_2\text{O}`, `\frac{1}{2}`, `Fe^{3+}`) in `$ ... $`
 * so KaTeX always compiles them cleanly.
 */
export function normalizeMathDelimiters(text) {
  if (!text || typeof text !== 'string') return '';

  // 0. Preserve fenced code blocks and inline code spans untouched
  const codeSegments = [];
  let out = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = codeSegments.length;
    codeSegments.push(match);
    return `\uE000CODE${idx}\uE001`;
  });

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
  out = out.replace(/(?<!\$)\$(?!\$)([^\n$]+?)(?<!\$)\$(?!\$)/g, (match, inner) => {
    if (/^\d[\d,.]*\s+(?:to|and|or|đến|và|hoặc|per|mỗi)\s*$/i.test(inner.trim())) {
      return match;
    }
    const body = cleanMathBody(inner.trim());
    return body ? `$${body}$` : match;
  });

  // 7. Mask all already-delimited math blocks, then auto-wrap bare LaTeX commands/subscripts/superscripts
  const mathSegments = [];
  out = out.replace(/\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)[^\n$]+?(?<!\$)\$(?!\$)/g, (match) => {
    const idx = mathSegments.length;
    mathSegments.push(match);
    return `\uE000MATH${idx}\uE001`;
  });

  out = out
    .split('\n')
    .map((line) => wrapBareLatexInLine(line))
    .join('\n');

  // 8. Restore masked math and code placeholders
  out = out.replace(/\uE000MATH(\d+)\uE001/g, (_m, idx) => mathSegments[Number(idx)]);
  out = out.replace(/\uE000CODE(\d+)\uE001/g, (_m, idx) => codeSegments[Number(idx)]);

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

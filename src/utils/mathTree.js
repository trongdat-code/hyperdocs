import katex from 'katex';

/**
 * Recursive Desmos-Style Nested Math Tree Engine (`MathNode`)
 *
 * Canonical node schema:
 *   MathNode = {
 *     type:
 *       | 'expr'      // root container slot for a math widget
 *       | 'text'      // leaf character run (`value: string`)
 *       | 'fraction'  // slots: [numerator, denominator]
 *       | 'sqrt'      // slots: [radicand]
 *       | 'nthroot'   // slots: [index, radicand]
 *       | 'power'     // slots: [base, exponent]
 *       | 'subscript' // slots: [base, subscript]
 *       | 'integral'  // slots: [lower, upper, integrand, variable]
 *       | 'limit'     // slots: [variable, target, expression]
 *       | 'sum'       // slots: [lower, upper, expression]
 *       | 'system'    // slots: [eq1, eq2, ...]
 *       | 'reaction'  // slots: [condition]
 *       | 'oxid'      // slots: [oxidationNum, element]
 *       | 'vector'    // slots: [symbol]
 *       | 'angle'     // slots: [symbol]
 *       | 'molarity'  // slots: [species]
 *       | 'ionPos'    // slots: [base, charge]
 *       | 'ionNeg',   // slots: [base, charge]
 *     value?: string,
 *     slots: MathNode[][]
 *   }
 *
 * Every slot inside every formula node can contain arbitrary interleaved text runs
 * AND nested child formula nodes infinitely deep, rendered with atomic native
 * `<input class="hd-seg">` text segments so browser keystrokes never flicker or
 * overwrite the outer `contentEditable` canvas.
 */

const TYPE_ALIASES = {
  cases: 'system',
  chemArrow: 'reaction',
  oxidation: 'oxid',
};

export function normalizeNodeType(rawType) {
  const key = String(rawType || '').trim();
  return TYPE_ALIASES[key] || key;
}

export const NODE_SPECS = {
  expr: {
    slots: [{ name: 'body', ph: '', size: 'md' }],
  },
  fraction: {
    slots: [
      { name: 'num', ph: 'a', size: 'md' },
      { name: 'den', ph: 'b', size: 'md' },
    ],
  },
  sqrt: {
    slots: [{ name: 'rad', ph: 'x', size: 'md' }],
  },
  nthroot: {
    slots: [
      { name: 'idx', ph: 'n', size: 'sm' },
      { name: 'rad', ph: 'x', size: 'md' },
    ],
  },
  power: {
    slots: [
      { name: 'base', ph: 'x', size: 'md' },
      { name: 'exp', ph: 'n', size: 'sm' },
    ],
  },
  subscript: {
    slots: [
      { name: 'base', ph: 'x', size: 'md' },
      { name: 'sub', ph: 'n', size: 'sm' },
    ],
  },
  integral: {
    slots: [
      { name: 'lower', ph: 'a', size: 'xs' },
      { name: 'upper', ph: 'b', size: 'xs' },
      { name: 'expr', ph: 'f(x)', size: 'md' },
      { name: 'var', ph: 'x', size: 'sm' },
    ],
  },
  limit: {
    slots: [
      { name: 'var', ph: 'x', size: 'xs' },
      { name: 'target', ph: '∞', size: 'xs' },
      { name: 'expr', ph: 'f(x)', size: 'md' },
    ],
  },
  sum: {
    slots: [
      { name: 'lower', ph: 'i=1', size: 'xs' },
      { name: 'upper', ph: 'n', size: 'xs' },
      { name: 'expr', ph: 'aᵢ', size: 'md' },
    ],
  },
  system: {
    slots: [
      { name: 'eq1', ph: 'x + y = 1', size: 'wide' },
      { name: 'eq2', ph: 'x - y = 0', size: 'wide' },
    ],
  },
  reaction: {
    slots: [{ name: 'above', ph: 't°', size: 'sm' }],
  },
  oxid: {
    slots: [
      { name: 'num', ph: '+n', size: 'xs' },
      { name: 'el', ph: 'X', size: 'md' },
    ],
  },
  vector: {
    slots: [{ name: 'sym', ph: 'a', size: 'md' }],
  },
  angle: {
    slots: [{ name: 'sym', ph: 'ABC', size: 'md' }],
  },
  molarity: {
    slots: [{ name: 'species', ph: 'M', size: 'md' }],
  },
  ionPos: {
    slots: [
      { name: 'base', ph: 'M', size: 'md' },
      { name: 'charge', ph: 'n', size: 'xs' },
    ],
  },
  ionNeg: {
    slots: [
      { name: 'base', ph: 'X', size: 'md' },
      { name: 'charge', ph: 'n', size: 'xs' },
    ],
  },
};

export function createTextNode(value = '') {
  return { type: 'text', value: String(value || ''), slots: [] };
}

export function createMathNode(rawType, initialSlots = []) {
  const type = normalizeNodeType(rawType);
  if (type === 'text') {
    return createTextNode(typeof initialSlots === 'string' ? initialSlots : '');
  }
  const spec = NODE_SPECS[type];
  if (!spec) return null;
  const slotCount =
    type === 'system' && Array.isArray(initialSlots) && initialSlots.length > 2
      ? initialSlots.length
      : spec.slots.length;
  const slots = Array.from({ length: slotCount }, (_, idx) => {
    const raw = Array.isArray(initialSlots) ? initialSlots[idx] : undefined;
    if (Array.isArray(raw)) return normalizeSlotNodes(raw);
    if (typeof raw === 'string' && raw) return [createTextNode(raw)];
    return [];
  });
  return { type, slots };
}

export function createRootExprTree(childNode = null) {
  return {
    type: 'expr',
    slots: [childNode ? [childNode] : []],
  };
}

export function normalizeSlotNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  const out = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const type = normalizeNodeType(node.type);
    if (type === 'text') {
      const val = String(node.value ?? node.text ?? '');
      if (!val) continue;
      if (out.length > 0 && out[out.length - 1].type === 'text') {
        out[out.length - 1].value += val;
      } else {
        out.push(createTextNode(val));
      }
    } else if (NODE_SPECS[type]) {
      const spec = NODE_SPECS[type];
      const rawSlots = Array.isArray(node.slots) ? node.slots : [];
      const count =
        type === 'system' && rawSlots.length > 2 ? rawSlots.length : spec.slots.length;
      const slots = Array.from({ length: count }, (_, idx) => normalizeSlotNodes(rawSlots[idx]));
      out.push({ type, slots });
    }
  }
  return out;
}

export function normalizeMathTree(tree) {
  if (!tree || typeof tree !== 'object') return createRootExprTree();
  const type = normalizeNodeType(tree.type);
  if (type === 'expr') {
    return {
      type: 'expr',
      slots: [normalizeSlotNodes(tree.slots?.[0] || [])],
    };
  }
  const normalized = normalizeSlotNodes([tree]);
  return {
    type: 'expr',
    slots: [normalized],
  };
}

// ============================================================================
// Unicode <-> LaTeX Normalization & Recursive Tree -> Standard LaTeX Serializer
// ============================================================================

const UNICODE_TO_LATEX_MAP = {
  'α': '\\alpha ',
  'β': '\\beta ',
  'γ': '\\gamma ',
  'Δ': '\\Delta ',
  'δ': '\\delta ',
  'ε': '\\varepsilon ',
  'θ': '\\theta ',
  'λ': '\\lambda ',
  'μ': '\\mu ',
  'π': '\\pi ',
  'ρ': '\\rho ',
  'σ': '\\sigma ',
  'τ': '\\tau ',
  'φ': '\\varphi ',
  'ω': '\\omega ',
  'Ω': '\\Omega ',
  '∞': '\\infty ',
  '≠': '\\neq ',
  '≈': '\\approx ',
  '≤': '\\le ',
  '≥': '\\ge ',
  '∈': '\\in ',
  '⊂': '\\subset ',
  '⇒': '\\Rightarrow ',
  '⇔': '\\Leftrightarrow ',
  '⊥': '\\perp ',
  '∥': '\\parallel ',
  '→': '\\to ',
  '⇌': '\\rightleftharpoons ',
  '↓': '\\downarrow ',
  '↑': '\\uparrow ',
  '·': '\\cdot ',
  '×': '\\times ',
  '±': '\\pm ',
  '−': '-',
  '°': '^\\circ ',
};

const UNICODE_RE = /[αβγΔδεθλμπρστφωΩ∞≠≈≤≥∈⊂⇒⇔⊥∥→⇌↓↑·×±−°]/g;

function normalizeTextSegmentToLatex(raw) {
  let out = String(raw || '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ');
  if (!out) return '';
  out = out.replace(UNICODE_RE, (ch) => UNICODE_TO_LATEX_MAP[ch] || ch);
  return out.replace(/\s+/g, ' ');
}

function isPlainTextOnlySlot(slotNodes) {
  return (
    Array.isArray(slotNodes) &&
    slotNodes.length > 0 &&
    slotNodes.every((n) => n.type === 'text')
  );
}

function formatChemSlotLatex(slotNodes, fallback = '') {
  const latex = serializeSlotToLatex(slotNodes).trim();
  if (!latex) return fallback;
  if (isPlainTextOnlySlot(slotNodes) && !/\\[a-zA-Z]+|[_^{}]/.test(latex)) {
    return `\\text{${latex}}`;
  }
  return latex;
}

function wrapBaseIfNeeded(baseLatex, baseSlotNodes) {
  const clean = baseLatex.trim();
  if (!clean) return 'x';
  // Wrap compound bases or bases that themselves contain scripts/structures so KaTeX never throws
  const hasStructuredChild =
    Array.isArray(baseSlotNodes) &&
    baseSlotNodes.some((n) => n.type !== 'text');
  if (hasStructuredChild || /[\s^_+\-*/]/.test(clean) || (clean.length > 1 && !/^\\[a-zA-Z]+$/.test(clean))) {
    // Avoid double-wrapping already braced single group
    if (clean.startsWith('{') && clean.endsWith('}')) return clean;
    return `{${clean}}`;
  }
  return clean;
}

export function serializeSlotToLatex(slotNodes) {
  if (!Array.isArray(slotNodes) || slotNodes.length === 0) return '';
  let result = '';
  for (let i = 0; i < slotNodes.length; i += 1) {
    const part = serializeNodeToLatex(slotNodes[i]);
    if (!part) continue;
    // Prevent a trailing LaTeX command from gluing onto a following letter (e.g. `\pi` + `x` -> `\pi x`)
    if (/\\[a-zA-Z]+$/.test(result) && /^[a-zA-Z]/.test(part)) {
      result += ' ';
    }
    result += part;
  }
  return result.trim();
}

export function serializeNodeToLatex(node) {
  if (!node || typeof node !== 'object') return '';
  const type = normalizeNodeType(node.type);
  const slots = Array.isArray(node.slots) ? node.slots : [];

  if (type === 'text') {
    return normalizeTextSegmentToLatex(node.value ?? node.text ?? '');
  }
  if (type === 'expr') {
    return serializeSlotToLatex(slots[0] || []);
  }

  const slotStr = (idx, fallback = '') => serializeSlotToLatex(slots[idx]) || fallback;

  switch (type) {
    case 'fraction':
      return `\\frac{${slotStr(0, '\\square')}}{${slotStr(1, '\\square')}}`;
    case 'sqrt':
      return `\\sqrt{${slotStr(0, '\\square')}}`;
    case 'nthroot':
      return `\\sqrt[${slotStr(0, 'n')}]{${slotStr(1, '\\square')}}`;
    case 'power': {
      const baseRaw = slotStr(0, 'x');
      const expRaw = slotStr(1, 'n');
      return `${wrapBaseIfNeeded(baseRaw, slots[0])}^{${expRaw}}`;
    }
    case 'subscript': {
      const baseRaw = slotStr(0, 'x');
      const subRaw = slotStr(1, 'n');
      return `${wrapBaseIfNeeded(baseRaw, slots[0])}_{${subRaw}}`;
    }
    case 'integral': {
      const lo = slotStr(0);
      const hi = slotStr(1);
      const bounds = lo || hi ? `_{${lo || 'a'}}^{${hi || 'b'}}` : '';
      return `\\int${bounds} ${slotStr(2, 'f(x)')}\\,d${slotStr(3, 'x')}`;
    }
    case 'limit': {
      const expr = slotStr(2);
      const head = `\\lim_{${slotStr(0, 'x')} \\to ${slotStr(1, '\\infty')}}`;
      return expr ? `${head} ${expr}` : head;
    }
    case 'sum': {
      const expr = slotStr(2);
      const head = `\\sum_{${slotStr(0, 'i=1')}}^{${slotStr(1, 'n')}}`;
      return expr ? `${head} ${expr}` : head;
    }
    case 'system': {
      const rows = slots.map((sl) => serializeSlotToLatex(sl) || '\\square');
      while (rows.length < 2) rows.push('\\square');
      return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
    }
    case 'reaction':
      return `\\xrightarrow{${formatChemSlotLatex(slots[0], 't^\\circ')}}`;
    case 'oxid':
      return `\\overset{${slotStr(0, '+n')}}{${formatChemSlotLatex(slots[1], '\\text{X}')}}`;
    case 'vector':
      return `\\vec{${slotStr(0, 'a')}}`;
    case 'angle':
      return `\\widehat{${slotStr(0, 'ABC')}}`;
    case 'molarity':
      return `[${formatChemSlotLatex(slots[0], '\\text{M}')}]`;
    case 'ionPos':
      return `${wrapBaseIfNeeded(formatChemSlotLatex(slots[0], '\\text{M}'), slots[0])}^{${slotStr(1)}+}`;
    case 'ionNeg':
      return `${wrapBaseIfNeeded(formatChemSlotLatex(slots[0], '\\text{X}'), slots[0])}^{${slotStr(1)}-}`;
    default:
      return '';
  }
}

export function serializeMathTreeToLatex(tree) {
  const normalized = normalizeMathTree(tree);
  const body = normalized.slots[0] || [];
  const latex = serializeSlotToLatex(body).trim();
  const displayMode = body.length === 1 && body[0].type === 'system';
  return { latex, displayMode };
}

export function isTreeEmpty(tree) {
  const normalized = normalizeMathTree(tree);
  return isSlotEmpty(normalized.slots[0]);
}

export function isSlotEmpty(slotNodes) {
  if (!Array.isArray(slotNodes) || slotNodes.length === 0) return true;
  return slotNodes.every((n) => {
    if (n.type === 'text') return !String(n.value || '').trim();
    return false;
  });
}

export function isNodeContentEmpty(node) {
  if (!node) return true;
  if (node.type === 'text') return !String(node.value || '').trim();
  const slots = Array.isArray(node.slots) ? node.slots : [];
  return slots.every((sl) =>
    sl.every((child) =>
      child.type === 'text' ? !String(child.value || '').trim() : isNodeContentEmpty(child)
    )
  );
}

// ============================================================================
// Standard LaTeX -> Recursive MathNode Parser (for Re-editing Existing Formulas)
// ============================================================================

const LATEX_CMD_TO_UNICODE = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\Delta': 'Δ',
  '\\delta': 'δ',
  '\\varepsilon': 'ε',
  '\\epsilon': 'ε',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\varphi': 'φ',
  '\\phi': 'φ',
  '\\omega': 'ω',
  '\\Omega': 'Ω',
  '\\infty': '∞',
  '\\neq': '≠',
  '\\approx': '≈',
  '\\le': '≤',
  '\\leq': '≤',
  '\\ge': '≥',
  '\\geq': '≥',
  '\\in': '∈',
  '\\subset': '⊂',
  '\\Rightarrow': '⇒',
  '\\Leftrightarrow': '⇔',
  '\\perp': '⊥',
  '\\parallel': '∥',
  '\\to': '→',
  '\\rightarrow': '→',
  '\\rightleftharpoons': '⇌',
  '\\downarrow': '↓',
  '\\uparrow': '↑',
  '\\cdot': '·',
  '\\times': '×',
  '\\pm': '±',
};

function readBalanced(str, startIdx, openChar = '{', closeChar = '}') {
  let i = startIdx;
  while (i < str.length && str[i] === ' ') i += 1;
  if (i >= str.length || str[i] !== openChar) return null;
  let depth = 0;
  const contentStart = i + 1;
  while (i < str.length) {
    if (str[i] === '\\' && i + 1 < str.length) {
      i += 2;
      continue;
    }
    if (str[i] === openChar) depth += 1;
    else if (str[i] === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { content: str.slice(contentStart, i), nextIdx: i + 1 };
      }
    }
    i += 1;
  }
  return null;
}

function readSingleLatexArg(str, startIdx) {
  let i = startIdx;
  while (i < str.length && str[i] === ' ') i += 1;
  if (i >= str.length) return { content: '', nextIdx: i };
  if (str[i] === '{') {
    const grp = readBalanced(str, i, '{', '}');
    if (grp) return grp;
  }
  if (str[i] === '\\') {
    const cmdMatch = str.slice(i).match(/^\\[a-zA-Z]+/);
    if (cmdMatch) {
      return { content: cmdMatch[0], nextIdx: i + cmdMatch[0].length };
    }
  }
  return { content: str[i], nextIdx: i + 1 };
}

function parseLatexSlot(src) {
  const input = String(src || '').trim();
  if (!input || input === '\\square') return [];
  const nodes = [];
  let i = 0;

  const pushText = (txt) => {
    if (!txt) return;
    if (nodes.length > 0 && nodes[nodes.length - 1].type === 'text') {
      nodes[nodes.length - 1].value += txt;
    } else {
      nodes.push(createTextNode(txt));
    }
  };

  const popPrecedingBase = () => {
    if (nodes.length === 0) return [];
    const last = nodes[nodes.length - 1];
    if (last.type !== 'text') {
      nodes.pop();
      return [last];
    }
    const val = last.value;
    if (!val.trim()) return [];
    // Extract trailing balanced (...) or trailing number or trailing single letter/symbol
    const trimmedRight = val.replace(/\s+$/, '');
    if (trimmedRight.endsWith(')')) {
      let depth = 0;
      for (let k = trimmedRight.length - 1; k >= 0; k -= 1) {
        if (trimmedRight[k] === ')') depth += 1;
        else if (trimmedRight[k] === '(') {
          depth -= 1;
          if (depth === 0) {
            const baseStr = trimmedRight.slice(k);
            last.value = trimmedRight.slice(0, k);
            if (!last.value) nodes.pop();
            return [createTextNode(baseStr)];
          }
        }
      }
    }
    const tokenMatch = trimmedRight.match(/(\d+(?:\.\d+)?|[a-zA-Zα-ωΑ-ΩπΔΩ])$/);
    if (tokenMatch) {
      const tok = tokenMatch[1];
      last.value = trimmedRight.slice(0, trimmedRight.length - tok.length);
      if (!last.value) nodes.pop();
      return [createTextNode(tok)];
    }
    return [];
  };

  while (i < input.length) {
    const ch = input[i];

    // Superscript `^`
    if (ch === '^') {
      const arg = readSingleLatexArg(input, i + 1);
      i = arg.nextIdx;
      const baseNodes = popPrecedingBase();
      if (arg.content === '\\circ' && baseNodes.length === 0) {
        pushText('°');
      } else {
        nodes.push(createMathNode('power', [baseNodes, parseLatexSlot(arg.content)]));
      }
      continue;
    }

    // Subscript `_`
    if (ch === '_') {
      const arg = readSingleLatexArg(input, i + 1);
      i = arg.nextIdx;
      const baseNodes = popPrecedingBase();
      nodes.push(createMathNode('subscript', [baseNodes, parseLatexSlot(arg.content)]));
      continue;
    }

    // Grouped `{...}` (often base of power/subscript or bare grouping)
    if (ch === '{') {
      const grp = readBalanced(input, i, '{', '}');
      if (grp) {
        const inner = parseLatexSlot(grp.content);
        const afterIdx = grp.nextIdx;
        if (afterIdx < input.length && (input[afterIdx] === '^' || input[afterIdx] === '_')) {
          const op = input[afterIdx];
          const arg = readSingleLatexArg(input, afterIdx + 1);
          i = arg.nextIdx;
          nodes.push(
            createMathNode(op === '^' ? 'power' : 'subscript', [inner, parseLatexSlot(arg.content)])
          );
          continue;
        }
        for (const n of inner) {
          if (n.type === 'text') pushText(n.value);
          else nodes.push(n);
        }
        i = grp.nextIdx;
        continue;
      }
    }

    // LaTeX commands
    if (ch === '\\') {
      // `\begin{cases} ... \end{cases}`
      if (input.startsWith('\\begin{cases}', i)) {
        const endPos = input.indexOf('\\end{cases}', i);
        if (endPos !== -1) {
          const body = input.slice(i + '\\begin{cases}'.length, endPos);
          const rows = body.split('\\\\').map((r) => parseLatexSlot(r));
          nodes.push(createMathNode('system', rows.length >= 2 ? rows : [rows[0] || [], []]));
          i = endPos + '\\end{cases}'.length;
          continue;
        }
      }

      const cmdMatch = input.slice(i).match(/^\\([a-zA-Z]+|[,;! ])/);
      if (cmdMatch) {
        const cmd = cmdMatch[0];
        i += cmd.length;

        if (cmd === '\\,' || cmd === '\\;' || cmd === '\\!' || cmd === '\\ ') {
          pushText(' ');
          continue;
        }
        if (cmd === '\\square') {
          continue;
        }
        if (cmd === '\\frac' || cmd === '\\dfrac' || cmd === '\\tfrac') {
          const num = readSingleLatexArg(input, i);
          const den = readSingleLatexArg(input, num.nextIdx);
          i = den.nextIdx;
          nodes.push(createMathNode('fraction', [parseLatexSlot(num.content), parseLatexSlot(den.content)]));
          continue;
        }
        if (cmd === '\\sqrt') {
          let idxSlot = null;
          let cur = i;
          while (cur < input.length && input[cur] === ' ') cur += 1;
          if (input[cur] === '[') {
            const br = readBalanced(input, cur, '[', ']');
            if (br) {
              idxSlot = parseLatexSlot(br.content);
              cur = br.nextIdx;
            }
          }
          const rad = readSingleLatexArg(input, cur);
          i = rad.nextIdx;
          if (idxSlot !== null) {
            nodes.push(createMathNode('nthroot', [idxSlot, parseLatexSlot(rad.content)]));
          } else {
            nodes.push(createMathNode('sqrt', [parseLatexSlot(rad.content)]));
          }
          continue;
        }
        if (cmd === '\\xrightarrow') {
          const above = readSingleLatexArg(input, i);
          i = above.nextIdx;
          nodes.push(createMathNode('reaction', [parseLatexSlot(above.content)]));
          continue;
        }
        if (cmd === '\\overset') {
          const top = readSingleLatexArg(input, i);
          const base = readSingleLatexArg(input, top.nextIdx);
          i = base.nextIdx;
          nodes.push(createMathNode('oxid', [parseLatexSlot(top.content), parseLatexSlot(base.content)]));
          continue;
        }
        if (cmd === '\\vec') {
          const sym = readSingleLatexArg(input, i);
          i = sym.nextIdx;
          nodes.push(createMathNode('vector', [parseLatexSlot(sym.content)]));
          continue;
        }
        if (cmd === '\\widehat') {
          const sym = readSingleLatexArg(input, i);
          i = sym.nextIdx;
          nodes.push(createMathNode('angle', [parseLatexSlot(sym.content)]));
          continue;
        }
        if (cmd === '\\text' || cmd === '\\mathrm') {
          const arg = readSingleLatexArg(input, i);
          i = arg.nextIdx;
          pushText(arg.content);
          continue;
        }
        if (cmd === '\\sum') {
          let lower = [];
          let upper = [];
          let cur = i;
          while (cur < input.length) {
            while (cur < input.length && input[cur] === ' ') cur += 1;
            if (input[cur] === '_') {
              const a = readSingleLatexArg(input, cur + 1);
              lower = parseLatexSlot(a.content);
              cur = a.nextIdx;
            } else if (input[cur] === '^') {
              const a = readSingleLatexArg(input, cur + 1);
              upper = parseLatexSlot(a.content);
              cur = a.nextIdx;
            } else {
              break;
            }
          }
          const rest = input.slice(cur).trim();
          i = input.length;
          nodes.push(createMathNode('sum', [lower, upper, parseLatexSlot(rest)]));
          continue;
        }
        if (cmd === '\\lim') {
          let vSlot = [];
          let targetSlot = [];
          let cur = i;
          while (cur < input.length && input[cur] === ' ') cur += 1;
          if (input[cur] === '_') {
            const sub = readSingleLatexArg(input, cur + 1);
            cur = sub.nextIdx;
            const arrowSplit = sub.content.split(/\\to|\\rightarrow|→/);
            vSlot = parseLatexSlot(arrowSplit[0] || '');
            targetSlot = parseLatexSlot(arrowSplit[1] || '');
          }
          const rest = input.slice(cur).trim();
          i = input.length;
          nodes.push(createMathNode('limit', [vSlot, targetSlot, parseLatexSlot(rest)]));
          continue;
        }
        if (cmd === '\\int') {
          let lower = [];
          let upper = [];
          let cur = i;
          while (cur < input.length) {
            while (cur < input.length && input[cur] === ' ') cur += 1;
            if (input[cur] === '_') {
              const a = readSingleLatexArg(input, cur + 1);
              lower = parseLatexSlot(a.content);
              cur = a.nextIdx;
            } else if (input[cur] === '^') {
              const a = readSingleLatexArg(input, cur + 1);
              upper = parseLatexSlot(a.content);
              cur = a.nextIdx;
            } else {
              break;
            }
          }
          const rest = input.slice(cur).trim();
          const diffMatch = rest.match(/^(.*?)(?:\\,|\s)?d([a-zA-Z])$/);
          i = input.length;
          if (diffMatch) {
            nodes.push(
              createMathNode('integral', [
                lower,
                upper,
                parseLatexSlot(diffMatch[1]),
                [createTextNode(diffMatch[2])],
              ])
            );
          } else {
            nodes.push(createMathNode('integral', [lower, upper, parseLatexSlot(rest), []]));
          }
          continue;
        }

        if (LATEX_CMD_TO_UNICODE[cmd]) {
          pushText(LATEX_CMD_TO_UNICODE[cmd]);
          continue;
        }

        // Preserve any unknown command as plain text
        pushText(cmd);
        continue;
      }
    }

    pushText(ch);
    i += 1;
  }

  return normalizeSlotNodes(nodes);
}

export function parseLatexToMathTree(latex) {
  const slotNodes = parseLatexSlot(latex);
  return {
    type: 'expr',
    slots: [slotNodes],
  };
}

// ============================================================================
// Live Recursive DOM Builder, Width Auto-Sizer & Surgical Mutation Helpers
// ============================================================================

let measureCanvasCtx = null;

function measureInputWidthPx(inputEl, text) {
  if (typeof document === 'undefined') return null;
  try {
    if (!measureCanvasCtx) {
      const canvas = document.createElement('canvas');
      measureCanvasCtx = canvas.getContext('2d');
    }
    if (!measureCanvasCtx) return null;
    const style = window.getComputedStyle(inputEl);
    const font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize || '15px'} ${style.fontFamily || "KaTeX_Main, 'Times New Roman', serif"}`;
    measureCanvasCtx.font = font;
    return measureCanvasCtx.measureText(text).width;
  } catch {
    return null;
  }
}

/**
 * Resize an atomic `<input class="hd-seg">` cleanly to fit its text content
 * (or collapse cleanly when empty & surrounded by sibling nested nodes).
 */
export function syncSegInputSize(inputEl) {
  if (!inputEl || inputEl.tagName !== 'INPUT') return;
  const val = inputEl.value || '';
  inputEl.setAttribute('value', val);

  const hasSiblings = inputEl.getAttribute('data-has-siblings') === 'true';
  const isRootSeg = inputEl.getAttribute('data-root-seg') === 'true';
  const size = inputEl.getAttribute('data-slot-size') || 'md';
  const ph = inputEl.getAttribute('placeholder') || '';

  if (!val && (hasSiblings || isRootSeg)) {
    // Sleek invisible/compact boundary caret target next to child formulas (Desmos feel)
    inputEl.style.width = isRootSeg && hasSiblings ? '0.45ch' : '0.4ch';
    return;
  }

  const displayStr = val || ph;
  const isWide = size === 'wide';
  const isXs = size === 'xs';
  const minCh = isWide ? 6.5 : isXs ? 1.5 : 1.7;

  if (val && inputEl.isConnected) {
    const px = measureInputWidthPx(inputEl, val);
    if (px !== null && px > 0) {
      inputEl.style.width = `${Math.ceil(px + 6)}px`;
      return;
    }
  }

  const len = Math.max(displayStr.length, 1);
  const clamped = val ? len + 0.65 : Math.max(minCh, Math.min(len, isWide ? 9 : 3) + 0.6);
  inputEl.style.width = `${clamped}ch`;
}

function createSegInputEl(doc, value = '', { ph = '', size = 'md', hasSiblings = false, isRootSeg = false } = {}) {
  const input = doc.createElement('input');
  input.type = 'text';
  input.className = `hd-seg hd-slot${size === 'sm' ? ' hd-slot-sm' : size === 'xs' ? ' hd-slot-xs' : size === 'wide' ? ' hd-slot-wide' : ''}`;
  input.value = value || '';
  input.setAttribute('value', value || '');
  input.setAttribute('data-slot-size', size);
  input.setAttribute('data-has-siblings', hasSiblings ? 'true' : 'false');
  if (isRootSeg) input.setAttribute('data-root-seg', 'true');
  if (!hasSiblings && !isRootSeg && ph) {
    input.setAttribute('placeholder', ph);
  } else {
    input.setAttribute('placeholder', '');
  }
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  syncSegInputSize(input);
  return input;
}

/**
 * Enforce the alternating invariant `[seg_0, node_0, seg_1, ..., node_{k-1}, seg_k]`
 * inside a `.hd-math-slot` element and refresh placeholder/sibling attributes.
 */
export function normalizeSlotDom(slotEl) {
  if (!slotEl) return;
  const doc = slotEl.ownerDocument;
  const ph = slotEl.getAttribute('data-slot-ph') || '';
  const size = slotEl.getAttribute('data-slot-size') || 'md';
  const isRootSlot = slotEl.classList.contains('hd-math-root-slot');

  const rawChildren = Array.from(slotEl.children);
  const formulaNodes = rawChildren.filter((c) => c.classList.contains('hd-node'));
  const hasSiblings = formulaNodes.length > 0;

  // Ensure every slot starts with a seg, alternates seg/node, and ends with a seg
  // Merge adjacent segs if any exist (e.g., right after removing a child node)
  let i = 0;
  while (i < slotEl.children.length) {
    const cur = slotEl.children[i];
    const next = slotEl.children[i + 1];
    if (cur.matches('input.hd-seg') && next && next.matches('input.hd-seg')) {
      cur.value = (cur.value || '') + (next.value || '');
      next.remove();
      continue;
    }
    i += 1;
  }

  // Ensure leading seg
  if (!slotEl.firstElementChild || !slotEl.firstElementChild.matches('input.hd-seg')) {
    slotEl.insertBefore(
      createSegInputEl(doc, '', { ph, size, hasSiblings, isRootSeg: isRootSlot }),
      slotEl.firstElementChild
    );
  }

  // Ensure seg between every two adjacent formula nodes and trailing seg
  const childrenSnapshot = Array.from(slotEl.children);
  for (let idx = 0; idx < childrenSnapshot.length; idx += 1) {
    const el = childrenSnapshot[idx];
    if (el.classList.contains('hd-node')) {
      const next = el.nextElementSibling;
      if (!next || !next.matches('input.hd-seg')) {
        slotEl.insertBefore(
          createSegInputEl(doc, '', { ph, size, hasSiblings, isRootSeg: isRootSlot }),
          next
        );
      }
    }
  }

  // Refresh metadata & widths on all direct seg inputs in this slot
  const updatedHasSiblings = Boolean(slotEl.querySelector(':scope > .hd-node'));
  Array.from(slotEl.children).forEach((child) => {
    if (!child.matches('input.hd-seg')) return;
    child.setAttribute('data-has-siblings', updatedHasSiblings ? 'true' : 'false');
    child.setAttribute('data-slot-size', size);
    if (isRootSlot) child.setAttribute('data-root-seg', 'true');
    if (!updatedHasSiblings && !isRootSlot && ph) {
      child.setAttribute('placeholder', ph);
    } else {
      child.setAttribute('placeholder', '');
    }
    syncSegInputSize(child);
  });
}

function buildSlotEl(doc, slotNodes, slotIndex, { ph = '', size = 'md', isRootSlot = false } = {}) {
  const slotEl = doc.createElement('span');
  slotEl.className = isRootSlot ? 'hd-math-slot hd-math-root-slot' : 'hd-math-slot';
  slotEl.setAttribute('data-slot-index', String(slotIndex));
  slotEl.setAttribute('data-slot-ph', ph);
  slotEl.setAttribute('data-slot-size', size);

  const normalized = normalizeSlotNodes(slotNodes);
  const hasFormula = normalized.some((n) => n.type !== 'text');

  // Build alternating segs and formula nodes
  let pendingText = '';
  const flushSeg = () => {
    slotEl.appendChild(
      createSegInputEl(doc, pendingText, {
        ph,
        size,
        hasSiblings: hasFormula,
        isRootSeg: isRootSlot,
      })
    );
    pendingText = '';
  };

  for (const node of normalized) {
    if (node.type === 'text') {
      pendingText += node.value || '';
    } else {
      flushSeg();
      const childDom = buildFormulaNodeEl(doc, node);
      if (childDom) slotEl.appendChild(childDom);
    }
  }
  flushSeg();

  normalizeSlotDom(slotEl);
  return slotEl;
}

function createSvgRadical(doc) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'hd-eq-radical-svg');
  svg.setAttribute('viewBox', '0 0 18 28');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', 'M1.5 16.5 L5.5 16.5 L9.2 26 L16.2 1.8 L18 1.8');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  return svg;
}

function createSvgBrace(doc) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'hd-eq-brace-svg');
  svg.setAttribute('viewBox', '0 0 14 60');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M12 2 C6.5 2, 6.5 7, 6.5 13 L6.5 22 C6.5 27, 4.5 30, 1.5 30 C4.5 30, 6.5 33, 6.5 38 L6.5 47 C6.5 53, 6.5 58, 12 58'
  );
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  return svg;
}

export function buildFormulaNodeEl(doc, node) {
  if (!node || typeof node !== 'object') return null;
  const type = normalizeNodeType(node.type);
  const spec = NODE_SPECS[type];
  if (!spec || type === 'expr' || type === 'text') return null;

  const slots = Array.isArray(node.slots) ? node.slots : [];
  const makeSlot = (idx) => {
    const meta = spec.slots[idx] || spec.slots[spec.slots.length - 1] || { ph: '', size: 'md' };
    return buildSlotEl(doc, slots[idx] || [], idx, { ph: meta.ph, size: meta.size });
  };

  const wrapper = doc.createElement('span');
  wrapper.className = `hd-node hd-node-${type}`;
  wrapper.setAttribute('data-node-type', type);

  const el = (tag, cls, text = '') => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  switch (type) {
    case 'fraction': {
      const frac = el('span', 'hd-eq-frac');
      const numWrap = el('span', 'hd-eq-frac-num');
      numWrap.appendChild(makeSlot(0));
      const bar = el('span', 'hd-eq-frac-bar');
      bar.setAttribute('aria-hidden', 'true');
      const denWrap = el('span', 'hd-eq-frac-den');
      denWrap.appendChild(makeSlot(1));
      frac.append(numWrap, bar, denWrap);
      wrapper.appendChild(frac);
      break;
    }
    case 'sqrt': {
      const root = el('span', 'hd-eq-root');
      const rad = el('span', 'hd-eq-radicand');
      rad.appendChild(makeSlot(0));
      root.append(createSvgRadical(doc), rad);
      wrapper.appendChild(root);
      break;
    }
    case 'nthroot': {
      const root = el('span', 'hd-eq-root hd-eq-nthroot');
      const idxWrap = el('span', 'hd-eq-root-idx');
      idxWrap.appendChild(makeSlot(0));
      const rad = el('span', 'hd-eq-radicand');
      rad.appendChild(makeSlot(1));
      root.append(idxWrap, createSvgRadical(doc), rad);
      wrapper.appendChild(root);
      break;
    }
    case 'power': {
      const sc = el('span', 'hd-eq-script');
      const base = el('span', 'hd-eq-base');
      base.appendChild(makeSlot(0));
      const sup = el('span', 'hd-eq-sup');
      sup.appendChild(makeSlot(1));
      sc.append(base, sup);
      wrapper.appendChild(sc);
      break;
    }
    case 'subscript': {
      const sc = el('span', 'hd-eq-script');
      const base = el('span', 'hd-eq-base');
      base.appendChild(makeSlot(0));
      const sub = el('span', 'hd-eq-sub');
      sub.appendChild(makeSlot(1));
      sc.append(base, sub);
      wrapper.appendChild(sc);
      break;
    }
    case 'integral': {
      const big = el('span', 'hd-eq-bigop');
      // DOM order: lower -> sym -> upper; CSS column-reverse puts upper on top visually
      // while keeping DFS keyboard navigation in natural mathematical order (lower -> upper -> expr -> var)!
      const stack = el('span', 'hd-eq-bigop-stack hd-eq-stack-rev');
      const sym = el('span', 'hd-eq-bigop-sym', '∫');
      sym.setAttribute('aria-hidden', 'true');
      stack.append(makeSlot(0), sym, makeSlot(1));
      const dLit = el('span', 'hd-eq-lit', 'd');
      big.append(stack, makeSlot(2), dLit, makeSlot(3));
      wrapper.appendChild(big);
      break;
    }
    case 'limit': {
      const lim = el('span', 'hd-eq-lim');
      const stack = el('span', 'hd-eq-lim-stack');
      const word = el('span', 'hd-eq-lim-word', 'lim');
      const sub = el('span', 'hd-eq-lim-sub');
      const arrow = el('span', 'hd-eq-lit-sm', '→');
      sub.append(makeSlot(0), arrow, makeSlot(1));
      stack.append(word, sub);
      lim.append(stack, makeSlot(2));
      wrapper.appendChild(lim);
      break;
    }
    case 'sum': {
      const big = el('span', 'hd-eq-bigop');
      const stack = el('span', 'hd-eq-bigop-stack hd-eq-stack-rev');
      const sym = el('span', 'hd-eq-bigop-sym', '∑');
      sym.setAttribute('aria-hidden', 'true');
      stack.append(makeSlot(0), sym, makeSlot(1));
      big.append(stack, makeSlot(2));
      wrapper.appendChild(big);
      break;
    }
    case 'system': {
      const sys = el('span', 'hd-eq-cases');
      const rowsWrap = el('span', 'hd-eq-cases-rows');
      const rowCount = Math.max(2, slots.length);
      for (let r = 0; r < rowCount; r += 1) {
        rowsWrap.appendChild(makeSlot(r));
      }
      sys.append(createSvgBrace(doc), rowsWrap);
      wrapper.appendChild(sys);
      break;
    }
    case 'reaction': {
      const rx = el('span', 'hd-eq-chem-arrow');
      const line = el('span', 'hd-eq-arrow-line');
      line.setAttribute('aria-hidden', 'true');
      const shaft = el('span', 'hd-eq-arrow-shaft');
      const head = el('span', 'hd-eq-arrow-head', '▸');
      line.append(shaft, head);
      rx.append(makeSlot(0), line);
      wrapper.appendChild(rx);
      break;
    }
    case 'oxid': {
      const ox = el('span', 'hd-eq-ox');
      ox.append(makeSlot(0), makeSlot(1));
      wrapper.appendChild(ox);
      break;
    }
    case 'vector': {
      const acc = el('span', 'hd-eq-accent');
      const top = el('span', 'hd-eq-accent-top', '→');
      top.setAttribute('aria-hidden', 'true');
      acc.append(top, makeSlot(0));
      wrapper.appendChild(acc);
      break;
    }
    case 'angle': {
      const acc = el('span', 'hd-eq-accent');
      const top = el('span', 'hd-eq-accent-top', '^');
      top.setAttribute('aria-hidden', 'true');
      acc.append(top, makeSlot(0));
      wrapper.appendChild(acc);
      break;
    }
    case 'molarity': {
      const m = el('span', 'hd-eq-molar');
      m.append(el('span', 'hd-eq-lit', '['), makeSlot(0), el('span', 'hd-eq-lit', ']'));
      wrapper.appendChild(m);
      break;
    }
    case 'ionPos': {
      const sc = el('span', 'hd-eq-script');
      const base = el('span', 'hd-eq-base');
      base.appendChild(makeSlot(0));
      const sup = el('span', 'hd-eq-sup');
      sup.append(makeSlot(1), el('span', 'hd-eq-lit-sm', '+'));
      sc.append(base, sup);
      wrapper.appendChild(sc);
      break;
    }
    case 'ionNeg': {
      const sc = el('span', 'hd-eq-script');
      const base = el('span', 'hd-eq-base');
      base.appendChild(makeSlot(0));
      const sup = el('span', 'hd-eq-sup');
      sup.append(makeSlot(1), el('span', 'hd-eq-lit-sm', '−'));
      sc.append(base, sup);
      wrapper.appendChild(sc);
      break;
    }
    default:
      return null;
  }

  return wrapper;
}

function renderSafeKatexPrint(latex, displayMode = false) {
  if (!latex) return '';
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return latex;
  }
}

/**
 * Create a complete atomic `.inline-formula-node.hd-eq` root DOM element
 * containing both the recursive interactive editor tree and the print-only KaTeX span.
 */
export function createMathWidgetElement(doc, tree, formulaId = null) {
  const normalized = normalizeMathTree(tree);
  const { latex, displayMode } = serializeMathTreeToLatex(normalized);
  const id = formulaId || `math_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const root = doc.createElement('span');
  root.className = 'inline-formula-node hd-eq';
  root.setAttribute('contenteditable', 'false');
  root.setAttribute('data-math-id', id);
  root.setAttribute('data-eq-type', 'expr');
  root.setAttribute('data-math-tree', JSON.stringify(normalized));
  root.setAttribute('data-latex', latex);
  if (displayMode) root.setAttribute('data-math-display', 'true');

  const interactive = doc.createElement('span');
  interactive.className = 'hd-eq-interactive';
  interactive.appendChild(
    buildSlotEl(doc, normalized.slots[0], 0, { ph: '', size: 'md', isRootSlot: true })
  );

  const printSpan = doc.createElement('span');
  printSpan.className = 'hd-eq-print-katex';
  printSpan.setAttribute('aria-hidden', 'true');
  printSpan.innerHTML = renderSafeKatexPrint(latex, displayMode);

  root.append(interactive, printSpan);
  return root;
}

/**
 * Render an HTML string for an interactive recursive `.hd-eq` widget (used during
 * initial document hydration from saved `doc.mathNodes` or `markdownToEditorHtml`).
 */
export function renderMathWidgetHtml(tree, formulaId = null) {
  if (typeof document === 'undefined') return '';
  const el = createMathWidgetElement(document, tree, formulaId);
  return el.outerHTML;
}

// ============================================================================
// Read Live Recursive MathNode Tree Back From DOM
// ============================================================================

function readSlotFromDom(slotEl) {
  if (!slotEl) return [];
  const nodes = [];
  Array.from(slotEl.children).forEach((child) => {
    if (child.matches('input.hd-seg')) {
      const val = child.value ?? child.getAttribute('value') ?? '';
      if (val) {
        nodes.push(createTextNode(val));
      }
    } else if (child.classList.contains('hd-node')) {
      const parsed = readFormulaNodeFromDom(child);
      if (parsed) nodes.push(parsed);
    }
  });
  return normalizeSlotNodes(nodes);
}

function findDirectSlotsOfNode(nodeEl) {
  // Collect `.hd-math-slot` elements whose closest ancestor `.hd-node` IS `nodeEl`
  const all = Array.from(nodeEl.querySelectorAll('.hd-math-slot'));
  const owned = all.filter((sl) => sl.closest('.hd-node') === nodeEl);
  owned.sort(
    (a, b) => Number(a.getAttribute('data-slot-index') || 0) - Number(b.getAttribute('data-slot-index') || 0)
  );
  return owned;
}

function readFormulaNodeFromDom(nodeEl) {
  const type = normalizeNodeType(nodeEl?.getAttribute?.('data-node-type'));
  if (!type || !NODE_SPECS[type]) return null;
  const slotEls = findDirectSlotsOfNode(nodeEl);
  const slots = slotEls.map((sl) => readSlotFromDom(sl));
  return { type, slots };
}

export function readMathTreeFromDom(rootEqEl) {
  if (!rootEqEl) return createRootExprTree();
  const rootSlot = rootEqEl.querySelector('.hd-math-root-slot');
  if (rootSlot) {
    return {
      type: 'expr',
      slots: [readSlotFromDom(rootSlot)],
    };
  }
  // Fallback: stored JSON attribute if DOM is unavailable
  const rawJson = rootEqEl.getAttribute?.('data-math-tree');
  if (rawJson) {
    try {
      return normalizeMathTree(JSON.parse(rawJson));
    } catch {
      // ignore invalid json
    }
  }
  return createRootExprTree();
}

/**
 * Sync a `.hd-eq` widget's `data-math-tree`, `data-latex`, and `.hd-eq-print-katex`
 * in-place without disturbing focus or parent `contentEditable` DOM.
 */
export function syncMathWidgetState(rootEqEl, updatePrintKatex = true) {
  if (!rootEqEl) return { tree: createRootExprTree(), latex: '', displayMode: false };
  const tree = readMathTreeFromDom(rootEqEl);
  const { latex, displayMode } = serializeMathTreeToLatex(tree);
  rootEqEl.setAttribute('data-math-tree', JSON.stringify(tree));
  rootEqEl.setAttribute('data-latex', latex);
  if (displayMode) rootEqEl.setAttribute('data-math-display', 'true');
  else rootEqEl.removeAttribute('data-math-display');

  if (updatePrintKatex) {
    const printSpan = rootEqEl.querySelector(':scope > .hd-eq-print-katex');
    if (printSpan) {
      printSpan.innerHTML = renderSafeKatexPrint(latex, displayMode);
    }
  }
  return { tree, latex, displayMode };
}

/**
 * Refresh print-ready KaTeX HTML for every interactive `.hd-eq` widget inside `editorEl`
 * right before `window.print()` (Export PDF).
 */
export function refreshPrintKatexForEditor(editorEl) {
  if (!editorEl) return;
  editorEl.querySelectorAll('.hd-eq').forEach((eqEl) => {
    syncMathWidgetState(eqEl, true);
  });
}

/**
 * Extract all structured recursive `MathNode` trees from the live editor so they can be
 * persisted losslessly alongside `doc.content` in `localStorage`, IndexedDB, and Supabase
 * `user_workspaces`.
 *
 * Returns a dictionary keyed by trimmed LaTeX string -> normalized `MathNode` tree.
 */
export function extractMathTreesFromEditor(editorEl) {
  if (!editorEl) return {};
  const map = {};
  editorEl.querySelectorAll('.hd-eq').forEach((eqEl) => {
    const { tree, latex } = syncMathWidgetState(eqEl, false);
    const key = String(latex || '').trim();
    if (key && !isTreeEmpty(tree)) {
      map[key] = tree;
    }
  });
  return map;
}

// ============================================================================
// Surgical In-Slot Editing Operations (Desmos Shortcuts, Nesting, Unwrapping)
// ============================================================================

export function focusSegInput(inputEl, pos = 0) {
  if (!inputEl) return;
  inputEl.focus({ preventScroll: true });
  const len = inputEl.value.length;
  const clamped = pos === 'end' ? len : Math.max(0, Math.min(len, Number(pos) || 0));
  inputEl.setSelectionRange?.(clamped, clamped);
}

/**
 * Find the first editable `<input class="hd-seg">` inside a specific slot index of a node.
 */
export function findSlotFirstSeg(nodeEl, slotIndex = 0) {
  const slots = findDirectSlotsOfNode(nodeEl);
  const slotEl = slots[slotIndex] || slots[0];
  return slotEl?.querySelector('input.hd-seg') || null;
}

export function findSlotLastSeg(nodeEl, slotIndex = -1) {
  const slots = findDirectSlotsOfNode(nodeEl);
  const slotEl = slotIndex < 0 ? slots[slots.length - 1] : slots[slotIndex];
  const segs = slotEl?.querySelectorAll('input.hd-seg');
  return segs && segs.length > 0 ? segs[segs.length - 1] : null;
}

/**
 * Extract the preceding term from `beforeText` for Desmos shortcuts (`/` vs `^` / `_`).
 * Returns `{ keepBefore: string, extracted: string }`.
 */
function extractPrecedingTerm(beforeText, mode) {
  const raw = String(beforeText || '');
  if (!raw) return { keepBefore: '', extracted: '' };

  const trimmedEnd = raw.replace(/\s+$/, '');
  if (!trimmedEnd) return { keepBefore: raw, extracted: '' };

  // If ends with balanced parentheses `(...)`, extract the parenthesized group
  if (trimmedEnd.endsWith(')')) {
    let depth = 0;
    for (let k = trimmedEnd.length - 1; k >= 0; k -= 1) {
      if (trimmedEnd[k] === ')') depth += 1;
      else if (trimmedEnd[k] === '(') {
        depth -= 1;
        if (depth === 0) {
          let start = k;
          // Include function name before `(` for fractions, e.g. `sin(x)/`
          if (mode === 'fraction') {
            const fnMatch = trimmedEnd.slice(0, k).match(/([a-zA-Z]+)$/);
            if (fnMatch) start -= fnMatch[1].length;
          }
          const group = trimmedEnd.slice(start);
          // For pure `(a+b)/` with no function prefix, strip outer parens cleanly just like Desmos
          const unwrapped =
            mode === 'fraction' && start === k && group.startsWith('(') && group.endsWith(')')
              ? group.slice(1, -1)
              : group;
          return {
            keepBefore: trimmedEnd.slice(0, start),
            extracted: unwrapped,
          };
        }
      }
    }
  }

  if (mode === 'fraction') {
    // Split on lowest-precedence operators (`+`, `-`, `−`, `=`, `,`, `;`, `:`, `<`, `>`, `≤`, `≥`, `≠`, `⇒`, `⇔`, `±`, `→`, `⇌`)
    const match = trimmedEnd.match(/^(.*[+\-−=,;:<>≤≥≠⇒⇔±→⇌]\s*)([^\s+\-−=,;:<>≤≥≠⇒⇔±→⇌].*)$/);
    if (match) {
      return { keepBefore: match[1], extracted: match[2].trim() };
    }
    return { keepBefore: '', extracted: trimmedEnd };
  }

  // For `power` (`^`) and `subscript` (`_`): grab the trailing number OR single variable/Greek letter
  const tokenMatch = trimmedEnd.match(/^(.*?)(\d+(?:\.\d+)?|[a-zA-Zα-ωΑ-ΩπΔΩ])$/);
  if (tokenMatch) {
    return { keepBefore: tokenMatch[1], extracted: tokenMatch[2] };
  }

  return { keepBefore: raw, extracted: '' };
}

/**
 * Insert a new child formula node nested inside the currently active `<input class="hd-seg">`.
 * Supports optional wrapping of selected text OR Desmos-style preceding-term wrapping (`/` / `^` / `_`).
 */
export function insertNestedNodeAtSeg(segInput, rawType, { wrapMode = null } = {}) {
  const slotEl = segInput?.closest?.('.hd-math-slot');
  const rootEqEl = segInput?.closest?.('.hd-eq');
  if (!slotEl || !rootEqEl) return false;

  const doc = slotEl.ownerDocument;
  const type = normalizeNodeType(rawType);
  if (!NODE_SPECS[type]) return false;

  const val = segInput.value || '';
  const start = segInput.selectionStart ?? val.length;
  const end = segInput.selectionEnd ?? start;
  const before = val.slice(0, start);
  const selected = val.slice(start, end);
  const after = val.slice(end);

  let initialSlot0 = [];
  let focusSlotIdx = 0;

  if (selected) {
    // Wrap highlighted text into slot 0 (numerator / radicand / base)
    initialSlot0 = [createTextNode(selected)];
    segInput.value = before;
    focusSlotIdx = NODE_SPECS[type].slots.length > 1 ? 1 : 0;
  } else if (wrapMode) {
    const { keepBefore, extracted } = extractPrecedingTerm(before, wrapMode);
    if (extracted) {
      initialSlot0 = [createTextNode(extracted)];
      segInput.value = keepBefore;
      focusSlotIdx = 1;
    } else if (!before.trim() && segInput.previousElementSibling?.classList?.contains('hd-node')) {
      // Pull the immediately preceding sibling formula node into slot 0!
      // e.g. `\sqrt{x^2+1}` + `/` -> `\frac{\sqrt{x^2+1}}{\square}`
      const prevNodeEl = segInput.previousElementSibling;
      const prevTree = readFormulaNodeFromDom(prevNodeEl);
      if (prevTree) {
        initialSlot0 = [prevTree];
        prevNodeEl.remove();
        // Keep any text from the segment before prevNodeEl intact
        segInput.value = '';
        focusSlotIdx = 1;
      }
    } else {
      segInput.value = before;
      focusSlotIdx = 0;
    }
  } else {
    segInput.value = before;
    focusSlotIdx = 0;
  }

  const newNode = createMathNode(type, initialSlot0.length > 0 ? [initialSlot0] : []);
  if (!newNode) return false;
  const newNodeEl = buildFormulaNodeEl(doc, newNode);
  if (!newNodeEl) return false;

  const afterSeg = createSegInputEl(doc, after, {
    ph: slotEl.getAttribute('data-slot-ph') || '',
    size: slotEl.getAttribute('data-slot-size') || 'md',
    hasSiblings: true,
    isRootSeg: slotEl.classList.contains('hd-math-root-slot'),
  });

  // Insert `[newNodeEl, afterSeg]` right after `segInput`
  const refNext = segInput.nextSibling;
  slotEl.insertBefore(newNodeEl, refNext);
  slotEl.insertBefore(afterSeg, newNodeEl.nextSibling);

  normalizeSlotDom(slotEl);
  syncMathWidgetState(rootEqEl, true);

  const targetSeg = findSlotFirstSeg(newNodeEl, focusSlotIdx);
  if (targetSeg) {
    focusSegInput(targetSeg, targetSeg.value.length);
  }
  return true;
}

/**
 * Unwrap a child `.hd-node` in-place, splicing the DOM contents of `keepSlotIndex`
 * (or deleting the node cleanly if `keepSlotIndex === null`) into its parent `.hd-math-slot`,
 * then placing the caret cleanly without flickering.
 */
function unwrapOrDeleteChildNode(nodeEl, keepSlotIndex = null, caretAt = 'end', editorEl = null) {
  const parentSlot = nodeEl?.parentElement?.closest?.('.hd-math-slot');
  const rootEqEl = nodeEl?.closest?.('.hd-eq');
  if (!parentSlot || !rootEqEl) return false;

  const doc = parentSlot.ownerDocument;
  const prevSeg = nodeEl.previousElementSibling?.matches?.('input.hd-seg')
    ? nodeEl.previousElementSibling
    : null;
  const nextSeg = nodeEl.nextElementSibling?.matches?.('input.hd-seg')
    ? nodeEl.nextElementSibling
    : null;

  const prevLen = prevSeg ? prevSeg.value.length : 0;

  let extractedNodes = [];
  if (keepSlotIndex !== null) {
    const slots = findDirectSlotsOfNode(nodeEl);
    const keepSlotEl = slots[keepSlotIndex];
    if (keepSlotEl) {
      extractedNodes = readSlotFromDom(keepSlotEl);
    }
  }

  if (extractedNodes.length === 0) {
    // Clean deletion: remove nodeEl and merge prevSeg + nextSeg
    nodeEl.remove();
    normalizeSlotDom(parentSlot);

    // If this was the sole empty node inside the root expression, remove the empty root widget cleanly
    if (parentSlot.classList.contains('hd-math-root-slot') && isTreeEmpty(readMathTreeFromDom(rootEqEl))) {
      const parent = rootEqEl.parentNode;
      const prev = rootEqEl.previousSibling;
      rootEqEl.remove();
      if (editorEl) {
        editorEl.focus({ preventScroll: true });
        const sel = window.getSelection();
        if (sel) {
          const r = doc.createRange();
          if (prev && prev.nodeType === 3) {
            r.setStart(prev, prev.nodeValue.length);
          } else if (parent) {
            r.selectNodeContents(parent);
          }
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
      return true;
    }

    syncMathWidgetState(rootEqEl, true);

    if (prevSeg && prevSeg.isConnected) {
      focusSegInput(prevSeg, prevLen);
    } else if (nextSeg && nextSeg.isConnected) {
      focusSegInput(nextSeg, 0);
    } else {
      const firstSeg = parentSlot.querySelector('input.hd-seg');
      if (firstSeg) focusSegInput(firstSeg, 0);
    }
    return true;
  }

  // Splice extractedNodes into parentSlot where nodeEl was
  const insertedElements = [];
  for (const n of extractedNodes) {
    if (n.type === 'text') {
      const s = createSegInputEl(doc, n.value, {
        ph: parentSlot.getAttribute('data-slot-ph') || '',
        size: parentSlot.getAttribute('data-slot-size') || 'md',
        hasSiblings: true,
        isRootSeg: parentSlot.classList.contains('hd-math-root-slot'),
      });
      parentSlot.insertBefore(s, nodeEl);
      insertedElements.push(s);
    } else {
      const childDom = buildFormulaNodeEl(doc, n);
      if (childDom) {
        parentSlot.insertBefore(childDom, nodeEl);
        insertedElements.push(childDom);
      }
    }
  }

  // Calculate caret offset if first extracted element merges into prevSeg
  const firstExtractedTextLen =
    extractedNodes[0]?.type === 'text' ? extractedNodes[0].value.length : 0;

  nodeEl.remove();
  normalizeSlotDom(parentSlot);
  syncMathWidgetState(rootEqEl, true);

  if (caretAt === 'start') {
    if (prevSeg && prevSeg.isConnected) {
      focusSegInput(prevSeg, prevLen);
    } else {
      const first = parentSlot.querySelector('input.hd-seg');
      if (first) focusSegInput(first, 0);
    }
  } else {
    // Place caret right at the end of the unwrapped content
    const lastInserted = insertedElements[insertedElements.length - 1];
    if (lastInserted && lastInserted.isConnected) {
      if (lastInserted.matches('input.hd-seg')) {
        focusSegInput(lastInserted, lastInserted.value.length);
      } else {
        const trailing = lastInserted.nextElementSibling;
        if (trailing?.matches?.('input.hd-seg')) {
          focusSegInput(trailing, 0);
        }
      }
    } else if (prevSeg && prevSeg.isConnected) {
      focusSegInput(prevSeg, prevLen + firstExtractedTextLen);
    }
  }

  return true;
}

/**
 * Handle all Desmos keyboard interactions inside any recursive `.hd-eq` widget:
 *  - `/` -> wrap preceding term into fraction numerator, focus denominator
 *  - `^` -> create superscript exponent slot (wrapping preceding base)
 *  - `_` -> create subscript slot (wrapping preceding base)
 *  - `ArrowRight` / `ArrowLeft` -> smooth DFS traversal into & out of nested child slots
 *  - `Tab` / `Shift+Tab` -> jump across distinct slots in DFS order
 *  - `Enter` / `Escape` -> advance slot or exit formula cleanly
 *  - `Backspace` -> step into preceding child formula or cleanly unwrap/delete empty nested block
 *
 * Returns `{ handled: boolean, mutated: boolean }`.
 */
export function handleRecursiveMathKeyDown(editorEl, e, exitInlineEqFn) {
  const target = e.target;
  if (
    !target ||
    target.tagName !== 'INPUT' ||
    !target.classList.contains('hd-seg') ||
    !editorEl?.contains(target)
  ) {
    return { handled: false, mutated: false };
  }

  const rootEqEl = target.closest('.hd-eq');
  if (!rootEqEl) return { handled: false, mutated: false };

  // Never intercept modified shortcuts like Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+Z
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return { handled: false, mutated: false };
  }

  // 1. Desmos inline shortcuts: `/`, `^`, `_`
  if (e.key === '/') {
    e.preventDefault();
    const ok = insertNestedNodeAtSeg(target, 'fraction', { wrapMode: 'fraction' });
    return { handled: true, mutated: ok };
  }
  if (e.key === '^') {
    e.preventDefault();
    const ok = insertNestedNodeAtSeg(target, 'power', { wrapMode: 'script' });
    return { handled: true, mutated: ok };
  }
  if (e.key === '_') {
    e.preventDefault();
    const ok = insertNestedNodeAtSeg(target, 'subscript', { wrapMode: 'script' });
    return { handled: true, mutated: ok };
  }

  const allSegs = Array.from(rootEqEl.querySelectorAll('input.hd-seg'));
  const segIdx = allSegs.indexOf(target);

  // 2. Escape -> exit root formula right after it
  if (e.key === 'Escape') {
    e.preventDefault();
    exitInlineEqFn(editorEl, rootEqEl, 'after');
    return { handled: true, mutated: false };
  }

  // 3. Tab / Shift+Tab -> jump to next/previous distinct slot (skipping intermediate boundary segs of the same slot)
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault();
    const currentSlot = target.closest('.hd-math-slot');
    const allSlots = Array.from(rootEqEl.querySelectorAll('.hd-math-slot')).filter(
      (sl) => !sl.classList.contains('hd-math-root-slot')
    );

    if (e.key === 'Tab' && e.shiftKey) {
      const slotPos = allSlots.indexOf(currentSlot);
      if (slotPos > 0) {
        const prevSlotSegs = allSlots[slotPos - 1].querySelectorAll('input.hd-seg');
        const lastSeg = prevSlotSegs[prevSlotSegs.length - 1];
        if (lastSeg) {
          focusSegInput(lastSeg, 'end');
          return { handled: true, mutated: false };
        }
      }
      exitInlineEqFn(editorEl, rootEqEl, 'before');
      return { handled: true, mutated: false };
    }

    const slotPos = allSlots.indexOf(currentSlot);
    if (slotPos >= 0 && slotPos < allSlots.length - 1) {
      // Skip descendant slots only if moving forward from a slot with children; otherwise enter next slot in DFS order
      const nextSlot = allSlots[slotPos + 1];
      const firstSeg = nextSlot.querySelector('input.hd-seg');
      if (firstSeg) {
        focusSegInput(firstSeg, 0);
        return { handled: true, mutated: false };
      }
    }
    exitInlineEqFn(editorEl, rootEqEl, 'after');
    return { handled: true, mutated: false };
  }

  // 4. ArrowRight -> step smoothly into child slots and out to parent/root slots
  if (e.key === 'ArrowRight') {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (start === end && end >= target.value.length) {
      e.preventDefault();
      if (segIdx >= 0 && segIdx < allSegs.length - 1) {
        focusSegInput(allSegs[segIdx + 1], 0);
      } else {
        exitInlineEqFn(editorEl, rootEqEl, 'after');
      }
      return { handled: true, mutated: false };
    }
    return { handled: false, mutated: false };
  }

  // 5. ArrowLeft -> step smoothly backward into previous child/parent slots
  if (e.key === 'ArrowLeft') {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (start === 0 && end === 0) {
      e.preventDefault();
      if (segIdx > 0) {
        focusSegInput(allSegs[segIdx - 1], 'end');
      } else {
        exitInlineEqFn(editorEl, rootEqEl, 'before');
      }
      return { handled: true, mutated: false };
    }
    return { handled: false, mutated: false };
  }

  // 6. Backspace at caret offset 0 -> Desmos-style step-in, unwrap, or clean delete
  if (e.key === 'Backspace') {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (start !== 0 || end !== 0) {
      return { handled: false, mutated: false };
    }

    const currentSlot = target.closest('.hd-math-slot');
    const prevSib = target.previousElementSibling;

    // Case A: Immediately after a sibling child formula `.hd-node` in the same slot
    if (prevSib && prevSib.classList.contains('hd-node')) {
      e.preventDefault();
      const prevTree = readFormulaNodeFromDom(prevSib);
      if (isNodeContentEmpty(prevTree)) {
        const ok = unwrapOrDeleteChildNode(prevSib, null, 'end', editorEl);
        return { handled: true, mutated: ok };
      }
      // Step into the last segment of that sibling child formula (just like Desmos)
      const lastSeg = findSlotLastSeg(prevSib, -1);
      if (lastSeg) {
        focusSegInput(lastSeg, 'end');
        return { handled: true, mutated: false };
      }
    }

    // Case B: At start of the first segment of a slot inside a nested `.hd-node`
    const ownerNode = currentSlot?.closest('.hd-node');
    if (ownerNode && currentSlot && !currentSlot.classList.contains('hd-math-root-slot')) {
      e.preventDefault();
      const nodeType = normalizeNodeType(ownerNode.getAttribute('data-node-type'));
      const slotIndex = Number(currentSlot.getAttribute('data-slot-index') || 0);
      const ownerTree = readFormulaNodeFromDom(ownerNode);
      const slotContentEmpty = isSlotEmpty(readSlotFromDom(currentSlot));

      // If the entire nested formula is empty -> delete it cleanly
      if (isNodeContentEmpty(ownerTree)) {
        const ok = unwrapOrDeleteChildNode(ownerNode, null, 'end', editorEl);
        return { handled: true, mutated: ok };
      }

      // If current slot is empty:
      if (slotContentEmpty) {
        // Fraction with empty denominator -> unwrap numerator back into parent slot!
        if (nodeType === 'fraction' && slotIndex === 1) {
          const ok = unwrapOrDeleteChildNode(ownerNode, 0, 'end', editorEl);
          return { handled: true, mutated: ok };
        }
        // Power / Subscript / Ion with empty exponent/subscript -> unwrap base back into parent slot!
        if (
          (nodeType === 'power' ||
            nodeType === 'subscript' ||
            nodeType === 'ionPos' ||
            nodeType === 'ionNeg') &&
          slotIndex === 1
        ) {
          const ok = unwrapOrDeleteChildNode(ownerNode, 0, 'end', editorEl);
          return { handled: true, mutated: ok };
        }
        // Nthroot with empty index -> unwrap radicand cleanly (or convert to sqrt)
        if (nodeType === 'nthroot' && slotIndex === 0) {
          const ok = unwrapOrDeleteChildNode(ownerNode, 1, 'start', editorEl);
          return { handled: true, mutated: ok };
        }
        // Nthroot with empty radicand -> delete block
        if (nodeType === 'nthroot' && slotIndex === 1) {
          const ok = unwrapOrDeleteChildNode(ownerNode, null, 'end', editorEl);
          return { handled: true, mutated: ok };
        }
        // Single-slot wrapper empty -> delete cleanly
        if (NODE_SPECS[nodeType]?.slots.length === 1) {
          const ok = unwrapOrDeleteChildNode(ownerNode, null, 'end', editorEl);
          return { handled: true, mutated: ok };
        }
        // Multi-slot operator (integral, limit, sum, system, oxid): jump back to previous slot
        if (slotIndex > 0) {
          const prevSlotSeg = findSlotLastSeg(ownerNode, slotIndex - 1);
          if (prevSlotSeg) {
            focusSegInput(prevSlotSeg, 'end');
            return { handled: true, mutated: false };
          }
        }
      }

      // Non-empty slot at offset 0:
      // Unwrap single-slot wrappers like `\sqrt{|x+1}`, `\vec{|a}`, `[|M]`
      if (
        slotIndex === 0 &&
        (nodeType === 'sqrt' ||
          nodeType === 'vector' ||
          nodeType === 'angle' ||
          nodeType === 'molarity')
      ) {
        const ok = unwrapOrDeleteChildNode(ownerNode, 0, 'start', editorEl);
        return { handled: true, mutated: ok };
      }

      // Otherwise move cleanly to previous segment in DFS order without destroying content
      if (segIdx > 0) {
        focusSegInput(allSegs[segIdx - 1], 'end');
      } else {
        exitInlineEqFn(editorEl, rootEqEl, 'before');
      }
      return { handled: true, mutated: false };
    }

    // Case C: At start of root `expr` slot
    const rootTree = readMathTreeFromDom(rootEqEl);
    if (isTreeEmpty(rootTree)) {
      e.preventDefault();
      const parent = rootEqEl.parentNode;
      const prev = rootEqEl.previousSibling;
      rootEqEl.remove();
      editorEl.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const r = editorEl.ownerDocument.createRange();
        if (prev && prev.nodeType === 3) {
          r.setStart(prev, prev.nodeValue.length);
        } else if (parent) {
          r.selectNodeContents(parent);
        }
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return { handled: true, mutated: true };
    }

    e.preventDefault();
    exitInlineEqFn(editorEl, rootEqEl, 'before');
    return { handled: true, mutated: false };
  }

  return { handled: false, mutated: false };
}

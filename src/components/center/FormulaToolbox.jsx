import React, { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { X, CornerDownLeft, ArrowLeft } from 'lucide-react';

function normalizeSlotText(val) {
  return String(val || '')
    .trim()
    .replace(/°/g, '^\\circ')
    .replace(/∞/g, '\\infty')
    .replace(/->/g, '\\to');
}

function formatChemSlot(val) {
  const clean = normalizeSlotText(val);
  if (!clean) return '';
  if (/\\[a-zA-Z]+|[_^]/.test(clean)) return clean;
  return `\\text{${clean}}`;
}

/**
 * Interactive Visual Templates (clicking opens visual fill-in-the-blank boxes
 * instead of forcing the user to edit raw LaTeX).
 */
export const VISUAL_TEMPLATES = {
  fraction: {
    id: 'fraction',
    label: 'Phân số',
    previewLatex: '\\frac{\\square}{\\square}',
    defaults: { num: '', den: '' },
    displayMode: false,
    buildLatex: (v) => `\\frac{${normalizeSlotText(v.num) || 'a'}}{${normalizeSlotText(v.den) || 'b'}}`,
  },
  sqrt: {
    id: 'sqrt',
    label: 'Căn bậc hai',
    previewLatex: '\\sqrt{\\square}',
    defaults: { rad: '' },
    displayMode: false,
    buildLatex: (v) => `\\sqrt{${normalizeSlotText(v.rad) || 'x'}}`,
  },
  nthroot: {
    id: 'nthroot',
    label: 'Căn bậc n',
    previewLatex: '\\sqrt[\\square]{\\square}',
    defaults: { idx: '', rad: '' },
    displayMode: false,
    buildLatex: (v) => `\\sqrt[${normalizeSlotText(v.idx) || 'n'}]{${normalizeSlotText(v.rad) || 'x'}}`,
  },
  power: {
    id: 'power',
    label: 'Lũy thừa',
    previewLatex: '\\square^{\\square}',
    defaults: { base: '', exp: '' },
    displayMode: false,
    buildLatex: (v) => `${normalizeSlotText(v.base) || 'x'}^{${normalizeSlotText(v.exp) || 'n'}}`,
  },
  subscript: {
    id: 'subscript',
    label: 'Chỉ số dưới',
    previewLatex: '\\square_{\\square}',
    defaults: { base: '', sub: '' },
    displayMode: false,
    buildLatex: (v) => `${normalizeSlotText(v.base) || 'x'}_{${normalizeSlotText(v.sub) || 'n'}}`,
  },
  integral: {
    id: 'integral',
    label: 'Tích phân',
    previewLatex: '\\int_{\\square}^{\\square} \\square\\,dx',
    defaults: { lower: '', upper: '', expr: '', variable: 'x' },
    displayMode: false,
    buildLatex: (v) => {
      const lo = normalizeSlotText(v.lower);
      const hi = normalizeSlotText(v.upper);
      const expr = normalizeSlotText(v.expr) || 'f(x)';
      const vr = normalizeSlotText(v.variable) || 'x';
      const bounds = lo || hi ? `_{${lo || 'a'}}^{${hi || 'b'}}` : '';
      return `\\int${bounds} ${expr}\\,d${vr}`;
    },
  },
  limit: {
    id: 'limit',
    label: 'Giới hạn',
    previewLatex: '\\lim_{\\square \\to \\square}',
    defaults: { variable: 'x', target: '', expr: '' },
    displayMode: false,
    buildLatex: (v) => {
      const vr = normalizeSlotText(v.variable) || 'x';
      const tgt = normalizeSlotText(v.target) || '\\infty';
      const expr = normalizeSlotText(v.expr);
      return expr ? `\\lim_{${vr} \\to ${tgt}} ${expr}` : `\\lim_{${vr} \\to ${tgt}}`;
    },
  },
  sum: {
    id: 'sum',
    label: 'Tổng Sigma',
    previewLatex: '\\sum_{\\square}^{\\square}',
    defaults: { lower: 'i=1', upper: '', expr: '' },
    displayMode: false,
    buildLatex: (v) => {
      const lo = normalizeSlotText(v.lower) || 'i=1';
      const hi = normalizeSlotText(v.upper) || 'n';
      const expr = normalizeSlotText(v.expr);
      return expr ? `\\sum_{${lo}}^{${hi}} ${expr}` : `\\sum_{${lo}}^{${hi}}`;
    },
  },
  cases: {
    id: 'cases',
    label: 'Hệ phương trình',
    previewLatex: '\\begin{cases} \\square \\\\ \\square \\end{cases}',
    defaults: { eq1: '', eq2: '', eq3: '' },
    displayMode: true,
    buildLatex: (v) => {
      const rows = [
        normalizeSlotText(v.eq1) || 'x + y = 1',
        normalizeSlotText(v.eq2) || 'x - y = 0',
      ];
      const eq3 = normalizeSlotText(v.eq3);
      if (eq3) rows.push(eq3);
      return `\\begin{cases} ${rows.join(' \\\\ ')} \\end{cases}`;
    },
  },
  vector: {
    id: 'vector',
    label: 'Vectơ',
    previewLatex: '\\vec{\\square}',
    defaults: { sym: '' },
    displayMode: false,
    buildLatex: (v) => `\\vec{${normalizeSlotText(v.sym) || 'a'}}`,
  },
  angle: {
    id: 'angle',
    label: 'Góc',
    previewLatex: '\\widehat{\\square}',
    defaults: { sym: '' },
    displayMode: false,
    buildLatex: (v) => `\\widehat{${normalizeSlotText(v.sym) || 'ABC'}}`,
  },
  chemArrow: {
    id: 'chemArrow',
    label: 'Mũi tên phản ứng có điều kiện',
    previewLatex: '\\xrightarrow{\\square}',
    defaults: { above: '', below: '' },
    displayMode: false,
    buildLatex: (v) => {
      const above = formatChemSlot(v.above) || 't^\\circ';
      const below = formatChemSlot(v.below);
      return below ? `\\xrightarrow[${below}]{${above}}` : `\\xrightarrow{${above}}`;
    },
  },
  oxidation: {
    id: 'oxidation',
    label: 'Số oxi hóa',
    previewLatex: '\\overset{\\square}{\\square}',
    defaults: { num: '', el: '' },
    displayMode: false,
    buildLatex: (v) =>
      `\\overset{${normalizeSlotText(v.num) || '+n'}}{${formatChemSlot(v.el) || '\\text{X}'}}`,
  },
  molarity: {
    id: 'molarity',
    label: 'Nồng độ mol [M]',
    previewLatex: '[\\square]',
    defaults: { species: '' },
    displayMode: false,
    buildLatex: (v) => `[${formatChemSlot(v.species) || '\\text{M}'}]`,
  },
  ionPos: {
    id: 'ionPos',
    label: 'Ion dương',
    previewLatex: '\\square^{\\square+}',
    defaults: { base: '', charge: '' },
    displayMode: false,
    buildLatex: (v) => {
      const base = formatChemSlot(v.base) || '\\text{M}';
      const ch = normalizeSlotText(v.charge);
      return `${base}^{${ch}+}`;
    },
  },
  ionNeg: {
    id: 'ionNeg',
    label: 'Ion âm',
    previewLatex: '\\square^{\\square-}',
    defaults: { base: '', charge: '' },
    displayMode: false,
    buildLatex: (v) => {
      const base = formatChemSlot(v.base) || '\\text{X}';
      const ch = normalizeSlotText(v.charge);
      return `${base}^{${ch}-}`;
    },
  },
};

const FORMULA_CATEGORIES = [
  {
    id: 'math',
    labelKey: 'formulaCatMath',
    items: [
      { label: 'Phân số', templateId: 'fraction', previewLatex: '\\frac{\\square}{\\square}' },
      { label: 'Căn bậc hai', templateId: 'sqrt', previewLatex: '\\sqrt{\\square}' },
      { label: 'Căn bậc n', templateId: 'nthroot', previewLatex: '\\sqrt[\\square]{\\square}' },
      { label: 'Lũy thừa', templateId: 'power', previewLatex: '\\square^{\\square}' },
      { label: 'Chỉ số dưới', templateId: 'subscript', previewLatex: '\\square_{\\square}' },
      { label: 'Tích phân', templateId: 'integral', previewLatex: '\\int_{\\square}^{\\square}' },
      { label: 'Giới hạn', templateId: 'limit', previewLatex: '\\lim_{\\square \\to \\square}' },
      { label: 'Tổng Sigma', templateId: 'sum', previewLatex: '\\sum_{\\square}^{\\square}' },
      {
        label: 'Hệ phương trình',
        templateId: 'cases',
        previewLatex: '\\begin{cases} \\square \\\\ \\square \\end{cases}',
      },
      { label: 'Vectơ', templateId: 'vector', previewLatex: '\\vec{\\square}' },
      { label: 'Góc', templateId: 'angle', previewLatex: '\\widehat{\\square}' },
      { label: 'Vô cực', latex: '\\infty' },
      { label: 'Khác', latex: '\\neq' },
      { label: 'Xấp xỉ', latex: '\\approx' },
      { label: 'Nhỏ hơn hoặc bằng', latex: '\\le' },
      { label: 'Lớn hơn hoặc bằng', latex: '\\ge' },
      { label: 'Thuộc', latex: '\\in' },
      { label: 'Tập con', latex: '\\subset' },
      { label: 'Suy ra', latex: '\\Rightarrow' },
      { label: 'Tương đương', latex: '\\Leftrightarrow' },
      { label: 'Vuông góc', latex: '\\perp' },
      { label: 'Song song', latex: '\\parallel' },
      { label: 'Độ', latex: '{}^\\circ', previewLatex: '90^\\circ' },
    ],
  },
  {
    id: 'chemistry',
    labelKey: 'formulaCatChemistry',
    items: [
      {
        label: 'Mũi tên phản ứng có điều kiện',
        templateId: 'chemArrow',
        previewLatex: '\\xrightarrow{\\square}',
      },
      { label: 'Số oxi hóa', templateId: 'oxidation', previewLatex: '\\overset{\\square}{\\square}' },
      { label: 'Nồng độ mol [M]', templateId: 'molarity', previewLatex: '[\\square]' },
      { label: 'Ion dương', templateId: 'ionPos', previewLatex: '\\square^{\\square+}' },
      { label: 'Ion âm', templateId: 'ionNeg', previewLatex: '\\square^{\\square-}' },
      { label: 'Phản ứng thuận nghịch', latex: '\\rightleftharpoons' },
      { label: 'Kết tủa', latex: '\\downarrow' },
      { label: 'Bay hơi', latex: '\\uparrow' },
      { label: 'Trạng thái rắn (s)', latex: '\\text{(s)}' },
      { label: 'Trạng thái lỏng (l)', latex: '\\text{(l)}' },
      { label: 'Trạng thái khí (g)', latex: '\\text{(g)}' },
      { label: 'Dung dịch (aq)', latex: '\\text{(aq)}' },
      { label: 'Biến thiên Enthalpy', latex: '\\Delta_r H^\\circ_{298}' },
    ],
  },
  {
    id: 'physics',
    labelKey: 'formulaCatPhysics',
    items: [
      { label: 'Alpha', latex: '\\alpha' },
      { label: 'Beta', latex: '\\beta' },
      { label: 'Gamma', latex: '\\gamma' },
      { label: 'Delta lớn', latex: '\\Delta' },
      { label: 'Delta nhỏ', latex: '\\delta' },
      { label: 'Epsilon', latex: '\\varepsilon' },
      { label: 'Theta', latex: '\\theta' },
      { label: 'Lambda', latex: '\\lambda' },
      { label: 'Mu', latex: '\\mu' },
      { label: 'Pi', latex: '\\pi' },
      { label: 'Rho', latex: '\\rho' },
      { label: 'Sigma', latex: '\\sigma' },
      { label: 'Tau', latex: '\\tau' },
      { label: 'Phi', latex: '\\varphi' },
      { label: 'Omega nhỏ', latex: '\\omega' },
      { label: 'Omega (Ohm)', latex: '\\Omega' },
      { label: 'Dấu nhân chấm', latex: '\\cdot' },
      { label: 'Dấu nhân chéo', latex: '\\times' },
    ],
  },
];

function renderSafeKatex(latex, displayMode = false) {
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

const SLOT_INPUT_CLS =
  'rounded-md border border-[#D4D4D8] dark:border-[#44444A] bg-[#FFFFFF] dark:bg-[#18181B] text-[#18181B] dark:text-[#F4F4F5] placeholder:text-[#A1A1AA] dark:placeholder:text-[#71717A] text-center font-medium focus:outline-none focus:border-[#2563EB] dark:focus:border-[#60A5FA] focus:ring-2 focus:ring-[#2563EB]/25 transition-colors';

/**
 * Math & Natural Sciences Formula Toolbox (exclusively rendered in Note view).
 * - Multi-part templates open an interactive visual fill-in-the-blank card with
 *   spatially arranged input slots (Tab to move, Enter to insert, live KaTeX preview).
 * - Single symbols insert immediately in one click.
 * - Includes an optional Custom LaTeX mini-input at the bottom.
 */
export default function FormulaToolbox({ onInsert, onClose, t }) {
  const [activeCategory, setActiveCategory] = useState('math');
  const [activeTemplateId, setActiveTemplateId] = useState(null);
  const [slotValues, setSlotValues] = useState({});
  const [customLatex, setCustomLatex] = useState('');
  const [customDisplayMode, setCustomDisplayMode] = useState(false);

  const firstSlotRef = useRef(null);

  const activeTemplate = activeTemplateId ? VISUAL_TEMPLATES[activeTemplateId] : null;

  useEffect(() => {
    if (!activeTemplateId) return;
    const frame = requestAnimationFrame(() => {
      firstSlotRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTemplateId]);

  const renderedCategories = useMemo(
    () =>
      FORMULA_CATEGORIES.map((cat) => ({
        ...cat,
        items: cat.items.map((item) => ({
          ...item,
          html: renderSafeKatex(item.previewLatex || item.latex),
        })),
      })),
    []
  );

  const currentCategory =
    renderedCategories.find((c) => c.id === activeCategory) || renderedCategories[0];

  const openTemplateBuilder = (templateId) => {
    const tpl = VISUAL_TEMPLATES[templateId];
    if (!tpl) return;
    setActiveTemplateId(templateId);
    setSlotValues({ ...tpl.defaults });
  };

  const updateSlot = (field, value) => {
    setSlotValues((prev) => ({ ...prev, [field]: value }));
  };

  const builtTemplateLatex = useMemo(() => {
    if (!activeTemplate) return '';
    return activeTemplate.buildLatex(slotValues);
  }, [activeTemplate, slotValues]);

  const builtTemplatePreviewHtml = useMemo(() => {
    if (!activeTemplate || !builtTemplateLatex) return '';
    return renderSafeKatex(builtTemplateLatex, Boolean(activeTemplate.displayMode));
  }, [activeTemplate, builtTemplateLatex]);

  const handleSubmitVisualFormula = (e) => {
    e.preventDefault();
    if (!activeTemplate || !builtTemplateLatex) return;
    onInsert(builtTemplateLatex, Boolean(activeTemplate.displayMode));
    setActiveTemplateId(null);
    setSlotValues({});
  };

  const customPreviewHtml = useMemo(() => {
    const trimmed = customLatex.trim();
    if (!trimmed) return '';
    return renderSafeKatex(trimmed, customDisplayMode);
  }, [customLatex, customDisplayMode]);

  const handleSubmitCustom = (e) => {
    e.preventDefault();
    const trimmed = customLatex.trim();
    if (!trimmed) return;
    onInsert(trimmed, customDisplayMode);
    setCustomLatex('');
  };

  const onSlotKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setActiveTemplateId(null);
    }
  };

  const renderVisualSlots = () => {
    if (!activeTemplate) return null;

    switch (activeTemplate.id) {
      case 'fraction':
        return (
          <div className="inline-flex flex-col items-center gap-1.5 py-1">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.num ?? ''}
              onChange={(e) => updateSlot('num', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotNumerator}
              aria-label={t.slotNumerator}
              className={`${SLOT_INPUT_CLS} w-28 h-8 px-2 text-[13.5px]`}
            />
            <div className="w-32 h-[2px] bg-[#18181B] dark:bg-[#F4F4F5] rounded-full" />
            <input
              type="text"
              value={slotValues.den ?? ''}
              onChange={(e) => updateSlot('den', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotDenominator}
              aria-label={t.slotDenominator}
              className={`${SLOT_INPUT_CLS} w-28 h-8 px-2 text-[13.5px]`}
            />
          </div>
        );

      case 'sqrt':
        return (
          <div className="inline-flex items-stretch py-2">
            <svg
              width="24"
              height="40"
              viewBox="0 0 24 40"
              fill="none"
              className="text-[#18181B] dark:text-[#F4F4F5] shrink-0"
              aria-hidden="true"
            >
              <path
                d="M2 23 L8 23 L13 37 L22 3 L24 3"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="border-t-2 border-[#18181B] dark:border-[#F4F4F5] pt-1.5 pl-1 pr-1 flex items-center">
              <input
                ref={firstSlotRef}
                type="text"
                value={slotValues.rad ?? ''}
                onChange={(e) => updateSlot('rad', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotRadicand}
                aria-label={t.slotRadicand}
                className={`${SLOT_INPUT_CLS} w-32 h-8 px-2 text-[13.5px]`}
              />
            </div>
          </div>
        );

      case 'nthroot':
        return (
          <div className="inline-flex items-stretch py-2">
            <div className="flex flex-col justify-start -mr-1.5 z-10">
              <input
                ref={firstSlotRef}
                type="text"
                value={slotValues.idx ?? ''}
                onChange={(e) => updateSlot('idx', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotRootIndex}
                aria-label={t.slotRootIndex}
                className={`${SLOT_INPUT_CLS} w-10 h-6 px-1 text-[11.5px]`}
              />
            </div>
            <svg
              width="24"
              height="42"
              viewBox="0 0 24 42"
              fill="none"
              className="text-[#18181B] dark:text-[#F4F4F5] shrink-0"
              aria-hidden="true"
            >
              <path
                d="M2 25 L8 25 L13 39 L22 3 L24 3"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="border-t-2 border-[#18181B] dark:border-[#F4F4F5] pt-1.5 pl-1 pr-1 flex items-center">
              <input
                type="text"
                value={slotValues.rad ?? ''}
                onChange={(e) => updateSlot('rad', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotRadicand}
                aria-label={t.slotRadicand}
                className={`${SLOT_INPUT_CLS} w-32 h-8 px-2 text-[13.5px]`}
              />
            </div>
          </div>
        );

      case 'power':
        return (
          <div className="inline-flex items-start gap-1 py-2">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.base ?? ''}
              onChange={(e) => updateSlot('base', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotBase}
              aria-label={t.slotBase}
              className={`${SLOT_INPUT_CLS} w-24 h-9 px-2 text-[14px] mt-3`}
            />
            <input
              type="text"
              value={slotValues.exp ?? ''}
              onChange={(e) => updateSlot('exp', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotExponent}
              aria-label={t.slotExponent}
              className={`${SLOT_INPUT_CLS} w-16 h-7 px-1.5 text-[12px]`}
            />
          </div>
        );

      case 'subscript':
        return (
          <div className="inline-flex items-end gap-1 py-2">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.base ?? ''}
              onChange={(e) => updateSlot('base', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotBase}
              aria-label={t.slotBase}
              className={`${SLOT_INPUT_CLS} w-24 h-9 px-2 text-[14px] mb-3`}
            />
            <input
              type="text"
              value={slotValues.sub ?? ''}
              onChange={(e) => updateSlot('sub', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotSubscript}
              aria-label={t.slotSubscript}
              className={`${SLOT_INPUT_CLS} w-16 h-7 px-1.5 text-[12px]`}
            />
          </div>
        );

      case 'integral':
        return (
          <div className="inline-flex items-center gap-2 py-1 flex-wrap">
            <div className="inline-flex flex-col items-center gap-0.5">
              <input
                ref={firstSlotRef}
                type="text"
                value={slotValues.upper ?? ''}
                onChange={(e) => updateSlot('upper', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotUpperBound}
                aria-label={t.slotUpperBound}
                className={`${SLOT_INPUT_CLS} w-14 h-6 px-1 text-[11.5px]`}
              />
              <span className="text-[28px] leading-none font-serif select-none text-[#18181B] dark:text-[#F4F4F5]">
                ∫
              </span>
              <input
                type="text"
                value={slotValues.lower ?? ''}
                onChange={(e) => updateSlot('lower', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotLowerBound}
                aria-label={t.slotLowerBound}
                className={`${SLOT_INPUT_CLS} w-14 h-6 px-1 text-[11.5px]`}
              />
            </div>
            <input
              type="text"
              value={slotValues.expr ?? ''}
              onChange={(e) => updateSlot('expr', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotIntegrand}
              aria-label={t.slotIntegrand}
              className={`${SLOT_INPUT_CLS} w-28 h-8 px-2 text-[13.5px]`}
            />
            <div className="inline-flex items-center gap-1">
              <span className="italic font-serif text-[15px] text-[#18181B] dark:text-[#F4F4F5]">
                d
              </span>
              <input
                type="text"
                value={slotValues.variable ?? ''}
                onChange={(e) => updateSlot('variable', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotVariable}
                aria-label={t.slotVariable}
                className={`${SLOT_INPUT_CLS} w-10 h-8 px-1 text-[13.5px]`}
              />
            </div>
          </div>
        );

      case 'limit':
        return (
          <div className="inline-flex items-center gap-2.5 py-1 flex-wrap">
            <div className="inline-flex flex-col items-center gap-1">
              <span className="text-[17px] font-serif font-semibold leading-none text-[#18181B] dark:text-[#F4F4F5]">
                lim
              </span>
              <div className="inline-flex items-center gap-1">
                <input
                  ref={firstSlotRef}
                  type="text"
                  value={slotValues.variable ?? ''}
                  onChange={(e) => updateSlot('variable', e.target.value)}
                  onKeyDown={onSlotKeyDown}
                  placeholder={t.slotVariable}
                  aria-label={t.slotVariable}
                  className={`${SLOT_INPUT_CLS} w-10 h-6 px-1 text-[11.5px]`}
                />
                <span className="text-[12px] text-[#52525B] dark:text-[#A1A1AA]">→</span>
                <input
                  type="text"
                  value={slotValues.target ?? ''}
                  onChange={(e) => updateSlot('target', e.target.value)}
                  onKeyDown={onSlotKeyDown}
                  placeholder={t.slotTarget}
                  aria-label={t.slotTarget}
                  className={`${SLOT_INPUT_CLS} w-14 h-6 px-1 text-[11.5px]`}
                />
              </div>
            </div>
            <input
              type="text"
              value={slotValues.expr ?? ''}
              onChange={(e) => updateSlot('expr', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotExpression}
              aria-label={t.slotExpression}
              className={`${SLOT_INPUT_CLS} w-32 h-8 px-2 text-[13.5px]`}
            />
          </div>
        );

      case 'sum':
        return (
          <div className="inline-flex items-center gap-2.5 py-1 flex-wrap">
            <div className="inline-flex flex-col items-center gap-0.5">
              <input
                ref={firstSlotRef}
                type="text"
                value={slotValues.upper ?? ''}
                onChange={(e) => updateSlot('upper', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotUpperBound}
                aria-label={t.slotUpperBound}
                className={`${SLOT_INPUT_CLS} w-14 h-6 px-1 text-[11.5px]`}
              />
              <span className="text-[26px] leading-none font-serif select-none text-[#18181B] dark:text-[#F4F4F5]">
                ∑
              </span>
              <input
                type="text"
                value={slotValues.lower ?? ''}
                onChange={(e) => updateSlot('lower', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotLowerBound}
                aria-label={t.slotLowerBound}
                className={`${SLOT_INPUT_CLS} w-16 h-6 px-1 text-[11.5px]`}
              />
            </div>
            <input
              type="text"
              value={slotValues.expr ?? ''}
              onChange={(e) => updateSlot('expr', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotExpression}
              aria-label={t.slotExpression}
              className={`${SLOT_INPUT_CLS} w-28 h-8 px-2 text-[13.5px]`}
            />
          </div>
        );

      case 'cases':
        return (
          <div className="inline-flex items-center gap-2 py-1">
            <span className="text-[46px] font-light leading-none select-none text-[#18181B] dark:text-[#F4F4F5]">
              {'{'}
            </span>
            <div className="flex flex-col gap-1.5">
              <input
                ref={firstSlotRef}
                type="text"
                value={slotValues.eq1 ?? ''}
                onChange={(e) => updateSlot('eq1', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotEquation1}
                aria-label={t.slotEquation1}
                className={`${SLOT_INPUT_CLS} w-44 h-7 px-2 text-[13px] text-left`}
              />
              <input
                type="text"
                value={slotValues.eq2 ?? ''}
                onChange={(e) => updateSlot('eq2', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotEquation2}
                aria-label={t.slotEquation2}
                className={`${SLOT_INPUT_CLS} w-44 h-7 px-2 text-[13px] text-left`}
              />
              <input
                type="text"
                value={slotValues.eq3 ?? ''}
                onChange={(e) => updateSlot('eq3', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotEquation3}
                aria-label={t.slotEquation3}
                className={`${SLOT_INPUT_CLS} w-44 h-7 px-2 text-[13px] text-left`}
              />
            </div>
          </div>
        );

      case 'vector':
        return (
          <div className="inline-flex flex-col items-center gap-0.5 py-1">
            <span className="text-[16px] leading-none text-[#18181B] dark:text-[#F4F4F5] select-none">
              →
            </span>
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.sym ?? ''}
              onChange={(e) => updateSlot('sym', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotVector}
              aria-label={t.slotVector}
              className={`${SLOT_INPUT_CLS} w-20 h-8 px-2 text-[14px]`}
            />
          </div>
        );

      case 'angle':
        return (
          <div className="inline-flex flex-col items-center gap-0.5 py-1">
            <span className="text-[16px] font-bold leading-none text-[#18181B] dark:text-[#F4F4F5] select-none">
              ^
            </span>
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.sym ?? ''}
              onChange={(e) => updateSlot('sym', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotAngle}
              aria-label={t.slotAngle}
              className={`${SLOT_INPUT_CLS} w-24 h-8 px-2 text-[14px]`}
            />
          </div>
        );

      case 'chemArrow':
        return (
          <div className="inline-flex flex-col items-center gap-1 py-1">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.above ?? ''}
              onChange={(e) => updateSlot('above', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotConditionAbove}
              aria-label={t.slotConditionAbove}
              className={`${SLOT_INPUT_CLS} w-36 h-7 px-2 text-[12.5px]`}
            />
            <div className="w-40 flex items-center text-[#18181B] dark:text-[#F4F4F5]">
              <div className="flex-1 h-[2px] bg-current" />
              <span className="text-[14px] leading-none -ml-1">▸</span>
            </div>
            <input
              type="text"
              value={slotValues.below ?? ''}
              onChange={(e) => updateSlot('below', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotConditionBelow}
              aria-label={t.slotConditionBelow}
              className={`${SLOT_INPUT_CLS} w-36 h-7 px-2 text-[12px]`}
            />
          </div>
        );

      case 'oxidation':
        return (
          <div className="inline-flex flex-col items-center gap-1 py-1">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.num ?? ''}
              onChange={(e) => updateSlot('num', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotOxidationNum}
              aria-label={t.slotOxidationNum}
              className={`${SLOT_INPUT_CLS} w-16 h-7 px-1.5 text-[12.5px]`}
            />
            <input
              type="text"
              value={slotValues.el ?? ''}
              onChange={(e) => updateSlot('el', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotElement}
              aria-label={t.slotElement}
              className={`${SLOT_INPUT_CLS} w-24 h-8 px-2 text-[14px]`}
            />
          </div>
        );

      case 'molarity':
        return (
          <div className="inline-flex items-center gap-1 py-2">
            <span className="text-[22px] font-light text-[#18181B] dark:text-[#F4F4F5]">[</span>
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.species ?? ''}
              onChange={(e) => updateSlot('species', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotSpecies}
              aria-label={t.slotSpecies}
              className={`${SLOT_INPUT_CLS} w-28 h-8 px-2 text-[13.5px]`}
            />
            <span className="text-[22px] font-light text-[#18181B] dark:text-[#F4F4F5]">]</span>
          </div>
        );

      case 'ionPos':
      case 'ionNeg': {
        const sign = activeTemplate.id === 'ionPos' ? '+' : '−';
        return (
          <div className="inline-flex items-start gap-1 py-2">
            <input
              ref={firstSlotRef}
              type="text"
              value={slotValues.base ?? ''}
              onChange={(e) => updateSlot('base', e.target.value)}
              onKeyDown={onSlotKeyDown}
              placeholder={t.slotElement}
              aria-label={t.slotElement}
              className={`${SLOT_INPUT_CLS} w-24 h-9 px-2 text-[14px] mt-3`}
            />
            <div className="inline-flex items-center gap-0.5">
              <input
                type="text"
                value={slotValues.charge ?? ''}
                onChange={(e) => updateSlot('charge', e.target.value)}
                onKeyDown={onSlotKeyDown}
                placeholder={t.slotCharge}
                aria-label={t.slotCharge}
                className={`${SLOT_INPUT_CLS} w-10 h-7 px-1 text-[12px]`}
              />
              <span className="text-[14px] font-bold text-[#18181B] dark:text-[#F4F4F5]">
                {sign}
              </span>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      onMouseDown={(e) => {
        // Keep Note editor selection intact when clicking symbol buttons, while letting inputs focus normally
        if (e.target.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }}
      className="no-print hd-modal-in border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#1E1E1E] px-3 sm:px-5 py-3 shrink-0 shadow-xs font-sans"
    >
      <div className="max-w-5xl mx-auto space-y-2.5">
        {/* Top Row: Category Tabs + Close */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {renderedCategories.map((cat) => {
              const isActive = cat.id === activeCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setActiveTemplateId(null);
                  }}
                  className={`h-8 px-3 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors duration-150 ${
                    isActive
                      ? 'bg-[#EFF6FF] dark:bg-[#2563EB]/[0.16] text-[#2563EB] dark:text-[#60A5FA] font-semibold'
                      : 'text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F4F4F5] dark:hover:bg-[#2A2A2A]'
                  }`}
                >
                  {t[cat.labelKey]}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onClose}
            title={t.cancel}
            aria-label={t.cancel}
            className="h-7 w-7 rounded-lg inline-flex items-center justify-center text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F4F4F5] dark:hover:bg-[#2A2A2A] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* One-Click KaTeX Symbol & Visual Template Grid */}
        <div className="flex flex-wrap gap-1.5 max-h-[144px] overflow-y-auto py-0.5">
          {currentCategory.items.map((item) => {
            const isSelectedTpl = Boolean(item.templateId && activeTemplateId === item.templateId);
            return (
              <button
                key={`${currentCategory.id}_${item.templateId || item.latex}`}
                type="button"
                onClick={() => {
                  if (item.templateId) {
                    openTemplateBuilder(item.templateId);
                  } else {
                    setActiveTemplateId(null);
                    onInsert(item.latex, Boolean(item.displayMode));
                  }
                }}
                title={item.label}
                aria-label={item.label}
                className={`min-w-[46px] h-9 px-2.5 rounded-lg border inline-flex items-center justify-center cursor-pointer transition-colors duration-100 text-[13.5px] ${
                  isSelectedTpl
                    ? 'border-[#2563EB] bg-[#EFF6FF] text-[#2563EB] dark:border-[#60A5FA] dark:bg-[#2563EB]/[0.2] dark:text-[#60A5FA] ring-1 ring-[#2563EB]/30'
                    : 'border-[#E4E4E7] dark:border-[#323232] bg-[#FAFAFA] dark:bg-[#252525] hover:border-[#2563EB]/50 hover:bg-[#EFF6FF] dark:hover:border-[#60A5FA]/50 dark:hover:bg-[#2563EB]/[0.16] text-[#18181B] dark:text-[#E4E4E7]'
                }`}
                dangerouslySetInnerHTML={{ __html: item.html }}
              />
            );
          })}
        </div>

        {/* Interactive Visual Fill-in-the-Blank Formula Builder Card (when a multi-part template is selected) */}
        {activeTemplate && (
          <form
            onSubmit={handleSubmitVisualFormula}
            className="hd-modal-in rounded-xl border border-[#2563EB]/30 dark:border-[#60A5FA]/30 bg-[#F8FAFC] dark:bg-[#232328] p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveTemplateId(null)}
                  className="p-1 rounded-md text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#E4E4E7] dark:hover:bg-[#323236] cursor-pointer"
                  title={t.cancel}
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[13px] font-semibold text-[#18181B] dark:text-[#F4F4F5]">
                  {activeTemplate.label}
                </span>
                <span className="hidden sm:inline text-[11.5px] text-[#71717A] dark:text-[#A1A1AA]">
                  · {t.formulaSlotHint}
                </span>
              </div>

              <button
                type="submit"
                className="h-8 px-3.5 rounded-lg bg-[#111111] hover:bg-[#27272A] text-[#FFFFFF] border border-[#3F3F46] text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>{t.insertFormulaBtn}</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Visual Spatially Arranged Empty Input Slots */}
              <div className="flex items-center justify-center sm:justify-start px-3 py-2 rounded-lg bg-[#FFFFFF] dark:bg-[#1A1A1E] border border-[#E4E4E7] dark:border-[#323236]">
                {renderVisualSlots()}
              </div>

              {/* Live Compiled KaTeX Preview */}
              <div className="flex-1 min-w-[140px] px-4 py-3 rounded-lg bg-[#FFFFFF] dark:bg-[#1A1A1E] border border-[#E4E4E7] dark:border-[#323236] flex items-center justify-center overflow-x-auto text-[#18181B] dark:text-[#F4F4F5] text-[16px]">
                <div dangerouslySetInnerHTML={{ __html: builtTemplatePreviewHtml }} />
              </div>
            </div>
          </form>
        )}

        {/* Custom LaTeX Mini-Input + Live KaTeX Preview */}
        <form
          onSubmit={handleSubmitCustom}
          className="pt-2 border-t border-[#E8E8E5] dark:border-[#2F2F2F] flex flex-col sm:flex-row sm:items-center gap-2"
        >
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              type="text"
              value={customLatex}
              onChange={(e) => setCustomLatex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder={t.customLatexPlaceholder}
              aria-label={t.customLatexLabel}
              className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-[#D4D4D8] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#18181B] font-mono text-[13px] text-[#18181B] dark:text-[#F4F4F5] placeholder:text-[#71717A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/35"
            />

            <button
              type="button"
              onClick={() => setCustomDisplayMode((v) => !v)}
              title={customDisplayMode ? 'Block $$...$$' : 'Inline $...$'}
              className={`h-9 px-2.5 rounded-lg border text-[12px] font-mono font-semibold shrink-0 cursor-pointer transition-colors ${
                customDisplayMode
                  ? 'border-[#2563EB]/40 bg-[#EFF6FF] text-[#2563EB] dark:border-[#60A5FA]/40 dark:bg-[#2563EB]/[0.16] dark:text-[#60A5FA]'
                  : 'border-[#D4D4D8] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#18181B] text-[#52525B] dark:text-[#A1A1AA]'
              }`}
            >
              {customDisplayMode ? '$$' : '$'}
            </button>

            <button
              type="submit"
              disabled={!customLatex.trim()}
              className="h-9 px-3 rounded-lg bg-[#111111] hover:bg-[#27272A] text-[#FFFFFF] border border-[#3F3F46] disabled:opacity-35 text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
            >
              <CornerDownLeft className="w-3.5 h-3.5" />
              <span>{t.insertFormulaBtn}</span>
            </button>
          </div>

          {customPreviewHtml && (
            <div
              className="px-3 py-1 rounded-lg border border-[#E4E4E7] dark:border-[#323232] bg-[#FAFAFA] dark:bg-[#252525] text-[#18181B] dark:text-[#F4F4F5] overflow-x-auto max-w-full sm:max-w-[280px] text-center shrink-0"
              dangerouslySetInnerHTML={{ __html: customPreviewHtml }}
            />
          )}
        </form>
      </div>
    </div>
  );
}

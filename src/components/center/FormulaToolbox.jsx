import React, { useMemo, useState } from 'react';
import katex from 'katex';
import { X, CornerDownLeft } from 'lucide-react';

const FORMULA_CATEGORIES = [
  {
    id: 'math',
    labelKey: 'formulaCatMath',
    items: [
      { label: 'Phân số', latex: '\\frac{a}{b}' },
      { label: 'Căn bậc hai', latex: '\\sqrt{x}' },
      { label: 'Căn bậc n', latex: '\\sqrt[n]{x}' },
      { label: 'Lũy thừa', latex: 'x^{n}' },
      { label: 'Chỉ số dưới', latex: 'x_{n}' },
      { label: 'Tích phân', latex: '\\int_{a}^{b}' },
      { label: 'Giới hạn', latex: '\\lim_{x \\to \\infty}' },
      { label: 'Tổng Sigma', latex: '\\sum_{i=1}^{n}' },
      {
        label: 'Hệ phương trình',
        latex: '\\begin{cases} a \\\\ b \\end{cases}',
        previewLatex: '\\begin{cases} x \\\\ y \\end{cases}',
        displayMode: true,
      },
      { label: 'Vectơ', latex: '\\vec{a}' },
      { label: 'Vô cực', latex: '\\infty' },
      { label: 'Khác', latex: '\\neq' },
      { label: 'Xấp xỉ', latex: '\\approx' },
      { label: 'Nhỏ hơn hoặc bằng', latex: '\\le' },
      { label: 'Lớn hơn hoặc bằng', latex: '\\ge' },
      { label: 'Thuộc', latex: '\\in' },
      { label: 'Tập con', latex: '\\subset' },
      { label: 'Suy ra', latex: '\\Rightarrow' },
      { label: 'Tương đương', latex: '\\Leftrightarrow' },
      { label: 'Góc', latex: '\\widehat{ABC}' },
      { label: 'Vuông góc', latex: '\\perp' },
      { label: 'Song song', latex: '\\parallel' },
      { label: 'Độ', latex: '{}^\\circ', previewLatex: '90^\\circ' },
    ],
  },
  {
    id: 'chemistry',
    labelKey: 'formulaCatChemistry',
    items: [
      { label: 'Phản ứng thuận (nhiệt độ)', latex: '\\xrightarrow{t^\\circ}' },
      { label: 'Phản ứng thuận nghịch', latex: '\\rightleftharpoons' },
      { label: 'Kết tủa', latex: '\\downarrow' },
      { label: 'Bay hơi', latex: '\\uparrow' },
      { label: 'Trạng thái rắn (s)', latex: '\\text{(s)}' },
      { label: 'Trạng thái lỏng (l)', latex: '\\text{(l)}' },
      { label: 'Trạng thái khí (g)', latex: '\\text{(g)}' },
      { label: 'Dung dịch (aq)', latex: '\\text{(aq)}' },
      { label: 'Nồng độ mol [M]', latex: '[\\text{M}]' },
      { label: 'Biến thiên Enthalpy', latex: '\\Delta_r H^\\circ_{298}' },
      { label: 'Số oxi hóa', latex: '\\overset{+n}{\\text{X}}' },
      { label: 'Ion dương', latex: '{}^{n+}', previewLatex: '\\text{M}^{n+}' },
      { label: 'Ion âm', latex: '{}^{n-}', previewLatex: '\\text{X}^{n-}' },
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

function renderSafeKatex(latex) {
  try {
    return katex.renderToString(latex, {
      displayMode: false,
      throwOnError: false,
      strict: 'ignore',
    });
  } catch {
    return latex;
  }
}

/**
 * Math & Natural Sciences Formula Toolbox (exclusively rendered in Note view).
 * Provides one-click KaTeX insertion across General Math, Chemistry, and Physics/Greek,
 * plus a live-preview Custom LaTeX input bar.
 */
export default function FormulaToolbox({ onInsert, onClose, t }) {
  const [activeCategory, setActiveCategory] = useState('math');
  const [customLatex, setCustomLatex] = useState('');
  const [customDisplayMode, setCustomDisplayMode] = useState(false);

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

  const customPreviewHtml = useMemo(() => {
    const trimmed = customLatex.trim();
    if (!trimmed) return '';
    try {
      return katex.renderToString(trimmed, {
        displayMode: customDisplayMode,
        throwOnError: false,
        strict: 'ignore',
      });
    } catch {
      return '';
    }
  }, [customLatex, customDisplayMode]);

  const handleSubmitCustom = (e) => {
    e.preventDefault();
    const trimmed = customLatex.trim();
    if (!trimmed) return;
    onInsert(trimmed, customDisplayMode);
    setCustomLatex('');
  };

  return (
    <div
      onMouseDown={(e) => {
        // Keep Note editor selection intact when clicking symbol buttons, while still letting custom input focus
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
                  onClick={() => setActiveCategory(cat.id)}
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

        {/* One-Click KaTeX Symbol Grid */}
        <div className="flex flex-wrap gap-1.5 max-h-[156px] overflow-y-auto py-0.5">
          {currentCategory.items.map((item) => (
            <button
              key={`${currentCategory.id}_${item.latex}`}
              type="button"
              onClick={() => onInsert(item.latex, Boolean(item.displayMode))}
              title={`${item.label}  (${item.latex})`}
              aria-label={item.label}
              className="min-w-[44px] h-9 px-2.5 rounded-lg border border-[#E4E4E7] dark:border-[#323232] bg-[#FAFAFA] dark:bg-[#252525] hover:border-[#2563EB]/50 hover:bg-[#EFF6FF] dark:hover:border-[#60A5FA]/50 dark:hover:bg-[#2563EB]/[0.16] text-[#18181B] dark:text-[#E4E4E7] inline-flex items-center justify-center cursor-pointer transition-colors duration-100 text-[13.5px]"
              dangerouslySetInnerHTML={{ __html: item.html }}
            />
          ))}
        </div>

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
              className="h-9 px-3 rounded-lg bg-[#111111] hover:bg-[#27272A] dark:bg-[#F4F4F5] dark:hover:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#111111] disabled:opacity-35 text-[12.5px] font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
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

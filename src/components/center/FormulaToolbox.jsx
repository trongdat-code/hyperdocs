import React, { useMemo, useState } from 'react';
import katex from 'katex';
import { X } from 'lucide-react';

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
        templateId: 'system',
        previewLatex: '\\begin{cases} \\square \\\\ \\square \\end{cases}',
      },
      { label: 'Vectơ', templateId: 'vector', previewLatex: '\\vec{\\square}' },
      { label: 'Góc', templateId: 'angle', previewLatex: '\\widehat{\\square}' },
      { label: 'Cộng trừ', latex: '\\pm', glyph: '±' },
      { label: 'Vô cực', latex: '\\infty', glyph: '∞' },
      { label: 'Khác', latex: '\\neq', glyph: '≠' },
      { label: 'Xấp xỉ', latex: '\\approx', glyph: '≈' },
      { label: 'Nhỏ hơn hoặc bằng', latex: '\\le', glyph: '≤' },
      { label: 'Lớn hơn hoặc bằng', latex: '\\ge', glyph: '≥' },
      { label: 'Thuộc', latex: '\\in', glyph: '∈' },
      { label: 'Tập con', latex: '\\subset', glyph: '⊂' },
      { label: 'Suy ra', latex: '\\Rightarrow', glyph: '⇒' },
      { label: 'Tương đương', latex: '\\Leftrightarrow', glyph: '⇔' },
      { label: 'Vuông góc', latex: '\\perp', glyph: '⊥' },
      { label: 'Song song', latex: '\\parallel', glyph: '∥' },
      { label: 'Độ', latex: '{}^\\circ', previewLatex: '90^\\circ', glyph: '°' },
    ],
  },
  {
    id: 'chemistry',
    labelKey: 'formulaCatChemistry',
    items: [
      {
        label: 'Mũi tên phản ứng có điều kiện',
        templateId: 'reaction',
        previewLatex: '\\xrightarrow{\\square}',
      },
      { label: 'Số oxi hóa', templateId: 'oxid', previewLatex: '\\overset{\\square}{\\square}' },
      { label: 'Nồng độ mol [M]', templateId: 'molarity', previewLatex: '[\\square]' },
      { label: 'Ion dương', templateId: 'ionPos', previewLatex: '\\square^{\\square+}' },
      { label: 'Ion âm', templateId: 'ionNeg', previewLatex: '\\square^{\\square-}' },
      { label: 'Phản ứng thuận nghịch', latex: '\\rightleftharpoons', glyph: '⇌' },
      { label: 'Kết tủa', latex: '\\downarrow', glyph: '↓' },
      { label: 'Bay hơi', latex: '\\uparrow', glyph: '↑' },
      { label: 'Trạng thái rắn (s)', latex: '\\text{(s)}', glyph: '(s)' },
      { label: 'Trạng thái lỏng (l)', latex: '\\text{(l)}', glyph: '(l)' },
      { label: 'Trạng thái khí (g)', latex: '\\text{(g)}', glyph: '(g)' },
      { label: 'Dung dịch (aq)', latex: '\\text{(aq)}', glyph: '(aq)' },
      { label: 'Biến thiên Enthalpy', latex: '\\Delta_r H^\\circ_{298}', glyph: 'ΔᵣH°₂₉₈' },
    ],
  },
  {
    id: 'physics',
    labelKey: 'formulaCatPhysics',
    items: [
      { label: 'Alpha', latex: '\\alpha', glyph: 'α' },
      { label: 'Beta', latex: '\\beta', glyph: 'β' },
      { label: 'Gamma', latex: '\\gamma', glyph: 'γ' },
      { label: 'Delta lớn', latex: '\\Delta', glyph: 'Δ' },
      { label: 'Delta nhỏ', latex: '\\delta', glyph: 'δ' },
      { label: 'Epsilon', latex: '\\varepsilon', glyph: 'ε' },
      { label: 'Theta', latex: '\\theta', glyph: 'θ' },
      { label: 'Lambda', latex: '\\lambda', glyph: 'λ' },
      { label: 'Mu', latex: '\\mu', glyph: 'μ' },
      { label: 'Pi', latex: '\\pi', glyph: 'π' },
      { label: 'Rho', latex: '\\rho', glyph: 'ρ' },
      { label: 'Sigma', latex: '\\sigma', glyph: 'σ' },
      { label: 'Tau', latex: '\\tau', glyph: 'τ' },
      { label: 'Phi', latex: '\\varphi', glyph: 'φ' },
      { label: 'Omega nhỏ', latex: '\\omega', glyph: 'ω' },
      { label: 'Omega (Ohm)', latex: '\\Omega', glyph: 'Ω' },
      { label: 'Dấu nhân chấm', latex: '\\cdot', glyph: '·' },
      { label: 'Dấu nhân chéo', latex: '\\times', glyph: '×' },
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
 * Note-only Math & Natural Sciences Formula Toolbox.
 *
 * Clicking any multi-part template immediately inserts an inline visual equation
 * with clickable blank slots right at the cursor inside the Note editor.
 * Clicking any single symbol inserts it directly at the cursor (or inside the active slot).
 * Zero raw LaTeX input bars or code popups are exposed.
 */
export default function FormulaToolbox({ onInsertTemplate, onInsertSymbol, onClose, t }) {
  const [activeCategory, setActiveCategory] = useState('math');

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

  return (
    <div
      onMouseDown={(e) => {
        // Keep the Note editor cursor/slot selection intact when clicking any formula button
        e.preventDefault();
      }}
      className="no-print hd-modal-in border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#1E1E1E] px-3 sm:px-5 py-2.5 shrink-0 shadow-xs font-sans"
    >
      <div className="max-w-5xl mx-auto space-y-2">
        {/* Top Row: Category Tabs + Hint + Close */}
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

          <div className="flex items-center gap-2">
            <span className="hidden md:inline text-[11.5px] text-[#71717A] dark:text-[#A1A1AA]">
              {t.formulaNestedHint || t.formulaSlotHint}
            </span>
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
        </div>

        {/* One-Click Direct Inline Insertion Grid */}
        <div className="flex flex-wrap gap-1.5 max-h-[156px] overflow-y-auto py-0.5">
          {currentCategory.items.map((item) => (
            <button
              key={`${currentCategory.id}_${item.templateId || item.latex}`}
              type="button"
              onClick={() => {
                if (item.templateId) {
                  onInsertTemplate(item.templateId);
                } else {
                  onInsertSymbol(item.latex, item.glyph || '');
                }
              }}
              title={item.label}
              aria-label={item.label}
              className="min-w-[46px] h-9 px-2.5 rounded-lg border border-[#E4E4E7] dark:border-[#323232] bg-[#FAFAFA] dark:bg-[#252525] hover:border-[#2563EB]/50 hover:bg-[#EFF6FF] dark:hover:border-[#60A5FA]/50 dark:hover:bg-[#2563EB]/[0.16] text-[#18181B] dark:text-[#E4E4E7] inline-flex items-center justify-center cursor-pointer transition-colors duration-100 text-[13.5px]"
              dangerouslySetInnerHTML={{ __html: item.html }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

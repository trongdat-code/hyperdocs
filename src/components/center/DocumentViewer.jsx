import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  Share2,
  Printer,
  Edit3,
  Eye,
  Tag,
  Plus,
  X,
  Check,
  Type as TypeIcon,
  Highlighter,
  Palette,
  Ban,
} from 'lucide-react';

const MAX_TAGS = 3;
const MIN_ZOOM = 70;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const FONT_STORAGE_KEY = 'hyperdocs_v1_doc_font';

const DOCUMENT_FONTS = [
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, -apple-system, sans-serif" },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, Cambria, serif' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  },
];

const TEXT_COLORS = [
  { id: 'red', hex: '#DC2626', labelKey: 'colorRed' },
  { id: 'blue', hex: '#2563EB', labelKey: 'colorBlue' },
  { id: 'green', hex: '#16A34A', labelKey: 'colorGreen' },
  { id: 'orange', hex: '#EA580C', labelKey: 'colorOrange' },
  { id: 'purple', hex: '#9333EA', labelKey: 'colorPurple' },
  { id: 'default', hex: null, labelKey: 'colorDefault' },
];

const HIGHLIGHT_COLORS = [
  { id: 'yellow', hex: '#FEF08A', labelKey: 'highlightYellow' },
  { id: 'green', hex: '#BBF7D0', labelKey: 'highlightGreen' },
  { id: 'blue', hex: '#BFDBFE', labelKey: 'highlightBlue' },
  { id: 'pink', hex: '#FBCFE8', labelKey: 'highlightPink' },
  { id: 'clear', hex: null, labelKey: 'colorClearHighlight' },
];

/**
 * Strict rehype-sanitize schema that allows ONLY:
 *  - Standard Markdown HTML elements (from defaultSchema)
 *  - `remark-math` class names on `code` / `span` / `div` (before `rehype-katex` runs)
 *  - `<span class="doc-text-color" style="color: #...">`
 *  - `<mark class="doc-highlight" style="background-color: #...">`
 */
const docSanitizeSchema = {
  ...defaultSchema,
  tagNames: Array.from(new Set([...(defaultSchema.tagNames || []), 'span', 'mark'])),
  attributes: {
    ...(defaultSchema.attributes || {}),
    code: [
      ...((defaultSchema.attributes && defaultSchema.attributes.code) || []),
      ['className', 'language-math', 'math-inline', 'math-display'],
    ],
    span: [
      ['className', 'doc-text-color', 'math', 'math-inline', 'math-display'],
      ['style', /^color:\s*#[0-9a-fA-F]{3,8};?$/],
    ],
    mark: [
      ['className', 'doc-highlight'],
      ['style', /^background-color:\s*#[0-9a-fA-F]{3,8};?$/],
    ],
    div: [
      ...((defaultSchema.attributes && defaultSchema.attributes.div) || []),
      ['className', 'math', 'math-display'],
    ],
  },
};

function loadSavedFontId() {
  try {
    const saved = localStorage.getItem(FONT_STORAGE_KEY);
    if (saved && DOCUMENT_FONTS.some((f) => f.id === saved)) return saved;
  } catch {
    // Ignore storage errors
  }
  return 'inter';
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAnnotationWrapper(text, kind) {
  if (kind === 'color') {
    return text.replace(
      /<span\s+class="doc-text-color"[^>]*>([\s\S]*?)<\/span>/gi,
      '$1'
    );
  }
  return text.replace(
    /<mark\s+class="doc-highlight"[^>]*>([\s\S]*?)<\/mark>/gi,
    '$1'
  );
}

function wrapAnnotatedText(selectedText, kind, hex) {
  const cleaned = stripAnnotationWrapper(selectedText, kind);
  if (!hex) return cleaned;
  if (kind === 'color') {
    return `<span class="doc-text-color" style="color: ${hex}">${cleaned}</span>`;
  }
  return `<mark class="doc-highlight" style="background-color: ${hex}">${cleaned}</mark>`;
}

/**
 * Apply a text color or highlight annotation to a selected phrase inside raw Markdown
 * (used when annotating directly in Read mode). Safely skips fenced code & math blocks.
 */
function applyAnnotationToMarkdown(markdown, selectedText, kind, hex) {
  const target = selectedText.trim();
  if (!target) return null;

  // Mask fenced code blocks and $$...$$ / $...$ math blocks so we don't corrupt them
  const protectedChunks = [];
  const masked = markdown.replace(
    /```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|(?<!\$)\$(?!\$)[^\n$]+?(?<!\$)\$(?!\$)/g,
    (m) => {
      const idx = protectedChunks.length;
      protectedChunks.push(m);
      return `\uE005PROT${idx}\uE006`;
    }
  );

  const escaped = escapeRegExp(target);
  const existingWrappedRegex =
    kind === 'color'
      ? new RegExp(
          `<span\\s+class="doc-text-color"[^>]*>(${escaped})<\\/span>`,
          'i'
        )
      : new RegExp(
          `<mark\\s+class="doc-highlight"[^>]*>(${escaped})<\\/mark>`,
          'i'
        );

  let updated = null;
  if (existingWrappedRegex.test(masked)) {
    updated = masked.replace(existingWrappedRegex, (_m, inner) =>
      wrapAnnotatedText(inner, kind, hex)
    );
  } else {
    const plainIdx = masked.indexOf(target);
    if (plainIdx !== -1) {
      const replacement = wrapAnnotatedText(target, kind, hex);
      updated = masked.slice(0, plainIdx) + replacement + masked.slice(plainIdx + target.length);
    }
  }

  if (updated === null) return null;

  return updated.replace(/\uE005PROT(\d+)\uE006/g, (_m, idx) => protectedChunks[Number(idx)]);
}

export default function DocumentViewer({
  document: doc,
  initialEditMode = false,
  onBack,
  onUpdateDocument,
  onNotify,
  t,
  lang,
}) {
  const [zoom, setZoom] = useState(100);
  const [fontId, setFontId] = useState(loadSavedFontId);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [draftTitle, setDraftTitle] = useState(doc.title || '');
  const [draftContent, setDraftContent] = useState(doc.content || '');
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [justAutoSaved, setJustAutoSaved] = useState(false);

  // Floating annotation toolbar in Read mode when text is selected
  const [floatingSelection, setFloatingSelection] = useState(null); // { text, top, left }

  const readerScrollRef = useRef(null);
  const articleRef = useRef(null);
  const textareaRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const docRef = useRef(doc);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    setDraftTitle(doc.title || '');
    setDraftContent(doc.content || '');
    setFloatingSelection(null);
  }, [doc.id, doc.title, doc.content]);

  useEffect(() => {
    setIsEditing(initialEditMode);
    setFloatingSelection(null);
  }, [initialEditMode, doc.id]);

  // Persist chosen document font in localStorage
  useEffect(() => {
    try {
      localStorage.setItem(FONT_STORAGE_KEY, fontId);
    } catch {
      // Ignore storage errors
    }
  }, [fontId]);

  const activeFont = useMemo(
    () => DOCUMENT_FONTS.find((f) => f.id === fontId) || DOCUMENT_FONTS[0],
    [fontId]
  );

  // Escape exits fullscreen reader
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // Localized Ctrl + Mouse Wheel zoom strictly inside the document canvas
  useEffect(() => {
    const el = readerScrollRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + direction * ZOOM_STEP)));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Debounced auto-save while editing in Edit mode (persists to localStorage + triggers Cloud Sync)
  const scheduleAutoSave = useCallback(
    (nextTitle, nextContent) => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        onUpdateDocument({
          ...docRef.current,
          title: nextTitle.trim() || t.untitledDoc,
          content: nextContent,
          updatedAt: Date.now(),
        });
        setJustAutoSaved(true);
        setTimeout(() => setJustAutoSaved(false), 1400);
      }, 600);
    },
    [onUpdateDocument, t.untitledDoc]
  );

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  const handleSaveEdits = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    onUpdateDocument({
      ...doc,
      title: draftTitle.trim() || t.untitledDoc,
      content: draftContent,
      updatedAt: Date.now(),
    });
    setIsEditing(false);
  };

  // Apply text color or highlight in Edit Mode (textarea selection)
  const applyFormatInEditor = (kind, hex) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start === end) {
      onNotify(t.selectTextToFormat, 'info');
      return;
    }

    const selected = draftContent.slice(start, end);
    const wrapped = wrapAnnotatedText(selected, kind, hex);
    const nextContent = draftContent.slice(0, start) + wrapped + draftContent.slice(end);
    setDraftContent(nextContent);

    onUpdateDocument({
      ...doc,
      title: draftTitle.trim() || t.untitledDoc,
      content: nextContent,
      updatedAt: Date.now(),
    });
    setJustAutoSaved(true);
    setTimeout(() => setJustAutoSaved(false), 1400);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + wrapped.length);
    });
  };

  // Detect text selection in Read Mode to display floating color/highlight palette
  const handleReaderMouseUp = () => {
    if (isEditing) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setFloatingSelection(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 1 || text.includes('\n')) {
      setFloatingSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!articleRef.current || !articleRef.current.contains(range.commonAncestorContainer)) {
      setFloatingSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = readerScrollRef.current?.getBoundingClientRect();
    if (!containerRect || rect.width === 0) {
      setFloatingSelection(null);
      return;
    }

    const top = Math.max(
      12,
      rect.top - containerRect.top + (readerScrollRef.current?.scrollTop || 0) - 52
    );
    const left = Math.min(
      Math.max(16, rect.left - containerRect.left + rect.width / 2),
      containerRect.width - 16
    );

    setFloatingSelection({ text, top, left });
  };

  // Apply annotation directly from floating palette in Read Mode
  const applyFormatInReader = (kind, hex) => {
    if (!floatingSelection?.text) return;
    const updatedMarkdown = applyAnnotationToMarkdown(
      doc.content || '',
      floatingSelection.text,
      kind,
      hex
    );

    if (updatedMarkdown !== null) {
      setDraftContent(updatedMarkdown);
      onUpdateDocument({
        ...doc,
        content: updatedMarkdown,
        updatedAt: Date.now(),
      });
      setJustAutoSaved(true);
      setTimeout(() => setJustAutoSaved(false), 1400);
    } else {
      onNotify(t.selectTextToFormat, 'info');
    }

    window.getSelection()?.removeAllRanges();
    setFloatingSelection(null);
  };

  const handleAddTag = (e) => {
    e.preventDefault();
    const clean = tagDraft.trim();
    const existing = doc.tags || [];
    if (!clean) return;
    if (existing.length >= MAX_TAGS) {
      onNotify(t.maxTagsReached, 'warning');
      return;
    }
    if (!existing.includes(clean)) {
      onUpdateDocument({
        ...doc,
        tags: [...existing, clean].slice(0, MAX_TAGS),
        updatedAt: Date.now(),
      });
    }
    setTagDraft('');
    setTagInputOpen(false);
  };

  const handleRemoveTag = (tagToRemove) => {
    onUpdateDocument({
      ...doc,
      tags: (doc.tags || []).filter((tg) => tg !== tagToRemove),
      updatedAt: Date.now(),
    });
  };

  const handleShare = async () => {
    const sharePayload = `# ${doc.title}\n\n${doc.content}`;
    try {
      if (navigator.share && window.innerWidth < 768) {
        await navigator.share({ title: doc.title, text: sharePayload });
        return;
      }
    } catch {
      // Fallback to clipboard copy
    }
    try {
      await navigator.clipboard.writeText(sharePayload);
      onNotify(t.copiedToClipboard, 'success');
    } catch {
      onNotify(t.copiedToClipboard, 'info');
    }
  };

  const handleExportPdf = () => {
    setFloatingSelection(null);
    if (isEditing) {
      handleSaveEdits();
      setTimeout(() => window.print(), 120);
    } else {
      window.print();
    }
  };

  const formattedDate = new Date(doc.updatedAt || doc.createdAt || Date.now()).toLocaleDateString(
    lang === 'vi' ? 'vi-VN' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );

  // Reusable Color & Highlight Swatch Strip (used in Edit bar & Read floating popover)
  const renderAnnotationPalette = (onSelectColor, onSelectHighlight, compact = false) => (
    <div className="flex flex-wrap items-center gap-2">
      {/* Text Color Swatches (6) */}
      <div className="inline-flex items-center gap-1" role="group" aria-label={t.textColorLabel}>
        <Palette className="w-3.5 h-3.5 text-[#787774] mr-0.5 shrink-0" />
        {TEXT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelectColor(c.hex)}
            title={`${t.textColorLabel}: ${t[c.labelKey]}`}
            aria-label={`${t.textColorLabel}: ${t[c.labelKey]}`}
            className={`${
              compact ? 'w-6 h-6' : 'w-7 h-7'
            } rounded-md border border-[#E5E5E3] dark:border-[#3A3A3A] hover:scale-110 flex items-center justify-center transition bg-[#FFFFFF] dark:bg-[#191919]`}
          >
            {c.hex ? (
              <span className="text-[12px] font-bold leading-none" style={{ color: c.hex }}>
                A
              </span>
            ) : (
              <Ban className="w-3.5 h-3.5 text-[#787774]" />
            )}
          </button>
        ))}
      </div>

      <span className="h-4 w-px bg-[#E5E5E3] dark:bg-[#3A3A3A]" />

      {/* Highlight Swatches (5) */}
      <div
        className="inline-flex items-center gap-1"
        role="group"
        aria-label={t.highlightColorLabel}
      >
        <Highlighter className="w-3.5 h-3.5 text-[#787774] mr-0.5 shrink-0" />
        {HIGHLIGHT_COLORS.map((h) => (
          <button
            key={h.id}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelectHighlight(h.hex)}
            title={`${t.highlightColorLabel}: ${t[h.labelKey]}`}
            aria-label={`${t.highlightColorLabel}: ${t[h.labelKey]}`}
            className={`${
              compact ? 'w-6 h-6' : 'w-7 h-7'
            } rounded-md border border-[#D3D3CF] dark:border-[#3A3A3A] hover:scale-110 flex items-center justify-center transition`}
            style={{ backgroundColor: h.hex || 'transparent' }}
          >
            {!h.hex && <Ban className="w-3.5 h-3.5 text-[#787774]" />}
          </button>
        ))}
      </div>
    </div>
  );

  // Proportional paper width & font scaling strictly isolated to the inner document paper
  const scaledFontPx = (15 * zoom) / 100;
  const scaledPaperMaxWidthPx = Math.round(768 * Math.max(1, zoom / 100));

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919] ${
        isFullscreen ? 'fixed inset-0 z-40' : ''
      }`}
    >
      {/* Top Reader & Editor Toolbar (stays fixed at 100% UI scale) */}
      <div className="no-print px-3.5 sm:px-6 py-2 border-b border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF]/95 dark:bg-[#191919]/95 backdrop-blur flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Back + Saved pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isEditing) handleSaveEdits();
              setIsFullscreen(false);
              onBack();
            }}
            className="min-h-[36px] px-2.5 rounded-lg hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[#555552] dark:text-[#C5C4C0] text-[13px] font-medium inline-flex items-center gap-1.5 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t.backToList}</span>
          </button>

          {justAutoSaved && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[12px] font-medium">
              <Check className="w-3 h-3" />
              {t.autoSavedLabel}
            </span>
          )}
        </div>

        {/* Right: Font Selector + Localized Zoom Bar + Edit/Read + Fullscreen + Share + PDF */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 5 Selectable Document Fonts */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] px-2 h-[36px]">
            <TypeIcon className="w-3.5 h-3.5 text-[#787774] shrink-0" />
            <select
              value={fontId}
              onChange={(e) => setFontId(e.target.value)}
              aria-label={t.fontFamilyLabel}
              title={t.fontFamilyLabel}
              className="bg-transparent text-[13px] font-medium text-[#2F2F2F] dark:text-[#E8E8E6] focus:outline-none cursor-pointer pr-1 max-w-[145px]"
            >
              {DOCUMENT_FONTS.map((f) => (
                <option
                  key={f.id}
                  value={f.id}
                  className="bg-[#FFFFFF] dark:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6]"
                >
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Localized Zoom Control Bar (70% - 200%, 10% steps + Reset) */}
          <div
            title={t.zoomWheelHint}
            className="inline-flex items-center rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] overflow-hidden"
          >
            <button
              type="button"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              title={t.zoomOut}
              aria-label={t.zoomOut}
              className="h-[36px] w-[32px] inline-flex items-center justify-center hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] disabled:opacity-35 transition"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-[12px] font-semibold tabular-nums select-none min-w-[44px] text-center">
              {zoom}%
            </span>
            <button
              type="button"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              title={t.zoomIn}
              aria-label={t.zoomIn}
              className="h-[36px] w-[32px] inline-flex items-center justify-center hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] disabled:opacity-35 transition"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {zoom !== 100 && (
              <button
                type="button"
                onClick={() => setZoom(100)}
                title={t.resetZoom}
                aria-label={t.resetZoom}
                className="h-[36px] px-2 border-l border-[#E5E5E3] dark:border-[#2F2F2F] text-[12px] font-medium text-[#787774] hover:text-[#2F2F2F] dark:hover:text-white hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] inline-flex items-center gap-1 transition"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden xl:inline">{t.resetZoom}</span>
              </button>
            )}
          </div>

          {/* Edit / Read Mode Toggle */}
          <button
            type="button"
            onClick={() => (isEditing ? handleSaveEdits() : setIsEditing(true))}
            className={`min-h-[36px] px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 border transition ${
              isEditing
                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                : 'border-[#E5E5E3] dark:border-[#2F2F2F] hover:bg-[#F1F1EF] dark:hover:bg-[#262626]'
            }`}
          >
            {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">
              {isEditing ? t.previewMarkdown : t.editMarkdown}
            </span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? t.exitFullscreen : t.fullscreen}
            aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
            className="h-[36px] w-[36px] inline-flex items-center justify-center rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] transition"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            title={t.shareDoc}
            className="h-[36px] px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[13px] font-medium transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{t.shareDoc}</span>
          </button>

          {/* Export PDF / Print */}
          <button
            type="button"
            onClick={handleExportPdf}
            title={t.exportPdf}
            className="h-[36px] px-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F2F2F] hover:bg-[#191919] dark:bg-[#E8E8E6] dark:hover:bg-white text-white dark:text-[#191919] text-[13px] font-semibold transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* Formatting Bar when in Edit Mode (always accessible for text color & highlight) */}
      {isEditing && (
        <div className="no-print px-4 sm:px-6 py-2 border-b border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {renderAnnotationPalette(
            (hex) => applyFormatInEditor('color', hex),
            (hex) => applyFormatInEditor('highlight', hex),
            false
          )}
          <span className="text-[12px] text-[#787774] dark:text-[#9B9A97] hidden lg:inline">
            {t.annotateHint}
          </span>
        </div>
      )}

      {/* Localized Scrollable Document Canvas (Zoom & Font isolated strictly inside) */}
      <div
        ref={readerScrollRef}
        onMouseUp={handleReaderMouseUp}
        onScroll={() => floatingSelection && setFloatingSelection(null)}
        className="relative flex-1 overflow-y-auto overflow-x-auto px-5 sm:px-10 lg:px-14 py-7 min-h-0"
      >
        {/* Floating Notion-Style Color & Highlight Popover (on text selection in Read Mode) */}
        {!isEditing && floatingSelection && (
          <div
            style={{
              top: `${floatingSelection.top}px`,
              left: `${floatingSelection.left}px`,
              transform: 'translateX(-50%)',
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="no-print absolute z-30 rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#3A3A3A] shadow-xl px-2.5 py-1.5"
          >
            {renderAnnotationPalette(
              (hex) => applyFormatInReader('color', hex),
              (hex) => applyFormatInReader('highlight', hex),
              true
            )}
          </div>
        )}

        {/* Inner Document Paper Container (Localized Zoom + Chosen Document Font) */}
        <article
          ref={articleRef}
          className="print-only-document mx-auto transition-[font-size,max-width] duration-150"
          style={{
            fontSize: `${scaledFontPx}px`,
            fontFamily: activeFont.stack,
            maxWidth: `${scaledPaperMaxWidthPx}px`,
          }}
        >
          <header className="mb-6 pb-4 border-b border-[#E5E5E3] dark:border-[#2F2F2F]">
            {isEditing ? (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftTitle(next);
                  scheduleAutoSave(next, draftContent);
                }}
                placeholder={t.docTitlePlaceholder}
                className="w-full px-3 py-2 rounded-xl border border-indigo-400 bg-[#FFFFFF] dark:bg-[#202020] text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#2F2F2F] dark:text-[#E8E8E6]">
                {doc.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px] font-sans text-[#787774] dark:text-[#9B9A97]">
              <span>
                {t.updatedLabel}: {formattedDate}
              </span>
              <span className="no-print">·</span>

              <div className="flex flex-wrap items-center gap-1.5">
                {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#F1F1EF] dark:bg-[#262626] text-[#555552] dark:text-[#C5C4C0] font-medium text-[12px]"
                  >
                    <Tag className="w-3 h-3 text-indigo-500" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="no-print hover:text-rose-500 ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                {(doc.tags || []).length < MAX_TAGS && !tagInputOpen && (
                  <button
                    type="button"
                    onClick={() => setTagInputOpen(true)}
                    className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-[#D3D3CF] dark:border-[#3A3A3A] hover:border-indigo-500 text-[#787774] hover:text-indigo-500 text-[12px] transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{t.editTags}</span>
                  </button>
                )}

                {tagInputOpen && (
                  <form onSubmit={handleAddTag} className="no-print inline-flex items-center gap-1">
                    <input
                      type="text"
                      autoFocus
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      placeholder={t.addTagPlaceholder}
                      className="w-32 px-2 py-0.5 rounded-md border border-indigo-400 bg-[#FFFFFF] dark:bg-[#202020] text-[12px] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="p-1 rounded bg-indigo-600 text-white"
                      title={t.save}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTagInputOpen(false);
                        setTagDraft('');
                      }}
                      className="p-1 rounded text-[#787774]"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          </header>

          {isEditing ? (
            <div className="space-y-3 no-print">
              <textarea
                ref={textareaRef}
                rows={18}
                value={draftContent}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftContent(next);
                  scheduleAutoSave(draftTitle, next);
                }}
                placeholder={t.markdownPlaceholder}
                style={{ fontSize: `${scaledFontPx}px`, fontFamily: activeFont.stack }}
                className="w-full p-4 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-2 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
                    setDraftTitle(doc.title || '');
                    setDraftContent(doc.content || '');
                    setIsEditing(false);
                  }}
                  className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t.cancel}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  className="min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.save}</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              className="study-markdown text-[#2F2F2F] dark:text-[#E8E8E6]"
              style={{ fontSize: 'inherit', fontFamily: 'inherit' }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[
                  rehypeRaw,
                  [rehypeSanitize, docSanitizeSchema],
                  rehypeKatex,
                ]}
              >
                {doc.content || ''}
              </ReactMarkdown>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

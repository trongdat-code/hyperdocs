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
  Download,
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
  ExternalLink,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  fetchPdfFileFromUrl,
  fixUtf8FilenameMojibake,
  importPdfFile,
  pdfDataUrlToBlob,
} from '../../services/importService';

const MAX_TAGS = 3;
const MIN_ZOOM = 70;
const MAX_ZOOM = 200;
const ZOOM_STEP = 10;
const FONT_STORAGE_KEY = 'hyperdocs_v1_doc_font';

const DOCUMENT_FONTS = [
  {
    id: 'google-sans',
    label: 'Google Sans',
    stack:
      "'Google Sans Flex', 'Google Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
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
    if (saved === 'inter') return 'google-sans';
    if (saved && DOCUMENT_FONTS.some((f) => f.id === saved)) return saved;
  } catch {
    // Ignore storage errors
  }
  return 'google-sans';
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

function applyAnnotationToMarkdown(markdown, selectedText, kind, hex) {
  const target = selectedText.trim();
  if (!target) return null;

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
      ? new RegExp(`<span\\s+class="doc-text-color"[^>]*>(${escaped})<\\/span>`, 'i')
      : new RegExp(`<mark\\s+class="doc-highlight"[^>]*>(${escaped})<\\/mark>`, 'i');

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

  // Embedded PDF viewer state (for doc.docType === 'pdf-embed')
  const isEmbeddedPdf = doc.docType === 'pdf-embed';
  const [pdfViewerSrc, setPdfViewerSrc] = useState('');
  const [pdfViewerLoading, setPdfViewerLoading] = useState(false);
  const [pdfViewerError, setPdfViewerError] = useState('');
  const [isConvertingPdfToMd, setIsConvertingPdfToMd] = useState(false);
  const [convertProgressText, setConvertProgressText] = useState('');

  // Toolbar dropdown menus ('color' | 'highlight' | null)
  const [openMenu, setOpenMenu] = useState(null);

  // Floating annotation toolbar in Read mode when text is selected
  const [floatingSelection, setFloatingSelection] = useState(null);

  const readerScrollRef = useRef(null);
  const articleRef = useRef(null);
  const textareaRef = useRef(null);
  const toolbarMenuRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const docRef = useRef(doc);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    setDraftTitle(doc.title || '');
    setDraftContent(doc.content || '');
    setFloatingSelection(null);
    setOpenMenu(null);
  }, [doc.id, doc.title, doc.content]);

  useEffect(() => {
    setIsEditing(isEmbeddedPdf ? false : initialEditMode);
    setFloatingSelection(null);
    setOpenMenu(null);
  }, [initialEditMode, doc.id, isEmbeddedPdf]);

  // Resolve embedded PDF source (local Data URL -> Blob URL, or external URL via CORS proxy -> Blob URL with iframe fallback)
  useEffect(() => {
    if (!isEmbeddedPdf) {
      setPdfViewerSrc('');
      setPdfViewerLoading(false);
      setPdfViewerError('');
      return;
    }

    let active = true;
    let createdBlobUrl = '';

    const loadEmbeddedPdf = async () => {
      setPdfViewerError('');
      setPdfViewerLoading(true);

      // 1. Local PDF persisted in IndexedDB as Data URL
      if (doc.pdfDataUrl) {
        try {
          const blob = pdfDataUrlToBlob(doc.pdfDataUrl);
          createdBlobUrl = URL.createObjectURL(blob);
          if (active) {
            setPdfViewerSrc(createdBlobUrl);
            setPdfViewerLoading(false);
          }
        } catch {
          if (active) {
            setPdfViewerError(t.pdfEmbedLoadError);
            setPdfViewerLoading(false);
          }
        }
        return;
      }

      // 2. External PDF URL (direct or Google Drive) — try CORS proxy blob first for clean native PDF rendering
      if (doc.pdfUrl || doc.pdfOriginalUrl) {
        try {
          const fetched = await fetchPdfFileFromUrl(doc.pdfOriginalUrl || doc.pdfUrl);
          createdBlobUrl = URL.createObjectURL(fetched.blob);
          if (active) {
            setPdfViewerSrc(createdBlobUrl);
            setPdfViewerLoading(false);
          }
          return;
        } catch (err) {
          if (err?.code === 'RESTRICTED_PDF') {
            if (active) {
              setPdfViewerError(t.pdfRestrictedError);
              setPdfViewerLoading(false);
            }
            return;
          }
          // Graceful fallback (e.g., Google Drive /preview iframe or direct URL when serverless proxy is unavailable locally)
          const fallbackSrc = doc.pdfPreviewUrl || doc.pdfUrl || doc.pdfOriginalUrl;
          if (active) {
            setPdfViewerSrc(fallbackSrc || '');
            setPdfViewerLoading(false);
          }
          return;
        }
      }

      if (active) {
        setPdfViewerError(t.pdfEmbedMissingSource);
        setPdfViewerLoading(false);
      }
    };

    loadEmbeddedPdf();

    return () => {
      active = false;
      if (createdBlobUrl) {
        URL.revokeObjectURL(createdBlobUrl);
      }
    };
  }, [
    isEmbeddedPdf,
    doc.id,
    doc.pdfDataUrl,
    doc.pdfUrl,
    doc.pdfOriginalUrl,
    doc.pdfPreviewUrl,
    t.pdfEmbedLoadError,
    t.pdfRestrictedError,
    t.pdfEmbedMissingSource,
  ]);

  const handleConvertEmbeddedPdfToMarkdown = async () => {
    if (!isEmbeddedPdf || isConvertingPdfToMd) return;
    setIsConvertingPdfToMd(true);
    setConvertProgressText(t.pdfConvertingShort);
    try {
      let fileToExtract = null;
      if (doc.pdfDataUrl) {
        const blob = pdfDataUrlToBlob(doc.pdfDataUrl);
        fileToExtract = new File([blob], doc.pdfFileName || `${doc.title || 'document'}.pdf`, {
          type: 'application/pdf',
        });
      } else if (doc.pdfOriginalUrl || doc.pdfUrl) {
        setConvertProgressText(t.pdfFetchingUrl);
        const fetched = await fetchPdfFileFromUrl(doc.pdfOriginalUrl || doc.pdfUrl);
        fileToExtract = fetched.file;
      }

      if (!fileToExtract) {
        onNotify(t.pdfEmbedMissingSource, 'error');
        return;
      }

      const { content, method } = await importPdfFile(fileToExtract, {
        language: lang,
        sanitizeKatex: true,
        onProgress: (progress) => {
          if (!progress) return;
          if (progress.stage === 'ai') {
            setConvertProgressText(t.pdfConvertingShort);
          } else if (progress.stage === 'ocr') {
            setConvertProgressText(
              t.pdfOcrPageProgress(
                progress.currentPage,
                progress.endPage || progress.currentPage,
                progress.totalPages
              )
            );
          } else if (progress.stage === 'local' && progress.totalPages) {
            setConvertProgressText(
              t.pdfExtractingPageProgress(progress.currentPage, progress.totalPages)
            );
          }
        },
      });

      const { docType: _removedDocType, pdfDataUrl: _removedData, ...restDoc } = doc;
      onUpdateDocument({
        ...restDoc,
        content,
        updatedAt: Date.now(),
      });
      setZoom(100);
      onNotify(
        method === 'ocr-fallback'
          ? t.pdfImportSuccessOcr
          : method === 'gemini'
            ? t.pdfImportSuccessAi
            : t.pdfImportSuccessLocal,
        'success'
      );
    } catch (err) {
      if (err?.code === 'RESTRICTED_PDF') {
        onNotify(t.pdfRestrictedError, 'error');
      } else if (err?.code === 'MISSING_API_KEY') {
        onNotify(t.missingApiKeyError, 'error');
      } else {
        onNotify(err?.message || t.pdfImportError, 'error');
      }
    } finally {
      setIsConvertingPdfToMd(false);
      setConvertProgressText('');
    }
  };

  // Close toolbar color/highlight dropdown when clicking outside
  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e) => {
      if (toolbarMenuRef.current && !toolbarMenuRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenu]);

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
    setOpenMenu(null);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + wrapped.length);
    });
  };

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
    // Keep floating toolbar safely inside container bounds even on 375px mobile screens
    const halfToolbar = Math.min(185, containerRect.width / 2 - 12);
    const rawCenter = rect.left - containerRect.left + rect.width / 2;
    const left = Math.min(Math.max(halfToolbar + 8, rawCenter), containerRect.width - halfToolbar - 8);

    setFloatingSelection({ text, top, left });
  };

  const applyFormatInReader = (kind, hex) => {
    const selectedStr =
      floatingSelection?.text || window.getSelection()?.toString().trim() || '';
    if (!selectedStr) {
      onNotify(t.selectTextToFormat, 'info');
      setOpenMenu(null);
      return;
    }
    const updatedMarkdown = applyAnnotationToMarkdown(doc.content || '', selectedStr, kind, hex);

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
    setOpenMenu(null);
  };

  const applyFormatFromToolbar = (kind, hex) => {
    if (isEditing) {
      applyFormatInEditor(kind, hex);
    } else {
      applyFormatInReader(kind, hex);
    }
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

  const handleExportMd = () => {
    const content = isEditing ? draftContent : doc.content || '';
    const rawTitle = (isEditing ? draftTitle : doc.title || 'document').trim() || 'document';
    // Preserve clean UTF-8 Vietnamese characters while removing filesystem-unsafe characters
    const safeFilename = fixUtf8FilenameMojibake(rawTitle)
      .normalize('NFC')
      .replace(/\.md$/i, '')
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 100);

    // Prepend UTF-8 BOM (\uFEFF) so Windows Notepad & Word always decode Vietnamese accurately
    const blob = new Blob(['\uFEFF' + content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFilename || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    setFloatingSelection(null);
    setOpenMenu(null);
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

  const renderAnnotationPalette = (onSelectColor, onSelectHighlight, compact = false) => (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1" role="group" aria-label={t.textColorLabel}>
        <Palette className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97] mr-0.5 shrink-0" />
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
            } rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] flex items-center justify-center transition-colors duration-150 bg-[#FFFFFF] dark:bg-[#191919] cursor-pointer`}
          >
            {c.hex ? (
              <span className="text-[12px] font-bold leading-none" style={{ color: c.hex }}>
                A
              </span>
            ) : (
              <Ban className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97]" />
            )}
          </button>
        ))}
      </div>

      <span className="h-4 w-px bg-[#E8E8E5] dark:bg-[#2F2F2F]" />

      <div
        className="inline-flex items-center gap-1"
        role="group"
        aria-label={t.highlightColorLabel}
      >
        <Highlighter className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97] mr-0.5 shrink-0" />
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
            } rounded-lg border border-[#D8D8D4] dark:border-[#3A3A3A] hover:opacity-85 flex items-center justify-center transition-opacity duration-150 cursor-pointer`}
            style={{ backgroundColor: h.hex || 'transparent' }}
          >
            {!h.hex && <Ban className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97]" />}
          </button>
        ))}
      </div>
    </div>
  );

  const scaledFontPx = (15 * zoom) / 100;
  const scaledPaperMaxWidthPx = Math.round(768 * Math.max(1, zoom / 100));

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919] ${
        isFullscreen ? 'fixed inset-0 z-40' : ''
      }`}
    >
      {/* Clean Horizontal Document Toolbar (stays fixed at 100% UI scale) */}
      <div className="no-print px-3 sm:px-5 py-2 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF]/95 dark:bg-[#191919]/95 backdrop-blur flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Back + Auto-saved pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isEditing) handleSaveEdits();
              setIsFullscreen(false);
              onBack();
            }}
            className="h-9 px-2.5 rounded-lg hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA] text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t.backToList}</span>
          </button>

          {justAutoSaved && (
            <span className="hd-fade-in inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[12px] font-medium">
              <Check className="w-3 h-3" />
              {t.autoSavedLabel}
            </span>
          )}
        </div>

        {/* Right: Organized Control Groups */}
        <div
          ref={toolbarMenuRef}
          className="flex flex-wrap items-center gap-1.5"
        >
          {/* Group 1: Font (Markdown only) + Localized Zoom */}
          {!isEmbeddedPdf && (
            <div className="inline-flex items-center gap-1 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] px-2 h-9">
              <TypeIcon className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97] shrink-0" />
              <select
                value={fontId}
                onChange={(e) => setFontId(e.target.value)}
                aria-label={t.fontFamilyLabel}
                title={t.fontFamilyLabel}
                className="bg-transparent text-[13px] font-medium text-[#262624] dark:text-[#ECECEA] focus:outline-none cursor-pointer pr-1 max-w-[138px]"
              >
                {DOCUMENT_FONTS.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    className="bg-[#FFFFFF] dark:bg-[#262626] text-[#262624] dark:text-[#ECECEA]"
                  >
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div
            title={t.zoomWheelHint}
            className="inline-flex items-center rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] overflow-hidden h-9"
          >
            <button
              type="button"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              title={t.zoomOut}
              aria-label={t.zoomOut}
              className="h-full w-8 inline-flex items-center justify-center hover:bg-[#F3F3F1] dark:hover:bg-[#262626] disabled:opacity-35 transition-colors duration-150 cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 text-[12px] font-semibold tabular-nums select-none min-w-[42px] text-center text-[#262624] dark:text-[#ECECEA]">
              {zoom}%
            </span>
            <button
              type="button"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              title={t.zoomIn}
              aria-label={t.zoomIn}
              className="h-full w-8 inline-flex items-center justify-center hover:bg-[#F3F3F1] dark:hover:bg-[#262626] disabled:opacity-35 transition-colors duration-150 cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {zoom !== 100 && (
              <button
                type="button"
                onClick={() => setZoom(100)}
                title={t.resetZoom}
                aria-label={t.resetZoom}
                className="h-full px-2 border-l border-[#E8E8E5] dark:border-[#2F2F2F] text-[12px] font-medium text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#262626] inline-flex items-center gap-1 transition-colors duration-150 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden xl:inline">{t.resetZoom}</span>
              </button>
            )}
          </div>

          <span className="hidden sm:inline-block h-5 w-px bg-[#E8E8E5] dark:bg-[#2F2F2F] mx-0.5" />

          {/* Group 2: Markdown Annotation/Edit Controls OR Embedded PDF Extract Action */}
          {isEmbeddedPdf ? (
            <>
              <button
                type="button"
                disabled={isConvertingPdfToMd}
                onClick={handleConvertEmbeddedPdfToMarkdown}
                title={t.pdfConvertToMarkdownHint}
                className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-55 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                {isConvertingPdfToMd ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>
                  {isConvertingPdfToMd
                    ? convertProgressText || t.pdfConvertingShort
                    : t.pdfConvertToMarkdown}
                </span>
              </button>

              {(doc.pdfOriginalUrl || doc.pdfUrl) && (
                <a
                  href={doc.pdfOriginalUrl || doc.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.pdfOpenOriginal}
                  className="h-9 px-2.5 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">{t.pdfOpenOriginal}</span>
                </a>
              )}
            </>
          ) : (
            <>
              <div className="relative inline-flex items-center gap-1">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setOpenMenu((m) => (m === 'color' ? null : 'color'))}
                  title={t.textColorLabel}
                  aria-label={t.textColorLabel}
                  aria-expanded={openMenu === 'color'}
                  className={`h-9 w-9 rounded-lg border inline-flex items-center justify-center transition-colors duration-150 cursor-pointer ${
                    openMenu === 'color'
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setOpenMenu((m) => (m === 'highlight' ? null : 'highlight'))}
                  title={t.highlightColorLabel}
                  aria-label={t.highlightColorLabel}
                  aria-expanded={openMenu === 'highlight'}
                  className={`h-9 w-9 rounded-lg border inline-flex items-center justify-center transition-colors duration-150 cursor-pointer ${
                    openMenu === 'highlight'
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5" />
                </button>

                {/* Anchored Swatch Dropdown Popover */}
                {openMenu && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="hd-modal-in absolute right-0 top-11 z-40 rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#262626] shadow-xl p-2.5 min-w-[208px]"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97] mb-2 px-0.5">
                      {openMenu === 'color' ? t.textColorLabel : t.highlightColorLabel}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {(openMenu === 'color' ? TEXT_COLORS : HIGHLIGHT_COLORS).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyFormatFromToolbar(openMenu, item.hex)}
                          title={t[item.labelKey]}
                          aria-label={t[item.labelKey]}
                          className="w-7 h-7 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] hover:ring-2 hover:ring-indigo-500/40 flex items-center justify-center transition cursor-pointer"
                          style={
                            openMenu === 'highlight'
                              ? { backgroundColor: item.hex || 'transparent' }
                              : undefined
                          }
                        >
                          {openMenu === 'color' ? (
                            item.hex ? (
                              <span className="text-[13px] font-bold" style={{ color: item.hex }}>
                                A
                              </span>
                            ) : (
                              <Ban className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97]" />
                            )
                          ) : !item.hex ? (
                            <Ban className="w-3.5 h-3.5 text-[#6B6A66] dark:text-[#9B9A97]" />
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => (isEditing ? handleSaveEdits() : setIsEditing(true))}
                aria-pressed={isEditing}
                title={isEditing ? t.previewMarkdown : t.editMarkdown}
                className={`h-9 px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 border transition-colors duration-150 cursor-pointer ${
                  isEditing
                    ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                    : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
                }`}
              >
                {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">
                  {isEditing ? t.previewMarkdown : t.editMarkdown}
                </span>
              </button>
            </>
          )}

          <span className="hidden sm:inline-block h-5 w-px bg-[#E8E8E5] dark:bg-[#2F2F2F] mx-0.5" />

          {/* Group 3: Fullscreen, Share, Export MD & Export PDF */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? t.exitFullscreen : t.fullscreen}
            aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
            aria-pressed={isFullscreen}
            className={`h-9 w-9 inline-flex items-center justify-center rounded-lg border transition-colors duration-150 cursor-pointer ${
              isFullscreen
                ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
            }`}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {!isEmbeddedPdf && (
            <>
              <button
                type="button"
                onClick={handleShare}
                title={t.shareDoc}
                aria-label={t.shareDoc}
                className="h-9 w-9 xl:w-auto xl:px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[13px] font-medium transition-colors duration-150 cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{t.shareDoc}</span>
              </button>

              <button
                type="button"
                onClick={handleExportMd}
                title={t.exportMd}
                aria-label={t.exportMd}
                className="h-9 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[13px] font-medium transition-colors duration-150 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{t.exportMd}</span>
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                title={t.exportPdf}
                className="h-9 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[13px] font-semibold transition-colors duration-150 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.exportPdf}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline Formatting Bar when in Edit Mode */}
      {isEditing && (
        <div className="no-print px-4 sm:px-6 py-2 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {renderAnnotationPalette(
            (hex) => applyFormatInEditor('color', hex),
            (hex) => applyFormatInEditor('highlight', hex),
            false
          )}
          <span className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] hidden lg:inline">
            {t.annotateHint}
          </span>
        </div>
      )}

      {/* Localized Scrollable Document Canvas (Zoom & Font isolated strictly inside) */}
      {isEmbeddedPdf ? (
        <div
          ref={readerScrollRef}
          className="relative flex-1 overflow-auto bg-[#FBFBFA] dark:bg-[#141414] p-3 sm:p-5 min-h-0 flex flex-col"
        >
          {/* Compact Title & Tags Header above Embedded PDF */}
          <div className="max-w-5xl w-full mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 px-1 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded-md bg-rose-500/12 text-rose-700 dark:text-rose-300 text-[11px] font-semibold uppercase tracking-wide shrink-0">
                PDF
              </span>
              <h1 className="text-[16px] sm:text-[18px] font-bold tracking-tight text-[#262624] dark:text-[#ECECEA] truncate">
                {doc.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
              <span>
                {t.updatedLabel}: {formattedDate}
              </span>
              {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F3F3F1] dark:bg-[#262626] text-[#4F4E4B] dark:text-[#C5C4C0] font-medium"
                >
                  <Tag className="w-2.5 h-2.5 text-indigo-500" />
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Responsive Full-Height Embedded PDF Viewer with Localized Zoom */}
          {pdfViewerLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-[#6B6A66] dark:text-[#9B9A97]">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <p className="text-[14px] font-medium">{t.pdfLoadingViewer}</p>
            </div>
          ) : pdfViewerError ? (
            <div className="max-w-xl mx-auto my-auto rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
              <p className="text-[14px] font-medium text-rose-700 dark:text-rose-300">
                {pdfViewerError}
              </p>
              {(doc.pdfOriginalUrl || doc.pdfUrl) && (
                <a
                  href={doc.pdfOriginalUrl || doc.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#262624] dark:bg-[#ECECEA] text-white dark:text-[#191919] text-[13px] font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>{t.pdfOpenOriginal}</span>
                </a>
              )}
            </div>
          ) : (
            <div className="flex-1 w-full min-h-[72vh] overflow-auto">
              <div
                className="mx-auto transition-[width,height] duration-150"
                style={
                  zoom === 100
                    ? { width: '100%', maxWidth: '1040px', height: '100%', minHeight: '72vh' }
                    : {
                        width: `${Math.round(960 * (zoom / 100))}px`,
                        height: `${Math.round(76 * (zoom / 100))}vh`,
                      }
                }
              >
                <div
                  className="rounded-xl overflow-hidden border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] shadow-sm"
                  style={
                    zoom === 100
                      ? { width: '100%', height: '100%', minHeight: '72vh' }
                      : {
                          width: '960px',
                          height: '76vh',
                          transform: `scale(${zoom / 100})`,
                          transformOrigin: 'top left',
                        }
                  }
                >
                  <iframe
                    key={pdfViewerSrc}
                    src={
                      pdfViewerSrc.startsWith('blob:')
                        ? `${pdfViewerSrc}#toolbar=1&navpanes=0`
                        : pdfViewerSrc
                    }
                    title={doc.title || 'PDF Document'}
                    className="w-full h-full border-0 bg-white"
                    allow="fullscreen"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
      <div
        ref={readerScrollRef}
        onMouseUp={handleReaderMouseUp}
        onScroll={() => floatingSelection && setFloatingSelection(null)}
        className="relative flex-1 overflow-y-auto overflow-x-auto px-5 sm:px-10 lg:px-14 py-7 min-h-0"
      >
        {/* Floating Notion-Style Color & Highlight Popover (Read Mode text selection) */}
        {!isEditing && floatingSelection && (
          <div
            style={{
              top: `${floatingSelection.top}px`,
              left: `${floatingSelection.left}px`,
              transform: 'translateX(-50%)',
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="no-print hd-modal-in absolute z-30 max-w-[calc(100%-24px)] rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#3A3A3A] shadow-xl px-2.5 py-1.5"
          >
            {renderAnnotationPalette(
              (hex) => applyFormatInReader('color', hex),
              (hex) => applyFormatInReader('highlight', hex),
              true
            )}
          </div>
        )}

        {/* Inner Document Paper Container */}
        <article
          ref={articleRef}
          className="print-only-document mx-auto transition-[font-size,max-width] duration-150"
          style={{
            fontSize: `${scaledFontPx}px`,
            fontFamily: activeFont.stack,
            maxWidth: `${scaledPaperMaxWidthPx}px`,
          }}
        >
          <header className="mb-6 pb-4 border-b border-[#E8E8E5] dark:border-[#2F2F2F]">
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
                className="w-full px-3 py-2 rounded-lg border border-indigo-400 bg-[#FFFFFF] dark:bg-[#202020] text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#262624] dark:text-[#ECECEA]">
                {doc.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px] font-sans text-[#6B6A66] dark:text-[#9B9A97]">
              <span>
                {t.updatedLabel}: {formattedDate}
              </span>
              <span className="no-print">·</span>

              <div className="flex flex-wrap items-center gap-1.5">
                {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-[#F3F3F1] dark:bg-[#262626] text-[#4F4E4B] dark:text-[#C5C4C0] font-medium text-[12px]"
                  >
                    <Tag className="w-3 h-3 text-indigo-500" />
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="no-print hover:text-rose-500 ml-0.5 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}

                {(doc.tags || []).length < MAX_TAGS && !tagInputOpen && (
                  <button
                    type="button"
                    onClick={() => setTagInputOpen(true)}
                    className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-dashed border-[#D6D6D2] dark:border-[#3A3A3A] hover:border-indigo-500 text-[#6B6A66] dark:text-[#9B9A97] hover:text-indigo-500 text-[12px] transition-colors duration-150 cursor-pointer"
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
                      className="w-32 px-2 py-0.5 rounded-lg border border-indigo-400 bg-[#FFFFFF] dark:bg-[#202020] text-[12px] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="p-1 rounded-lg bg-indigo-600 text-white cursor-pointer"
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
                      className="p-1 rounded-lg text-[#6B6A66] cursor-pointer"
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
                className="w-full p-4 rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  className="h-10 px-4 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[14px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t.cancel}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  className="h-10 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.save}</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              className="study-markdown text-[#262624] dark:text-[#ECECEA]"
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
      )}
    </div>
  );
}

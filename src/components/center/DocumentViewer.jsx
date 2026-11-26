import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
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
  Code2,
  Eye,
  EyeOff,
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
  Pin,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  IndentIncrease,
  IndentDecrease,
  Lightbulb,
  StickyNote,
} from 'lucide-react';
import {
  fetchPdfFileFromUrl,
  fixUtf8FilenameMojibake,
  importPdfFile,
  pdfDataUrlToBlob,
} from '../../services/importService';
import {
  applyRichAnnotationToSelection,
  editorHtmlToMarkdown,
  handleChecklistEnter,
  indentListItem,
  insertCalloutBlock,
  markdownToEditorHtml,
  renderMathChipHtml,
  sanitizePastedHtml,
  toggleHeadingBlock,
  toggleListBlock,
} from '../../utils/wysiwygSerializer';
import StickyNoteLayer, { STICKY_NOTE_COLORS } from './StickyNoteLayer';

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

export default function DocumentViewer({
  document: doc,
  initialEditMode = false,
  onBack,
  onUpdateDocument,
  onTogglePin,
  onNotify,
  t,
  lang,
}) {
  const [zoom, setZoom] = useState(100);
  const [fontId, setFontId] = useState(loadSavedFontId);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Optional raw Markdown Source view (default is always-editable WYSIWYG canvas)
  const [isSourceMode, setIsSourceMode] = useState(false);
  const [draftTitle, setDraftTitle] = useState(doc.title || '');
  const [draftContent, setDraftContent] = useState(doc.content || '');
  const [stickyNotes, setStickyNotes] = useState(() =>
    Array.isArray(doc.stickyNotes) ? doc.stickyNotes : []
  );
  const [stickyNotesVisible, setStickyNotesVisible] = useState(true);
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

  // Floating Notion-style selection toolbar inside WYSIWYG canvas
  const [floatingSelection, setFloatingSelection] = useState(null);

  // Inline click-to-edit KaTeX math formula popover
  const [editingMath, setEditingMath] = useState(null); // { element, kind, latex, top, left }

  // Slash command `/` menu inside WYSIWYG canvas
  const [slashMenu, setSlashMenu] = useState(null); // { query, top, left, activeIndex }

  const readerScrollRef = useRef(null);
  const articleRef = useRef(null);
  const titleInputRef = useRef(null);
  const editorRef = useRef(null);
  const textareaRef = useRef(null);
  const toolbarMenuRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const stickySaveTimerRef = useRef(null);
  const savedRangeRef = useRef(null);
  const docRef = useRef(doc);
  const draftTitleRef = useRef(doc.title || '');
  const draftContentRef = useRef(doc.content || '');
  const stickyNotesRef = useRef(Array.isArray(doc.stickyNotes) ? doc.stickyNotes : []);
  const lastHydratedDocIdRef = useRef(null);
  const lastSyncedMarkdownRef = useRef(null);
  const hasPendingSaveRef = useRef(false);

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    draftTitleRef.current = draftTitle;
  }, [draftTitle]);

  useEffect(() => {
    draftContentRef.current = draftContent;
  }, [draftContent]);

  useEffect(() => {
    stickyNotesRef.current = stickyNotes;
  }, [stickyNotes]);

  // Reset modes & flush any pending edit on previous document smoothly when switching documents
  useEffect(() => {
    const activeDocSnapshot = doc;
    setIsSourceMode(false);
    setFloatingSelection(null);
    setEditingMath(null);
    setSlashMenu(null);
    setOpenMenu(null);
    savedRangeRef.current = null;
    setDraftTitle(doc.title || '');
    draftTitleRef.current = doc.title || '';
    setDraftContent(doc.content || '');
    draftContentRef.current = doc.content || '';
    const nextNotes = Array.isArray(doc.stickyNotes) ? doc.stickyNotes : [];
    setStickyNotes(nextNotes);
    stickyNotesRef.current = nextNotes;
    setStickyNotesVisible(true);

    return () => {
      if (stickySaveTimerRef.current) {
        clearTimeout(stickySaveTimerRef.current);
        stickySaveTimerRef.current = null;
      }
      if (hasPendingSaveRef.current && activeDocSnapshot?.docType !== 'pdf-embed') {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        hasPendingSaveRef.current = false;
        onUpdateDocument({
          ...activeDocSnapshot,
          title: draftTitleRef.current.trim() || t.untitledDoc,
          content: draftContentRef.current,
          stickyNotes: stickyNotesRef.current,
          updatedAt: Date.now(),
        });
      }
    };
  }, [doc.id, isEmbeddedPdf]);

  // Sync external updates (e.g., Supabase Realtime sync or PDF-to-Markdown conversion) without clobbering active typing
  useEffect(() => {
    if (hasPendingSaveRef.current) return;
    if (doc.title !== undefined && doc.title !== draftTitleRef.current) {
      setDraftTitle(doc.title || '');
      draftTitleRef.current = doc.title || '';
    }
    if (doc.content !== undefined && doc.content !== lastSyncedMarkdownRef.current) {
      setDraftContent(doc.content || '');
      draftContentRef.current = doc.content || '';
    }
    if (Array.isArray(doc.stickyNotes)) {
      const incomingJson = JSON.stringify(doc.stickyNotes);
      const localJson = JSON.stringify(stickyNotesRef.current);
      if (incomingJson !== localJson) {
        setStickyNotes(doc.stickyNotes);
        stickyNotesRef.current = doc.stickyNotes;
      }
    }
  }, [doc.title, doc.content, doc.stickyNotes]);

  // Hydrate the always-editable WYSIWYG contentEditable canvas only when switching doc,
  // returning from Markdown Source mode, or receiving an external cloud content update.
  useEffect(() => {
    if (isEmbeddedPdf || isSourceMode) return;
    const el = editorRef.current;
    if (!el) return;

    const incomingMd = doc.content || '';
    const isNewDoc = lastHydratedDocIdRef.current !== doc.id;
    const isExternalUpdate = lastSyncedMarkdownRef.current !== incomingMd;

    if (isNewDoc || isExternalUpdate) {
      el.innerHTML = markdownToEditorHtml(incomingMd);
      lastHydratedDocIdRef.current = doc.id;
      lastSyncedMarkdownRef.current = incomingMd;
      draftContentRef.current = incomingMd;
    }

    // If opened right after clicking "+ New Note", focus directly into the canvas/title
    if (isNewDoc && initialEditMode) {
      requestAnimationFrame(() => {
        if (!doc.content && titleInputRef.current) {
          titleInputRef.current.focus();
          titleInputRef.current.select();
        } else {
          editorRef.current?.focus();
        }
      });
    }
  }, [doc.id, doc.content, isEmbeddedPdf, isSourceMode, initialEditMode]);

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

  const commitSaveImmediate = useCallback(
    (nextTitle, nextContent, showBadge = true, nextStickyNotes = undefined) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      hasPendingSaveRef.current = false;
      const cleanTitle = (nextTitle ?? draftTitleRef.current).trim() || t.untitledDoc;
      const cleanContent = nextContent ?? draftContentRef.current;
      const cleanStickies = nextStickyNotes ?? stickyNotesRef.current;
      lastSyncedMarkdownRef.current = cleanContent;
      draftContentRef.current = cleanContent;
      stickyNotesRef.current = cleanStickies;
      onUpdateDocument({
        ...docRef.current,
        title: cleanTitle,
        content: cleanContent,
        stickyNotes: cleanStickies,
        updatedAt: Date.now(),
      });
      if (showBadge) {
        setJustAutoSaved(true);
        setTimeout(() => setJustAutoSaved(false), 1400);
      }
    },
    [onUpdateDocument, t.untitledDoc]
  );

  const scheduleAutoSave = useCallback(
    (nextTitle, nextContent) => {
      hasPendingSaveRef.current = true;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        commitSaveImmediate(nextTitle, nextContent, true);
      }, 500);
    },
    [commitSaveImmediate]
  );

  const getLatestMarkdownContent = useCallback(() => {
    if (!isSourceMode && !isEmbeddedPdf && editorRef.current) {
      const serialized = editorHtmlToMarkdown(editorRef.current);
      lastSyncedMarkdownRef.current = serialized;
      draftContentRef.current = serialized;
      return serialized;
    }
    return draftContentRef.current;
  }, [isSourceMode, isEmbeddedPdf]);

  const flushPendingSave = useCallback(() => {
    if (isEmbeddedPdf) return;
    if (hasPendingSaveRef.current) {
      const latestMd = getLatestMarkdownContent();
      commitSaveImmediate(draftTitleRef.current, latestMd, false);
    }
  }, [isEmbeddedPdf, getLatestMarkdownContent, commitSaveImmediate]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (stickySaveTimerRef.current) clearTimeout(stickySaveTimerRef.current);
      if (hasPendingSaveRef.current && docRef.current?.docType !== 'pdf-embed') {
        onUpdateDocument({
          ...docRef.current,
          title: draftTitleRef.current.trim() || t.untitledDoc,
          content: draftContentRef.current,
          stickyNotes: stickyNotesRef.current,
          updatedAt: Date.now(),
        });
      }
    };
  }, [onUpdateDocument, t.untitledDoc]);

  // ---------- Sticky Notes Handlers (persisted inside document.stickyNotes & synced to Supabase) ----------
  const handleAddStickyNote = useCallback(() => {
    const scrollEl = readerScrollRef.current;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const containerWidth = scrollEl ? scrollEl.clientWidth : 900;
    const count = stickyNotesRef.current.length;
    const defaultWidth = 264;
    const defaultHeight = 204;
    // Place neatly near right edge on desktop, staggered so multiple notes never fully overlap
    const baseRightX = Math.max(16, containerWidth - defaultWidth - 28);
    const x = Math.max(12, baseRightX - (count % 4) * 24);
    const y = Math.max(16, Math.round(scrollTop + 28 + (count % 5) * 32));
    const color = STICKY_NOTE_COLORS[count % STICKY_NOTE_COLORS.length].hex;

    const newNote = {
      id: `sticky_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: t.stickyNoteDefaultTitle,
      content: '',
      x,
      y,
      width: defaultWidth,
      height: defaultHeight,
      color,
    };

    const next = [...stickyNotesRef.current, newNote];
    setStickyNotes(next);
    stickyNotesRef.current = next;
    setStickyNotesVisible(true);
    commitSaveImmediate(draftTitleRef.current, getLatestMarkdownContent(), true, next);
  }, [commitSaveImmediate, getLatestMarkdownContent, t.stickyNoteDefaultTitle]);

  const handleUpdateStickyNote = useCallback(
    (noteId, patch) => {
      const next = stickyNotesRef.current.map((n) =>
        n.id === noteId ? { ...n, ...patch } : n
      );
      setStickyNotes(next);
      stickyNotesRef.current = next;

      // Immediate save for geometry/color changes; light debounce for typing inside title/body
      const isTypingPatch = 'title' in patch || 'content' in patch;
      if (isTypingPatch) {
        hasPendingSaveRef.current = true;
        if (stickySaveTimerRef.current) clearTimeout(stickySaveTimerRef.current);
        stickySaveTimerRef.current = setTimeout(() => {
          commitSaveImmediate(
            draftTitleRef.current,
            getLatestMarkdownContent(),
            true,
            stickyNotesRef.current
          );
        }, 450);
      } else {
        commitSaveImmediate(draftTitleRef.current, getLatestMarkdownContent(), true, next);
      }
    },
    [commitSaveImmediate, getLatestMarkdownContent]
  );

  const handleDeleteStickyNote = useCallback(
    (noteId) => {
      const next = stickyNotesRef.current.filter((n) => n.id !== noteId);
      setStickyNotes(next);
      stickyNotesRef.current = next;
      commitSaveImmediate(draftTitleRef.current, getLatestMarkdownContent(), true, next);
    },
    [commitSaveImmediate, getLatestMarkdownContent]
  );

  // ---------- Block Formatting Actions (H1-H3, Lists, Checklists, Indent, Callout, Slash Menu) ----------
  const runBlockFormatAction = useCallback(
    (action) => {
      const el = editorRef.current;
      if (!el || isSourceMode) return;

      let changed = false;
      if (action === 'h1') changed = toggleHeadingBlock(el, savedRangeRef.current, 1);
      else if (action === 'h2') changed = toggleHeadingBlock(el, savedRangeRef.current, 2);
      else if (action === 'h3') changed = toggleHeadingBlock(el, savedRangeRef.current, 3);
      else if (action === 'ul') changed = toggleListBlock(el, savedRangeRef.current, 'ul');
      else if (action === 'ol') changed = toggleListBlock(el, savedRangeRef.current, 'ol');
      else if (action === 'checklist') changed = toggleListBlock(el, savedRangeRef.current, 'checklist');
      else if (action === 'indent') changed = indentListItem(el, savedRangeRef.current, 'indent');
      else if (action === 'outdent') changed = indentListItem(el, savedRangeRef.current, 'outdent');
      else if (action === 'callout')
        changed = insertCalloutBlock(el, savedRangeRef.current, t.calloutDefaultText);
      else if (action === 'sticky') {
        handleAddStickyNote();
        return;
      }

      if (changed) {
        const nextMd = editorHtmlToMarkdown(el);
        lastSyncedMarkdownRef.current = nextMd;
        draftContentRef.current = nextMd;
        commitSaveImmediate(draftTitleRef.current, nextMd, true);
      }
    },
    [isSourceMode, commitSaveImmediate, handleAddStickyNote, t.calloutDefaultText]
  );

  const slashCommands = useMemo(
    () => [
      { id: 'h1', label: t.heading1Label, shortcut: 'H1', keywords: 'h1 heading title tieu de 1', icon: Heading1 },
      { id: 'h2', label: t.heading2Label, shortcut: 'H2', keywords: 'h2 heading section tieu de 2', icon: Heading2 },
      { id: 'h3', label: t.heading3Label, shortcut: 'H3', keywords: 'h3 heading sub tieu de 3', icon: Heading3 },
      { id: 'ul', label: t.bulletListLabel, shortcut: '•', keywords: 'bullet list ul cham danh sach', icon: List },
      { id: 'ol', label: t.numberedListLabel, shortcut: '1.', keywords: 'numbered ordered list ol so', icon: ListOrdered },
      { id: 'checklist', label: t.checklistLabel, shortcut: '☐', keywords: 'todo check task checklist kiem tra', icon: CheckSquare },
      { id: 'callout', label: t.calloutLabel, shortcut: '💡', keywords: 'callout summary box note cong thuc hop tom tat', icon: Lightbulb },
      { id: 'sticky', label: t.addStickyNote, shortcut: '📌', keywords: 'sticky note card ghi chu dan', icon: StickyNote },
    ],
    [t]
  );

  const filteredSlashCommands = useMemo(() => {
    if (!slashMenu) return [];
    const q = (slashMenu.query || '').trim().toLowerCase();
    if (!q) return slashCommands;
    return slashCommands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.id.includes(q) ||
        cmd.keywords.includes(q)
    );
  }, [slashMenu, slashCommands]);

  const detectSlashCommandAtCaret = useCallback(() => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) {
      setSlashMenu(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || range.startContainer.nodeType !== 3) {
      setSlashMenu(null);
      return;
    }

    const textBeforeCaret = range.startContainer.nodeValue.slice(0, range.startOffset);
    const slashMatch = textBeforeCaret.match(/(?:^|\s)\/([a-zA-Z0-9]*)$/);
    if (!slashMatch) {
      setSlashMenu(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = readerScrollRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const top = Math.max(
      16,
      (rect.bottom || rect.top || containerRect.top + 80) -
        containerRect.top +
        (readerScrollRef.current?.scrollTop || 0) +
        6
    );
    const left = Math.min(
      Math.max(16, (rect.left || containerRect.left + 40) - containerRect.left),
      Math.max(16, containerRect.width - 252)
    );

    setSlashMenu((prev) => ({
      query: slashMatch[1] || '',
      top,
      left,
      activeIndex: prev && prev.query === (slashMatch[1] || '') ? prev.activeIndex : 0,
    }));
  }, []);

  const executeSlashCommand = useCallback(
    (commandId) => {
      const el = editorRef.current;
      const sel = window.getSelection();
      // Remove the `/query` trigger text before inserting the formatted block
      if (el && sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (el.contains(range.startContainer) && range.startContainer.nodeType === 3) {
          const textNode = range.startContainer;
          const before = textNode.nodeValue.slice(0, range.startOffset);
          const match = before.match(/(?:^|\s)(\/[a-zA-Z0-9]*)$/);
          if (match) {
            const slashStart = range.startOffset - match[1].length;
            textNode.deleteData(slashStart, match[1].length);
            const nextRange = document.createRange();
            nextRange.setStart(textNode, slashStart);
            nextRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(nextRange);
            savedRangeRef.current = nextRange.cloneRange();
          }
        }
      }

      setSlashMenu(null);
      runBlockFormatAction(commandId);
    },
    [runBlockFormatAction]
  );

  const handleWysiwygKeyDown = (e) => {
    if (slashMenu && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenu((prev) =>
          prev ? { ...prev, activeIndex: (prev.activeIndex + 1) % filteredSlashCommands.length } : null
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenu((prev) =>
          prev
            ? {
                ...prev,
                activeIndex:
                  (prev.activeIndex - 1 + filteredSlashCommands.length) %
                  filteredSlashCommands.length,
              }
            : null
        );
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = filteredSlashCommands[slashMenu.activeIndex] || filteredSlashCommands[0];
        if (picked) executeSlashCommand(picked.id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenu(null);
        return;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const didIndent = indentListItem(
        editorRef.current,
        savedRangeRef.current,
        e.shiftKey ? 'outdent' : 'indent'
      );
      if (didIndent) {
        handleWysiwygInput();
      } else if (!e.shiftKey) {
        // Insert clean 2-space indent inside non-list prose without jumping focus out of the editor
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const spaces = document.createTextNode('  ');
          range.insertNode(spaces);
          range.setStartAfter(spaces);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          handleWysiwygInput();
        }
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (handleChecklistEnter(editorRef.current)) {
        e.preventDefault();
        handleWysiwygInput();
      }
    }
  };

  const handleWysiwygCheckboxChange = (e) => {
    const target = e.target;
    if (target?.matches?.('input.hd-checklist-box')) {
      const li = target.closest('li.hd-checklist-item');
      if (li) {
        li.setAttribute('data-checked', target.checked ? 'true' : 'false');
      }
      handleWysiwygInput();
    }
  };

  const handleToggleSourceMode = () => {
    setFloatingSelection(null);
    setEditingMath(null);
    setOpenMenu(null);
    if (!isSourceMode) {
      // Visual WYSIWYG -> Markdown Source
      const latestMd = getLatestMarkdownContent();
      setDraftContent(latestMd);
      if (hasPendingSaveRef.current) {
        commitSaveImmediate(draftTitleRef.current, latestMd, false);
      }
      setIsSourceMode(true);
    } else {
      // Markdown Source -> Visual WYSIWYG
      commitSaveImmediate(draftTitleRef.current, draftContentRef.current, true);
      // Force re-hydration of editorRef on switching back to Visual mode
      lastHydratedDocIdRef.current = null;
      setIsSourceMode(false);
    }
  };

  // Serialize live WYSIWYG DOM changes on every input (typing, deleting, pasting, undo/redo)
  const handleWysiwygInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const nextMd = editorHtmlToMarkdown(el);
    lastSyncedMarkdownRef.current = nextMd;
    draftContentRef.current = nextMd;
    scheduleAutoSave(draftTitleRef.current, nextMd);
    detectSlashCommandAtCaret();
  }, [scheduleAutoSave, detectSlashCommandAtCaret]);

  const updateFloatingSelectionPosition = useCallback(() => {
    if (isSourceMode || isEmbeddedPdf) return;
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) {
      setFloatingSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      setFloatingSelection(null);
      return;
    }

    // Keep latest valid range inside editor (even collapsed) so toolbar swatches work cleanly
    savedRangeRef.current = range.cloneRange();

    if (selection.isCollapsed) {
      setFloatingSelection(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setFloatingSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const containerRect = readerScrollRef.current?.getBoundingClientRect();
    if (!containerRect || (rect.width === 0 && rect.height === 0)) {
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
    const left = Math.min(
      Math.max(halfToolbar + 8, rawCenter),
      containerRect.width - halfToolbar - 8
    );

    setFloatingSelection({ top, left });
  }, [isSourceMode, isEmbeddedPdf]);

  // Track selection changes inside the WYSIWYG canvas (supports keyboard Shift+Arrow selection too)
  useEffect(() => {
    if (isSourceMode || isEmbeddedPdf) return;
    const onSelectionChange = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        savedRangeRef.current = range.cloneRange();
      }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [isSourceMode, isEmbeddedPdf]);

  const applyFormatInSourceEditor = (kind, hex) => {
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
    draftContentRef.current = nextContent;
    commitSaveImmediate(draftTitleRef.current, nextContent, true);
    setOpenMenu(null);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + wrapped.length);
    });
  };

  const applyFormatInWysiwyg = (kind, hex) => {
    const el = editorRef.current;
    if (!el) return;

    const { applied } = applyRichAnnotationToSelection(el, savedRangeRef.current, kind, hex);
    if (!applied) {
      onNotify(t.selectTextToFormat, 'info');
      setOpenMenu(null);
      return;
    }

    const nextMd = editorHtmlToMarkdown(el);
    lastSyncedMarkdownRef.current = nextMd;
    draftContentRef.current = nextMd;
    commitSaveImmediate(draftTitleRef.current, nextMd, true);

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }

    setOpenMenu(null);
    updateFloatingSelectionPosition();
  };

  const applyFormatFromToolbar = (kind, hex) => {
    if (isSourceMode) {
      applyFormatInSourceEditor(kind, hex);
    } else {
      applyFormatInWysiwyg(kind, hex);
    }
  };

  // Sanitized rich paste inside WYSIWYG canvas (strips external styles/scripts)
  const handleWysiwygPaste = (e) => {
    const html = e.clipboardData?.getData('text/html');
    const plain = e.clipboardData?.getData('text/plain') || '';
    if (!html && !plain) return;

    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    range.deleteContents();

    const temp = document.createElement('div');
    if (html) {
      temp.innerHTML = sanitizePastedHtml(html);
    } else {
      const lines = plain.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, idx) => {
        if (idx > 0) temp.appendChild(document.createElement('br'));
        temp.appendChild(document.createTextNode(line));
      });
    }

    const frag = document.createDocumentFragment();
    let lastNode = null;
    while (temp.firstChild) {
      lastNode = frag.appendChild(temp.firstChild);
    }
    range.insertNode(frag);

    if (lastNode) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(lastNode);
      nextRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nextRange);
    }

    handleWysiwygInput();
  };

  // Click any rendered KaTeX chip in WYSIWYG to edit its LaTeX formula inline
  const handleWysiwygClick = (e) => {
    const mathEl = e.target.closest?.('[data-latex]');
    if (!mathEl || !editorRef.current?.contains(mathEl)) {
      if (editingMath) setEditingMath(null);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setFloatingSelection(null);

    const rect = mathEl.getBoundingClientRect();
    const containerRect = readerScrollRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const top = Math.max(
      12,
      rect.bottom - containerRect.top + (readerScrollRef.current?.scrollTop || 0) + 8
    );
    const halfWidth = Math.min(190, containerRect.width / 2 - 12);
    const rawCenter = rect.left - containerRect.left + rect.width / 2;
    const left = Math.min(
      Math.max(halfWidth + 8, rawCenter),
      containerRect.width - halfWidth - 8
    );

    setEditingMath({
      element: mathEl,
      kind: mathEl.getAttribute('data-math-kind') === 'block' ? 'block' : 'inline',
      latex: mathEl.getAttribute('data-latex') || '',
      top,
      left,
    });
  };

  const handleSaveMathEdit = (e) => {
    e?.preventDefault();
    if (!editingMath || !editingMath.element?.isConnected) {
      setEditingMath(null);
      return;
    }

    const trimmed = editingMath.latex.trim();
    if (!trimmed) {
      editingMath.element.remove();
    } else {
      const temp = document.createElement('div');
      temp.innerHTML = renderMathChipHtml(trimmed, editingMath.kind === 'block');
      if (temp.firstElementChild) {
        editingMath.element.replaceWith(temp.firstElementChild);
      }
    }

    setEditingMath(null);
    const nextMd = getLatestMarkdownContent();
    commitSaveImmediate(draftTitleRef.current, nextMd, true);
  };

  const editingMathPreviewHtml = useMemo(() => {
    if (!editingMath?.latex?.trim()) return '';
    try {
      return katex.renderToString(editingMath.latex.trim(), {
        displayMode: editingMath.kind === 'block',
        throwOnError: false,
        strict: 'ignore',
      });
    } catch {
      return '';
    }
  }, [editingMath?.latex, editingMath?.kind]);

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
    const currentContent = getLatestMarkdownContent();
    const currentTitle = draftTitleRef.current.trim() || doc.title || t.untitledDoc;
    const sharePayload = `# ${currentTitle}\n\n${currentContent}`;
    try {
      if (navigator.share && window.innerWidth < 768) {
        await navigator.share({ title: currentTitle, text: sharePayload });
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
    const content = getLatestMarkdownContent();
    const rawTitle = (draftTitleRef.current || doc.title || 'document').trim() || 'document';
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
    setEditingMath(null);
    setOpenMenu(null);
    window.getSelection()?.removeAllRanges();
    flushPendingSave();
    if (isSourceMode) {
      commitSaveImmediate(draftTitleRef.current, draftContentRef.current, false);
      lastHydratedDocIdRef.current = null;
      setIsSourceMode(false);
      setTimeout(() => window.print(), 140);
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
  const stickyCanvasMinHeightPx = useMemo(() => {
    if (!stickyNotesVisible || stickyNotes.length === 0) return 0;
    return stickyNotes.reduce(
      (maxH, n) => Math.max(maxH, (Number(n.y) || 0) + (Number(n.height) || 200) + 64),
      0
    );
  }, [stickyNotes, stickyNotesVisible]);

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919] ${
        isFullscreen ? 'fixed inset-0 z-40' : ''
      }`}
    >
      {/* Clean Horizontal Document Toolbar (stays fixed at 100% UI scale) */}
      <div className="no-print px-3 sm:px-5 py-2 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF]/95 dark:bg-[#191919]/95 backdrop-blur flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Back + Pin Document Toggle + Auto-saved pill */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              flushPendingSave();
              setIsFullscreen(false);
              onBack();
            }}
            className="h-9 px-2.5 rounded-lg hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA] text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t.backToList}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (onTogglePin) {
                onTogglePin(doc.id);
              } else {
                onUpdateDocument({
                  ...docRef.current,
                  pinned: !doc.pinned,
                  updatedAt: Date.now(),
                });
              }
            }}
            title={doc.pinned ? t.unpinDoc : t.pinDoc}
            aria-label={doc.pinned ? t.unpinDoc : t.pinDoc}
            aria-pressed={Boolean(doc.pinned)}
            className={`h-9 px-2.5 rounded-lg border text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer ${
              doc.pinned
                ? 'border-amber-400/60 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] text-[#6B6A66] dark:text-[#9B9A97] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
            }`}
          >
            <Pin className={`w-3.5 h-3.5 ${doc.pinned ? 'fill-current' : ''}`} />
            <span className="hidden lg:inline">{doc.pinned ? t.pinnedBadge : t.pinDoc}</span>
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
                onClick={handleToggleSourceMode}
                aria-pressed={isSourceMode}
                title={isSourceMode ? t.visualEditor : t.markdownSource}
                className={`h-9 px-2.5 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 border transition-colors duration-150 cursor-pointer ${
                  isSourceMode
                    ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                    : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
                }`}
              >
                {isSourceMode ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
                <span className="hidden xl:inline">
                  {isSourceMode ? t.visualEditor : t.markdownSource}
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

      {/* Visual WYSIWYG Formatting Toolbar: Headings (H1-H3), Indented Lists, Checklist, Callout & Sticky Notes */}
      {!isEmbeddedPdf && !isSourceMode && (
        <div className="no-print px-3 sm:px-5 py-1.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1">
            {/* Headings H1, H2, H3 */}
            <div className="inline-flex items-center gap-0.5">
              {[
                { id: 'h1', label: t.heading1Label, icon: Heading1 },
                { id: 'h2', label: t.heading2Label, icon: Heading2 },
                { id: 'h3', label: t.heading3Label, icon: Heading3 },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runBlockFormatAction(id)}
                  title={label}
                  aria-label={label}
                  className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#EFEFED] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>

            <span className="h-4 w-px bg-[#E8E8E5] dark:bg-[#2F2F2F] mx-1" />

            {/* Bulleted List, Numbered List, Checklist & Multi-Level Indent */}
            <div className="inline-flex items-center gap-0.5">
              {[
                { id: 'ul', label: t.bulletListLabel, icon: List },
                { id: 'ol', label: t.numberedListLabel, icon: ListOrdered },
                { id: 'checklist', label: t.checklistLabel, icon: CheckSquare },
                { id: 'outdent', label: t.outdentLabel, icon: IndentDecrease },
                { id: 'indent', label: t.indentLabel, icon: IndentIncrease },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runBlockFormatAction(id)}
                  title={label}
                  aria-label={label}
                  className="h-8 w-8 rounded-lg inline-flex items-center justify-center text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#EFEFED] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>

            <span className="h-4 w-px bg-[#E8E8E5] dark:bg-[#2F2F2F] mx-1" />

            {/* Structured Callout / Summary Box */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runBlockFormatAction('callout')}
              title={t.calloutLabel}
              aria-label={t.calloutLabel}
              className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#EFEFED] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              <span className="hidden md:inline">{t.calloutLabel}</span>
            </button>
          </div>

          {/* Right: Add Free-Moving Sticky Note & Visibility Toggle */}
          <div className="flex items-center gap-1.5">
            {stickyNotes.length > 0 && (
              <button
                type="button"
                onClick={() => setStickyNotesVisible((v) => !v)}
                title={t.toggleStickyNotes}
                aria-label={t.toggleStickyNotes}
                aria-pressed={stickyNotesVisible}
                className={`h-8 px-2 rounded-lg border text-[12px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors duration-150 ${
                  stickyNotesVisible
                    ? 'border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-[#E8E8E5] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#262626] text-[#6B6A66] dark:text-[#9B9A97]'
                }`}
              >
                {stickyNotesVisible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
                <span className="tabular-nums">{stickyNotes.length}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleAddStickyNote}
              title={t.addStickyNote}
              className="h-8 px-2.5 rounded-lg border border-amber-400/50 bg-[#FEF9C3]/85 hover:bg-[#FEF08A] dark:bg-amber-400/18 dark:hover:bg-amber-400/28 text-[#713F12] dark:text-amber-200 text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
            >
              <Plus className="w-3.5 h-3.5" />
              <StickyNote className="w-3.5 h-3.5" />
              <span>{t.addStickyNote}</span>
            </button>
          </div>
        </div>
      )}

      {/* Inline Formatting Bar when in Markdown Source Mode */}
      {!isEmbeddedPdf && isSourceMode && (
        <div className="no-print px-4 sm:px-6 py-2 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] flex flex-wrap items-center justify-between gap-2 shrink-0">
          {renderAnnotationPalette(
            (hex) => applyFormatInSourceEditor('color', hex),
            (hex) => applyFormatInSourceEditor('highlight', hex),
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
        onMouseUp={updateFloatingSelectionPosition}
        onKeyUp={updateFloatingSelectionPosition}
        onScroll={() => {
          if (floatingSelection) setFloatingSelection(null);
          if (editingMath) setEditingMath(null);
          if (slashMenu) setSlashMenu(null);
        }}
        className="relative flex-1 overflow-y-auto overflow-x-auto px-5 sm:px-10 lg:px-14 py-7 min-h-0"
      >
        {/* Slash Command `/` Popover inside WYSIWYG Canvas */}
        {!isSourceMode && slashMenu && filteredSlashCommands.length > 0 && (
          <div
            style={{
              top: `${slashMenu.top}px`,
              left: `${slashMenu.left}px`,
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="no-print hd-modal-in absolute z-40 w-[236px] rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#3A3A3A] shadow-2xl p-1.5 font-sans"
          >
            <p className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#8E8D8A] dark:text-[#888783]">
              {t.slashMenuHint}
            </p>
            <div className="space-y-0.5 max-h-[260px] overflow-y-auto">
              {filteredSlashCommands.map((cmd, idx) => {
                const Icon = cmd.icon;
                const isSelected = idx === slashMenu.activeIndex;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    onMouseEnter={() =>
                      setSlashMenu((prev) => (prev ? { ...prev, activeIndex: idx } : null))
                    }
                    onClick={() => executeSlashCommand(cmd.id)}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left flex items-center gap-2 text-[13px] cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 font-medium'
                        : 'text-[#262624] dark:text-[#ECECEA] hover:bg-[#F3F3F1] dark:hover:bg-[#323232]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0 opacity-80" />
                    <span className="flex-1 truncate">{cmd.label}</span>
                    <span className="text-[11px] font-mono text-[#8E8D8A] shrink-0">
                      {cmd.shortcut}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Floating Notion-Style Color & Highlight Popover (on text selection in WYSIWYG canvas) */}
        {!isSourceMode && floatingSelection && (
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
              (hex) => applyFormatInWysiwyg('color', hex),
              (hex) => applyFormatInWysiwyg('highlight', hex),
              true
            )}
          </div>
        )}

        {/* Inline Click-to-Edit KaTeX Formula Popover */}
        {!isSourceMode && editingMath && (
          <form
            onSubmit={handleSaveMathEdit}
            style={{
              top: `${editingMath.top}px`,
              left: `${editingMath.left}px`,
              transform: 'translateX(-50%)',
            }}
            onClick={(e) => e.stopPropagation()}
            className="no-print hd-modal-in absolute z-30 w-[min(380px,calc(100%-24px))] rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#3A3A3A] shadow-2xl p-3 space-y-2.5 font-sans"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97]">
                {t.editFormulaTitle}
              </span>
              <button
                type="button"
                onClick={() => setEditingMath(null)}
                className="p-1 rounded-md text-[#6B6A66] hover:text-[#262624] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={editingMath.latex}
              onChange={(e) =>
                setEditingMath((prev) => (prev ? { ...prev, latex: e.target.value } : null))
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditingMath(null);
                }
              }}
              className="w-full h-9 px-2.5 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] bg-[#FBFBFA] dark:bg-[#191919] font-mono text-[13px] text-[#262624] dark:text-[#ECECEA] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {editingMathPreviewHtml && (
              <div
                className="px-2.5 py-2 rounded-lg bg-[#FBFBFA] dark:bg-[#191919] border border-[#E8E8E5] dark:border-[#323232] text-center overflow-x-auto text-[#262624] dark:text-[#ECECEA]"
                dangerouslySetInnerHTML={{ __html: editingMathPreviewHtml }}
              />
            )}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setEditingMath(null)}
                className="h-8 px-3 rounded-lg border border-[#E8E8E5] dark:border-[#3A3A3A] text-[12.5px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="h-8 px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t.save}</span>
              </button>
            </div>
          </form>
        )}

        {/* Inner Document Paper Container */}
        <article
          ref={articleRef}
          className="print-only-document mx-auto transition-[font-size,max-width] duration-150"
          style={{
            fontSize: `${scaledFontPx}px`,
            fontFamily: activeFont.stack,
            maxWidth: `${scaledPaperMaxWidthPx}px`,
            minHeight: stickyCanvasMinHeightPx > 0 ? `${stickyCanvasMinHeightPx}px` : undefined,
          }}
        >
          <header className="mb-6 pb-4 border-b border-[#E8E8E5] dark:border-[#2F2F2F]">
            {/* Always-editable seamless Notion-style Title (prints as clean multi-line H1) */}
            <input
              ref={titleInputRef}
              type="text"
              value={draftTitle}
              onChange={(e) => {
                const next = e.target.value;
                setDraftTitle(next);
                draftTitleRef.current = next;
                scheduleAutoSave(next, getLatestMarkdownContent());
              }}
              onBlur={flushPendingSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (isSourceMode) {
                    textareaRef.current?.focus();
                  } else {
                    editorRef.current?.focus();
                  }
                }
              }}
              placeholder={t.docTitlePlaceholder}
              aria-label={t.docTitlePlaceholder}
              className="no-print w-full bg-transparent text-2xl sm:text-3xl font-bold tracking-tight text-[#262624] dark:text-[#ECECEA] placeholder:text-[#B5B4B0] dark:placeholder:text-[#5C5B58] focus:outline-none rounded-md"
            />
            <h1 className="hidden print:block text-2xl font-bold tracking-tight text-black">
              {draftTitle.trim() || t.untitledDoc}
            </h1>

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

          {isSourceMode ? (
            <div className="space-y-3 no-print">
              <textarea
                ref={textareaRef}
                rows={18}
                value={draftContent}
                onChange={(e) => {
                  const next = e.target.value;
                  setDraftContent(next);
                  draftContentRef.current = next;
                  scheduleAutoSave(draftTitleRef.current, next);
                }}
                onBlur={flushPendingSave}
                placeholder={t.markdownPlaceholder}
                style={{ fontSize: `${scaledFontPx}px`, fontFamily: activeFont.stack }}
                className="w-full p-4 rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-2 font-sans">
                <button
                  type="button"
                  onClick={handleToggleSourceMode}
                  className="h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-semibold inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>{t.visualEditor}</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck
              role="textbox"
              aria-multiline="true"
              aria-label={draftTitle || t.untitledDoc}
              data-placeholder={t.wysiwygPlaceholder}
              onInput={handleWysiwygInput}
              onChange={handleWysiwygCheckboxChange}
              onKeyDown={handleWysiwygKeyDown}
              onBlur={flushPendingSave}
              onPaste={handleWysiwygPaste}
              onClick={handleWysiwygClick}
              className="study-markdown hd-wysiwyg-editor min-h-[55vh] text-[#262624] dark:text-[#ECECEA]"
              style={{ fontSize: 'inherit', fontFamily: 'inherit' }}
            />
          )}

          {/* Free-Moving Draggable & Resizable Sticky Notes (positioned on canvas; prints cleanly in B&W below paper) */}
          {!isSourceMode && (
            <StickyNoteLayer
              notes={stickyNotes}
              visible={stickyNotesVisible}
              canvasRef={readerScrollRef}
              onUpdateNote={handleUpdateStickyNote}
              onDeleteNote={handleDeleteStickyNote}
              t={t}
            />
          )}
        </article>
      </div>
      )}
    </div>
  );
}

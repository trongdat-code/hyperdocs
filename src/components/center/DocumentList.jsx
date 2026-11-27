import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import {
  FileText,
  ScanLine,
  Upload,
  FilePlus2,
  FolderPlus,
  Folder,
  FolderOpen,
  ChevronRight,
  Search,
  Tag,
  Pencil,
  Trash2,
  X,
  Check,
  Camera,
  Loader2,
  Sparkles,
  Calendar,
  FolderInput,
  Link2,
  Crop,
  RotateCcw,
  Pin,
} from 'lucide-react';
import { fileToBase64, scanA4Document } from '../../services/geminiService';
import {
  convertDocxFileToMarkdown,
  importPdfFile,
} from '../../services/importService';
import { compressImageFile } from '../../utils/documentProcessor';
import {
  doesDocMatchQuery,
  doesFolderMatchQuery,
  doesTagMatchQuery,
  normalizeSearchText,
} from '../../utils/searchUtils';
import ImportModal from '../ImportModal';
import ImageCropModal from '../ImageCropModal';

const MAX_TAGS = 3;
const ALL_DOCS_EXPANDED_KEY = 'hyperdocs_all_docs_expanded';

export default function DocumentList({
  documents,
  folders,
  customTags = [],
  onOpenTagManager,
  selectedDocId,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
  searchInputRef,
  allDocsExpanded: controlledAllDocsExpanded,
  onToggleAllDocsExpanded,
  onOpenDocument,
  onCreateDocument,
  onUpdateDocument,
  onTogglePin,
  onDeleteDocument,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleDocFolder,
  onNotify,
  t,
  lang,
  density,
}) {
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const searchQuery =
    controlledSearchQuery !== undefined ? controlledSearchQuery : localSearchQuery;
  const setSearchQuery = onSearchQueryChange || setLocalSearchQuery;

  const [localAllDocsExpanded, setLocalAllDocsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(ALL_DOCS_EXPANDED_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const allDocsExpanded =
    controlledAllDocsExpanded !== undefined ? controlledAllDocsExpanded : localAllDocsExpanded;
  const toggleAllDocsAccordion = () => {
    if (onToggleAllDocsExpanded) {
      onToggleAllDocsExpanded();
      return;
    }
    setLocalAllDocsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ALL_DOCS_EXPANDED_KEY, String(next));
      } catch {
        // ignore storage quota error
      }
      return next;
    });
  };

  const [expandedFolderIds, setExpandedFolderIds] = useState(() =>
    folders.length > 0 ? [folders[0].id] : []
  );

  // Document Rename / Tags modal
  const [editingMetaDoc, setEditingMetaDoc] = useState(null);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaTags, setMetaTags] = useState([]);

  // Folder Create / Edit modal
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderTagsDraft, setFolderTagsDraft] = useState([]);

  // Many-to-many "Assign to Folders" modal for a document
  const [assigningDocId, setAssigningDocId] = useState(null);

  // A4 OCR Scanner Modal state
  const [showScanner, setShowScanner] = useState(false);
  const [scanImageFile, setScanImageFile] = useState(null);
  const [scanImagePreview, setScanImagePreview] = useState('');
  const [scanCompressedImage, setScanCompressedImage] = useState(null);
  const [scanCroppedImage, setScanCroppedImage] = useState(null);
  const [scanCropModalOpen, setScanCropModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedMarkdown, setScannedMarkdown] = useState('');
  const [scannedTitle, setScannedTitle] = useState('');
  const [scannedTags, setScannedTags] = useState([]);

  // Unified Import Link Modal state (Google Docs + PDF / Google Drive URL auto-detection)
  const [importModalOpen, setImportModalOpen] = useState(false);

  // PDF / File Upload & Drag-and-Drop state
  const [pdfStatusMode, setPdfStatusMode] = useState(null); // null | 'ai' | 'local'
  const [isDraggingOverList, setIsDraggingOverList] = useState(false);
  const [dragTargetFolderId, setDragTargetFolderId] = useState(null);
  const pendingUploadFolderIdsRef = useRef([]);

  const uploadInputRef = useRef(null);
  const scanInputRef = useRef(null);

  const sortedDocs = useMemo(() => {
    return [...documents].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
  }, [documents]);

  const hasActiveSearch = Boolean(normalizeSearchText(searchQuery));

  const filteredDocs = useMemo(() => {
    return sortedDocs.filter((doc) => doesDocMatchQuery(doc, searchQuery));
  }, [sortedDocs, searchQuery]);

  const filteredFolders = useMemo(() => {
    return [...folders]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter((folder) => {
        const folderDocs = sortedDocs.filter((d) => (d.folderIds || []).includes(folder.id));
        return doesFolderMatchQuery(folder, folderDocs, searchQuery);
      });
  }, [folders, sortedDocs, searchQuery]);

  const assigningDoc = useMemo(
    () => documents.find((d) => d.id === assigningDocId) || null,
    [documents, assigningDocId]
  );

  const toggleFolderAccordion = (folderId) => {
    setExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const toggleTagInList = (tag, list, setList) => {
    if (list.includes(tag)) {
      setList(list.filter((x) => x !== tag));
      return;
    }
    if (list.length >= MAX_TAGS) {
      onNotify(t.maxTagsReached, 'warning');
      return;
    }
    setList([...list, tag]);
  };

  // Unified processor for uploaded or dropped files (.pdf, .docx, .md, .txt)
  const processUploadedFile = async (file, targetFolderIds = []) => {
    if (!file) return;

    const now = Date.now();
    const resolvedFolders = Array.isArray(targetFolderIds) ? [...targetFolderIds] : [];
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isDocx =
      /\.docx$/i.test(file.name) ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isPdf) {
      setPdfStatusMode(t.pdfConvertingAi);
      try {
        const { title, content, method } = await importPdfFile(file, {
          language: lang,
          onProgress: (progress) => {
            if (!progress) return;
            if (progress.stage === 'ai') {
              setPdfStatusMode(t.pdfConvertingAi);
            } else if (progress.stage === 'ocr') {
              setPdfStatusMode(
                t.pdfOcrPageProgress(
                  progress.currentPage,
                  progress.endPage || progress.currentPage,
                  progress.totalPages
                )
              );
            } else if (progress.stage === 'local' && progress.totalPages) {
              setPdfStatusMode(
                t.pdfExtractingPageProgress(progress.currentPage, progress.totalPages)
              );
            } else {
              setPdfStatusMode(t.pdfExtractingLocal);
            }
          },
        });
        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          docType: 'imported-pdf',
          title,
          tags: ['PDF'],
          folderIds: resolvedFolders,
          createdAt: now,
          updatedAt: now,
          content,
        };
        onCreateDocument(newDoc, true);
        onNotify(
          method === 'ocr-fallback'
            ? t.pdfImportSuccessOcr
            : method === 'gemini'
              ? t.pdfImportSuccessAi
              : t.pdfImportSuccessLocal,
          'success'
        );
      } catch (err) {
        if (err.code === 'MISSING_API_KEY') {
          onNotify(t.missingApiKeyError, 'error');
        } else {
          onNotify(err?.message || t.pdfImportError, 'error');
        }
      } finally {
        setPdfStatusMode(null);
      }
      return;
    }

    if (isDocx) {
      try {
        const { title, content } = await convertDocxFileToMarkdown(file, {
          sanitizeKatex: true,
        });
        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          docType: 'imported-docx',
          title,
          tags: ['DOCX'],
          folderIds: resolvedFolders,
          createdAt: now,
          updatedAt: now,
          content,
        };
        onCreateDocument(newDoc, true);
        onNotify(t.docxImportSuccess, 'success');
      } catch {
        onNotify(t.docxImportError, 'error');
      }
      return;
    }

    const text = await file.text();
    const baseName = file.name.replace(/\.(md|markdown|txt)$/i, '').trim() || t.untitledDoc;
    const isPlainText = /\.txt$/i.test(file.name);
    const normalizedContent =
      isPlainText && !text.trim().startsWith('#') ? `# ${baseName}\n\n${text}` : text;

    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: baseName,
      tags: [isPlainText ? 'Text' : 'Markdown'],
      folderIds: resolvedFolders,
      createdAt: now,
      updatedAt: now,
      content: normalizedContent,
    };
    onCreateDocument(newDoc, true);
  };

  // Plain text, Markdown, Word (.docx), or PDF upload input handler
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const targetFolders = pendingUploadFolderIdsRef.current;
    pendingUploadFolderIdsRef.current = [];
    if (!file) return;
    await processUploadedFile(file, targetFolders);
  };

  const triggerUploadIntoFolders = (folderIds = []) => {
    pendingUploadFolderIdsRef.current = folderIds;
    uploadInputRef.current?.click();
  };

  // Workspace Drag-and-Drop handlers for .pdf / .docx / .md / .txt
  const handleWorkspaceDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDraggingOverList) setIsDraggingOverList(true);
  };

  const handleWorkspaceDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDraggingOverList(false);
      setDragTargetFolderId(null);
    }
  };

  const handleWorkspaceDrop = async (e, folderId = null) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverList(false);
    setDragTargetFolderId(null);

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    // Save into dropped folder, or into currently expanded folders if user dropped on main canvas
    const targetFolders = folderId ? [folderId] : [];
    await processUploadedFile(file, targetFolders);
  };

  // Unified Import Link Modal Opener (auto-detects Google Docs & PDF / Google Drive links)
  const handleOpenImportModal = () => {
    setImportModalOpen(true);
  };

  const handleNewNote = () => {
    const now = Date.now();
    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      type: 'note',
      docType: 'note',
      title: t.untitledDoc,
      tags: ['Notes'],
      folderIds: [],
      createdAt: now,
      updatedAt: now,
      content: `# ${t.untitledDoc}\n\nStart writing notes with **Markdown** and **KaTeX** equations:\n\n$$E = mc^2$$\n`,
    };
    onCreateDocument(newDoc, true, true);
  };

  // Folder Modal Handlers
  const openCreateFolder = () => {
    setEditingFolder(null);
    setFolderNameDraft('');
    setFolderTagsDraft([]);
    setFolderModalOpen(true);
  };

  const openEditFolder = (folder, e) => {
    e.stopPropagation();
    setEditingFolder(folder);
    setFolderNameDraft(folder.name || '');
    setFolderTagsDraft([...(folder.tags || [])].slice(0, MAX_TAGS));
    setFolderModalOpen(true);
  };

  const handleSaveFolder = (e) => {
    e.preventDefault();
    const cleanName = folderNameDraft.trim();
    if (!cleanName) return;
    const nextTags = [...folderTagsDraft];

    if (editingFolder) {
      onUpdateFolder({
        ...editingFolder,
        name: cleanName,
        tags: nextTags.slice(0, MAX_TAGS),
      });
    } else {
      const created = {
        id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: cleanName,
        tags: nextTags.slice(0, MAX_TAGS),
        createdAt: Date.now(),
      };
      onCreateFolder(created);
      setExpandedFolderIds((prev) => [...prev, created.id]);
    }
    setFolderModalOpen(false);
  };

  // Document Metadata Modal Handlers
  const openMetaEditor = (doc, e) => {
    e.stopPropagation();
    setEditingMetaDoc(doc);
    setMetaTitle(doc.title || '');
    setMetaTags([...(doc.tags || [])].slice(0, MAX_TAGS));
  };

  const handleSaveMeta = (e) => {
    e.preventDefault();
    if (!editingMetaDoc) return;
    onUpdateDocument({
      ...editingMetaDoc,
      title: metaTitle.trim() || t.untitledDoc,
      tags: metaTags.slice(0, MAX_TAGS),
      updatedAt: Date.now(),
    });
    setEditingMetaDoc(null);
  };

  // A4 OCR Scanner handlers
  const handleOpenScanner = () => {
    setScanImageFile(null);
    setScanImagePreview('');
    setScanCompressedImage(null);
    setScanCroppedImage(null);
    setScanCropModalOpen(false);
    setScannedMarkdown('');
    setScannedTitle('');
    setScannedTags([]);
    setShowScanner(true);
  };

  const handleSelectScanImage = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setScanImageFile(file);
    setScanCroppedImage(null);
    setScannedMarkdown('');
    try {
      const compressed = await compressImageFile(file);
      setScanCompressedImage(compressed);
      setScanImagePreview(compressed.dataUrl);
    } catch {
      const url = URL.createObjectURL(file);
      setScanCompressedImage(null);
      setScanImagePreview(url);
    }
  };

  const handleRunOCR = async () => {
    if (!scanImageFile && !scanCompressedImage && !scanCroppedImage) return;
    setIsScanning(true);
    try {
      const activePayload = scanCroppedImage || scanCompressedImage;
      const { data, mimeType } = activePayload
        ? { data: activePayload.base64, mimeType: activePayload.mimeType }
        : await fileToBase64(scanImageFile);
      const { markdown, suggestedTitle } = await scanA4Document({
        base64Data: data,
        mimeType,
        language: lang,
      });
      setScannedMarkdown(markdown);
      setScannedTitle(suggestedTitle);
    } catch (err) {
      if (err.code === 'MISSING_API_KEY') {
        onNotify(t.missingApiKeyError, 'error');
      } else {
        onNotify(`${t.aiErrorPrefix}${err.message}`, 'error');
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveScannedDocument = () => {
    if (!scannedMarkdown.trim()) return;
    const now = Date.now();
    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: scannedTitle.trim() || t.untitledDoc,
      tags: scannedTags.slice(0, MAX_TAGS),
      folderIds: [],
      createdAt: now,
      updatedAt: now,
      content: scannedMarkdown,
    };
    onCreateDocument(newDoc, true);
    setShowScanner(false);
  };

  const rowPad = density === 'compact' ? 'px-3 py-2' : 'px-3.5 py-2.5';

  // Reusable Notion-styled Document Row (used inside Folder Accordions AND All Documents)
  const renderDocumentRow = (doc, nested = false) => {
    const isSelected = doc.id === selectedDocId;
    const assignedCount = (doc.folderIds || []).filter((fid) =>
      folders.some((f) => f.id === fid)
    ).length;

    return (
      <div
        key={`${nested ? 'nested' : 'root'}_${doc.id}`}
        onClick={() => onOpenDocument(doc.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDocument(doc.id);
          }
        }}
        className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${rowPad} rounded-xl border transition-colors duration-150 cursor-pointer ${
          nested
            ? 'border-transparent hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C]'
            : isSelected
              ? 'border-[#DCDCD8] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#262626]'
              : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#191919] hover:bg-[#FBFBFA] dark:hover:bg-[#222222]'
        }`}
      >
        {/* Left: Icon + Title + Metadata */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <FileText
            className={`w-4 h-4 mt-1 sm:mt-0 shrink-0 ${
              doc.docType === 'pdf-embed'
                ? 'text-rose-600 dark:text-rose-400'
                : nested
                  ? 'text-[#6B6A66] dark:text-[#9B9A97]'
                  : 'text-indigo-600 dark:text-indigo-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-medium text-[15px] leading-snug text-[#262624] dark:text-[#ECECEA] truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-150">
                {doc.title}
              </h3>
              {doc.pinned && (
                <Pin
                  className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 fill-current shrink-0"
                  aria-label={t.pinnedBadge}
                />
              )}
              {doc.docType === 'pdf-embed' && (
                <span className="px-1.5 py-0.5 rounded-md bg-rose-500/12 text-rose-700 dark:text-rose-300 text-[10.5px] font-semibold uppercase tracking-wide shrink-0">
                  PDF
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-0.5 text-[12.5px] text-[#6B6A66] dark:text-[#9B9A97]">
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(doc.createdAt)}
              </span>

              {!nested && assignedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                  <Folder className="w-3 h-3" />
                  {t.inFoldersCount(assignedCount)}
                </span>
              )}

              <div className="flex flex-wrap items-center gap-1">
                {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => {
                  const isTagMatch = doesTagMatchQuery(tag, searchQuery);
                  return (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium text-[11.5px] transition-colors duration-150 ${
                        isTagMatch
                          ? 'bg-amber-200/85 dark:bg-amber-500/30 text-amber-950 dark:text-amber-200 ring-1 ring-amber-400/70 dark:ring-amber-400/50 font-semibold'
                          : 'bg-[#F3F3F1] dark:bg-[#2C2C2C] text-[#555552] dark:text-[#C5C4C0]'
                      }`}
                    >
                      <Tag
                        className={`w-2.5 h-2.5 ${
                          isTagMatch
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-indigo-500'
                        }`}
                      />
                      {tag}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Row Action Controls */}
        <div
          className="flex items-center gap-1 shrink-0 self-end sm:self-center opacity-85 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {onTogglePin && (
            <button
              type="button"
              onClick={() => onTogglePin(doc.id)}
              title={doc.pinned ? t.unpinDoc : t.pinDoc}
              aria-label={doc.pinned ? t.unpinDoc : t.pinDoc}
              aria-pressed={Boolean(doc.pinned)}
              className={`p-2 rounded-lg cursor-pointer transition-colors duration-150 ${
                doc.pinned
                  ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-500/10'
                  : 'text-[#6B6A66] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-[#E8E8E5]/80 dark:hover:bg-[#343434]'
              }`}
            >
              <Pin className={`w-3.5 h-3.5 ${doc.pinned ? 'fill-current' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setAssigningDocId(doc.id)}
            title={t.assignToFolders}
            className="min-h-[34px] px-2 rounded-lg text-[12px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:bg-[#E8E8E5]/80 dark:hover:bg-[#343434] inline-flex items-center gap-1 cursor-pointer transition-colors duration-150"
          >
            <FolderInput className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{t.assignToFolders}</span>
          </button>
          <button
            type="button"
            onClick={(e) => openMetaEditor(doc, e)}
            title={`${t.renameDoc} / ${t.editTags}`}
            className="p-2 rounded-lg text-[#6B6A66] hover:text-[#262624] dark:hover:text-white hover:bg-[#E8E8E5]/80 dark:hover:bg-[#343434] cursor-pointer transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteDocument(doc.id)}
            title={t.deleteDoc}
            className="p-2 rounded-lg text-[#6B6A66] hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer transition-colors duration-150"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      onDragOver={handleWorkspaceDragOver}
      onDragLeave={handleWorkspaceDragLeave}
      onDrop={(e) => handleWorkspaceDrop(e, null)}
      className="relative flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919]"
    >
      {/* Drag-and-Drop Overlay */}
      {isDraggingOverList && !dragTargetFolderId && (
        <div className="hd-fade-in pointer-events-none absolute inset-3 z-30 rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-500/8 backdrop-blur-[1px] flex flex-col items-center justify-center text-center p-6">
          <Upload className="w-10 h-10 text-indigo-600 dark:text-indigo-400 mb-2" />
          <p className="text-[16px] font-semibold text-indigo-700 dark:text-indigo-300">
            {t.dropFilesOverlayTitle}
          </p>
          <p className="text-[13px] text-[#555552] dark:text-[#C5C4C0] mt-1">
            {t.dropFilesOverlayHint}
          </p>
        </div>
      )}
      {/* Top Workspace Header & Actions */}
      <div className="px-5 sm:px-8 pt-5 pb-3.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F] shrink-0">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-bold text-xl tracking-tight text-[#262624] dark:text-[#ECECEA]">
                {t.documentsTitle}
              </h1>
              <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97]">
                {t.folderCount(folders.length)} · {t.docCount(documents.length)} · Markdown + KaTeX
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* + New Folder */}
              <button
                type="button"
                onClick={openCreateFolder}
                className="min-h-[38px] px-3 rounded-lg border border-[#D4D4D8] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#18181B] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] text-[#111111] dark:text-[#F4F4F5] text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                <FolderPlus className="w-4 h-4 text-[#52525B] dark:text-[#A1A1AA]" />
                <span>{t.newFolder}</span>
              </button>

              {/* Unified Import Link (Solid Black Background & Pure White Text/Icon) */}
              <button
                type="button"
                onClick={handleOpenImportModal}
                className="min-h-[38px] px-3.5 rounded-lg bg-[#111111] hover:bg-[#27272A] text-[#FFFFFF] border border-[#3F3F46] text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                <Link2 className="w-4 h-4 text-[#FFFFFF]" />
                <span>{t.importLinkButton}</span>
              </button>

              {/* AI A4 OCR Scanner (Solid Black Background & Pure White Text/Icon) */}
              <button
                type="button"
                onClick={handleOpenScanner}
                className="min-h-[38px] px-3.5 rounded-lg bg-[#111111] hover:bg-[#27272A] text-[#FFFFFF] border border-[#3F3F46] text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                <ScanLine className="w-4 h-4 text-[#FFFFFF]" />
                <span>{t.scanA4}</span>
              </button>

              {/* Upload .md / .txt / .docx / .pdf (Solid Black Background & Pure White Text/Icon) */}
              <button
                type="button"
                disabled={Boolean(pdfStatusMode)}
                onClick={() => triggerUploadIntoFolders([])}
                title=".md, .txt, .docx, .pdf"
                className="min-h-[38px] px-3.5 rounded-lg bg-[#111111] hover:bg-[#27272A] text-[#FFFFFF] border border-[#3F3F46] disabled:opacity-50 text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                {pdfStatusMode ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#FFFFFF]" />
                ) : (
                  <Upload className="w-4 h-4 text-[#FFFFFF]" />
                )}
                <span>{t.uploadFile}</span>
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".md,.markdown,.txt,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* New Note */}
              <button
                type="button"
                onClick={handleNewNote}
                className="min-h-[38px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#262624] dark:text-[#ECECEA] text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                <FilePlus2 className="w-4 h-4" />
                <span>{t.newDoc}</span>
              </button>
            </div>
          </div>

          {/* Active PDF Conversion Progress Banner */}
          {pdfStatusMode && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2.5 flex items-center gap-2.5 text-[13px] font-medium text-indigo-700 dark:text-indigo-300">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{pdfStatusMode}</span>
            </div>
          )}

          {/* Search Bar + Single Centralized "Tạo nhãn" / "Create Tag" Button */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6B6A66] dark:text-[#9B9A97] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && searchQuery) {
                    setSearchQuery('');
                    e.currentTarget.blur();
                  }
                }}
                placeholder={t.globalSearchPlaceholder}
                className="w-full min-h-[38px] pl-9 pr-16 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] text-[14px] text-[#262624] dark:text-[#ECECEA] placeholder:text-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title={t.clearSearch}
                  aria-label={t.clearSearch}
                  className="p-1 rounded-md text-[#9B9A97] hover:text-[#262624] dark:hover:text-white hover:bg-[#E8E8E5]/70 dark:hover:bg-[#323232] absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-[#E0E0DC] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#262626] text-[11px] font-medium text-[#9B9A97] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  Ctrl K
                </kbd>
              )}
            </div>

            {onOpenTagManager && (
              <button
                type="button"
                onClick={onOpenTagManager}
                title={t.tagManagerTitle}
                className="min-h-[38px] px-3.5 rounded-lg border border-[#D4D4D8] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#18181B] hover:bg-[#F4F4F5] dark:hover:bg-[#27272A] text-[#111111] dark:text-[#F4F4F5] text-[13px] font-medium inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer transition-colors duration-150"
              >
                <Tag className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA]" />
                <span>{t.createTagBtn}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Center List: Inline Folder Accordions + All Documents */}
      <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 min-h-0">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* 1. Custom Folders (Inline Expandable Accordions) */}
          {filteredFolders.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97] px-1">
                {t.foldersSectionLabel} ({filteredFolders.length})
              </h2>

              <div className="space-y-1.5">
                {filteredFolders.map((folder) => {
                  const isExpanded = expandedFolderIds.includes(folder.id) || hasActiveSearch;
                  const allFolderDocs = sortedDocs.filter((d) =>
                    (d.folderIds || []).includes(folder.id)
                  );
                  const matchingFolderDocs = allFolderDocs.filter((d) =>
                    doesDocMatchQuery(d, searchQuery)
                  );
                  const folderDocs = hasActiveSearch
                    ? matchingFolderDocs.length > 0
                      ? matchingFolderDocs
                      : allFolderDocs
                    : allFolderDocs;

                  return (
                    <div
                      key={folder.id}
                      onDragOver={(e) => {
                        if (!e.dataTransfer?.types?.includes('Files')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingOverList(true);
                        if (dragTargetFolderId !== folder.id) setDragTargetFolderId(folder.id);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          if (dragTargetFolderId === folder.id) setDragTargetFolderId(null);
                        }
                      }}
                      onDrop={(e) => handleWorkspaceDrop(e, folder.id)}
                      className={`rounded-xl border overflow-hidden transition-colors duration-150 ${
                        dragTargetFolderId === folder.id
                          ? 'border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/5'
                          : 'border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020]'
                      }`}
                    >
                      {/* Folder Accordion Header Row */}
                      <div
                        onClick={() => toggleFolderAccordion(folder.id)}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleFolderAccordion(folder.id);
                          }
                        }}
                        className={`group flex items-center justify-between gap-2 ${rowPad} hover:bg-[#F3F3F1] dark:hover:bg-[#262626] cursor-pointer transition-colors duration-150`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[#6B6A66] dark:text-[#9B9A97] shrink-0">
                            <ChevronRight
                              className={`w-4 h-4 transition-transform duration-150 ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                            />
                          </span>
                          {isExpanded ? (
                            <FolderOpen className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          )}
                          <span className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] truncate">
                            {folder.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-[#F3F3F1] dark:bg-[#2C2C2C] text-[#6B6A66] dark:text-[#9B9A97] text-[12px] font-medium tabular-nums shrink-0">
                            {folderDocs.length}
                          </span>

                          {/* Folder Tags (max 3) */}
                          <div className="hidden sm:flex flex-wrap items-center gap-1 ml-1">
                            {(folder.tags || []).slice(0, MAX_TAGS).map((tag) => {
                              const isTagMatch = doesTagMatchQuery(tag, searchQuery);
                              return (
                                <span
                                  key={tag}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11.5px] font-medium transition-colors duration-150 ${
                                    isTagMatch
                                      ? 'bg-amber-200/85 dark:bg-amber-500/30 border-amber-400/70 dark:border-amber-400/50 text-amber-950 dark:text-amber-200 font-semibold'
                                      : 'bg-[#FFFFFF] dark:bg-[#262626] border-[#E8E8E5] dark:border-[#343434] text-[#555552] dark:text-[#C5C4C0]'
                                  }`}
                                >
                                  <Tag
                                    className={`w-2.5 h-2.5 ${
                                      isTagMatch
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : 'text-amber-500'
                                    }`}
                                  />
                                  {tag}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        {/* Folder Actions */}
                        <div
                          className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={Boolean(pdfStatusMode)}
                            onClick={() => triggerUploadIntoFolders([folder.id])}
                            title={t.uploadIntoFolder}
                            className="p-1.5 rounded-lg text-[#6B6A66] hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-[#E8E8E5]/80 dark:hover:bg-[#343434] disabled:opacity-40 cursor-pointer transition-colors duration-150"
                          >
                            <Upload className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => openEditFolder(folder, e)}
                            title={t.editFolder}
                            className="p-1.5 rounded-lg text-[#6B6A66] hover:text-[#262624] dark:hover:text-white hover:bg-[#E8E8E5]/80 dark:hover:bg-[#343434] cursor-pointer transition-colors duration-150"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteFolder(folder.id)}
                            title={t.deleteFolder}
                            className="p-1.5 rounded-lg text-[#6B6A66] hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer transition-colors duration-150"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Inline Documents */}
                      {isExpanded && (
                        <div className="border-t border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF]/80 dark:bg-[#1C1C1C] px-3 py-2 pl-7 space-y-1">
                          {folderDocs.length === 0 ? (
                            <p className="text-[13px] text-[#6B6A66] dark:text-[#8E8D8A] py-2 px-1 italic">
                              {t.emptyFolderHint}
                            </p>
                          ) : (
                            folderDocs.map((doc) => renderDocumentRow(doc, true))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2. Collapsible All Documents Accordion (matches Custom Folders style & persists state) */}
          {(() => {
            const isAllDocsOpen = allDocsExpanded || hasActiveSearch;
            return (
              <div className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] overflow-hidden transition-colors duration-150">
                <div
                  onClick={toggleAllDocsAccordion}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isAllDocsOpen}
                  aria-label={isAllDocsOpen ? t.collapseSection : t.expandSection}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleAllDocsAccordion();
                    }
                  }}
                  className={`group flex items-center justify-between gap-2 ${rowPad} hover:bg-[#F3F3F1] dark:hover:bg-[#262626] cursor-pointer transition-colors duration-150`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-[#6B6A66] dark:text-[#9B9A97] shrink-0">
                      <ChevronRight
                        className={`w-4 h-4 transition-transform duration-150 ${
                          isAllDocsOpen ? 'rotate-90' : ''
                        }`}
                      />
                    </span>
                    <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] truncate">
                      {t.allDocumentsSectionLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-[#F3F3F1] dark:bg-[#2C2C2C] text-[#6B6A66] dark:text-[#9B9A97] text-[12px] font-medium tabular-nums shrink-0">
                      {filteredDocs.length}
                    </span>
                  </div>
                </div>

                {isAllDocsOpen && (
                  <div className="border-t border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF]/80 dark:bg-[#191919] p-2.5 sm:p-3">
                    {filteredDocs.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA]/50 dark:bg-[#202020]/50 p-8 text-center text-[#6B6A66] dark:text-[#9B9A97]">
                        <FileText className="w-7 h-7 mx-auto mb-2 opacity-40" />
                        <p className="text-[14px]">{t.noDocsFound}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredDocs.map((doc) => renderDocumentRow(doc, false))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Create / Edit Folder Modal */}
      {folderModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => setFolderModalOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="hd-modal-in w-full max-w-md rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px] text-[#262624] dark:text-[#ECECEA]">
                  {editingFolder ? t.editFolder : t.createFolder}
                </h3>
                <button
                  type="button"
                  onClick={() => setFolderModalOpen(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveFolder} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.folderNameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={folderNameDraft}
                    onChange={(e) => setFolderNameDraft(e.target.value)}
                    placeholder={t.folderNamePlaceholder}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                      {t.editTags} ({folderTagsDraft.length}/{MAX_TAGS})
                    </label>
                    <span className="text-[12px] text-[#9B9A97]">{t.selectExistingTagsHint}</span>
                  </div>

                  {customTags.length === 0 ? (
                    <p className="text-[12.5px] text-[#6B6A66] dark:text-[#9B9A97] italic py-1.5">
                      {t.noTagsCreatedYet}
                    </p>
                  ) : (
                    <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#191919]">
                      {customTags.map((tag) => {
                        const selected = folderTagsDraft.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() =>
                              toggleTagInList(tag, folderTagsDraft, setFolderTagsDraft)
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12.5px] font-medium cursor-pointer transition-colors ${
                              selected
                                ? 'border-[#2563EB]/45 bg-[#EFF6FF] text-[#2563EB] dark:border-[#60A5FA]/45 dark:bg-[#2563EB]/[0.18] dark:text-[#60A5FA]'
                                : 'border-[#E4E4E7] dark:border-[#323232] bg-[#FFFFFF] dark:bg-[#242424] text-[#52525B] dark:text-[#A1A1AA] hover:border-[#A1A1AA]'
                            }`}
                          >
                            {selected && <Check className="w-3 h-3 shrink-0" />}
                            <span>{tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setFolderModalOpen(false)}
                    className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[14px] font-medium cursor-pointer transition-colors duration-150"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[14px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t.save}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Many-to-Many "Assign to Folders" Modal */}
      {assigningDoc &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => setAssigningDocId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="hd-modal-in w-full max-w-md rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[16px] text-[#262624] dark:text-[#ECECEA]">
                    {t.assignToFolders}
                  </h3>
                  <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] truncate">
                    {assigningDoc.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssigningDocId(null)}
                  className="p-1.5 rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {folders.length === 0 ? (
                <p className="text-[14px] text-[#6B6A66] dark:text-[#9B9A97] py-4 text-center">
                  {t.noFoldersCreated}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {folders.map((folder) => {
                    const isChecked = (assigningDoc.folderIds || []).includes(folder.id);
                    return (
                      <label
                        key={folder.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors duration-150 ${
                          isChecked
                            ? 'border-indigo-500/50 bg-indigo-500/6'
                            : 'border-[#E8E8E5] dark:border-[#343434] hover:bg-[#FBFBFA] dark:hover:bg-[#2F2F2F]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleDocFolder(assigningDoc.id, folder.id)}
                            className="w-4 h-4 rounded border-[#C6C5C0] text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                          />
                          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-[14px] font-medium text-[#262624] dark:text-[#ECECEA] truncate">
                            {folder.name}
                          </span>
                        </div>
                        {(folder.tags || []).length > 0 && (
                          <span className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] truncate max-w-[35%]">
                            #{folder.tags[0]}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[#E8E8E5] dark:border-[#2F2F2F]">
                <button
                  type="button"
                  onClick={() => {
                    setAssigningDocId(null);
                    openCreateFolder();
                  }}
                  className="text-[13px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>{t.newFolder}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAssigningDocId(null)}
                  className="min-h-[38px] px-4 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[13px] font-semibold cursor-pointer transition-colors duration-150"
                >
                  {t.doneReviewing}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Document Rename & Max-3 Tags Modal */}
      {editingMetaDoc &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => setEditingMetaDoc(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="hd-modal-in w-full max-w-md rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px] text-[#262624] dark:text-[#ECECEA]">
                  {t.renameDoc} & {t.editTags}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingMetaDoc(null)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveMeta} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.docTitlePlaceholder}
                  </label>
                  <input
                    type="text"
                    required
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                      {t.editTags} ({metaTags.length}/{MAX_TAGS})
                    </label>
                    <span className="text-[12px] text-[#9B9A97]">{t.selectExistingTagsHint}</span>
                  </div>

                  {customTags.length === 0 ? (
                    <p className="text-[12.5px] text-[#6B6A66] dark:text-[#9B9A97] italic py-1.5">
                      {t.noTagsCreatedYet}
                    </p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#191919]">
                      {customTags.map((tag) => {
                        const selected = metaTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTagInList(tag, metaTags, setMetaTags)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12.5px] font-medium cursor-pointer transition-colors ${
                              selected
                                ? 'border-[#2563EB]/45 bg-[#EFF6FF] text-[#2563EB] dark:border-[#60A5FA]/45 dark:bg-[#2563EB]/[0.18] dark:text-[#60A5FA]'
                                : 'border-[#E4E4E7] dark:border-[#323232] bg-[#FFFFFF] dark:bg-[#242424] text-[#52525B] dark:text-[#A1A1AA] hover:border-[#A1A1AA]'
                            }`}
                          >
                            {selected && <Check className="w-3 h-3 shrink-0" />}
                            <span>{tag}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingMetaDoc(null)}
                    className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[14px] font-medium cursor-pointer transition-colors duration-150"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[14px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t.save}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* Unified Import Link Modal (Auto-detects Google Docs + PDF / Google Drive URLs) */}
      <ImportModal
        isOpen={importModalOpen}
        folders={folders}
        customTags={customTags}
        onClose={() => setImportModalOpen(false)}
        onCreateDocument={onCreateDocument}
        onNotify={onNotify}
        t={t}
        lang={lang}
      />

      {/* AI A4 Document OCR Scanner Modal */}
      {showScanner &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            onClick={() => !isScanning && setShowScanner(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="hd-modal-in w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8E5] dark:border-[#2F2F2F] shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <ScanLine className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[16px] text-[#262624] dark:text-[#ECECEA]">
                      {t.scannerTitle}
                    </h3>
                    <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                      Gemini Vision → Markdown + KaTeX
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowScanner(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <p className="text-[14px] text-[#555552] dark:text-[#B5B4B0]">{t.scannerDesc}</p>

                {!scanImagePreview ? (
                  <div
                    onClick={() => scanInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleSelectScanImage(e.dataTransfer.files?.[0]);
                    }}
                    className="border-2 border-dashed border-[#D8D8D4] dark:border-[#3A3A3A] hover:border-indigo-500 rounded-xl p-10 text-center cursor-pointer transition-colors duration-150 bg-[#FBFBFA] dark:bg-[#202020]"
                  >
                    <Camera className="w-10 h-10 mx-auto text-indigo-500 mb-3" />
                    <p className="text-[15px] font-medium text-[#262624] dark:text-[#ECECEA]">
                      {t.dropImagePrompt}
                    </p>
                    <span className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold">
                      <Upload className="w-4 h-4" />
                      {t.captureCamera}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2.5">
                      <div className="relative rounded-xl overflow-hidden border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#191919] max-h-[340px] flex items-center justify-center">
                        <img
                          src={scanCroppedImage?.dataUrl || scanImagePreview}
                          alt="A4 Page Preview"
                          className="max-h-[340px] object-contain"
                        />
                        {scanCroppedImage && (
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[11px] font-semibold">
                            {t.croppedBadge}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isScanning}
                          onClick={() => setScanCropModalOpen(true)}
                          className="min-h-[36px] px-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/16 text-indigo-700 dark:text-indigo-300 text-[12.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                        >
                          <Crop className="w-3.5 h-3.5" />
                          <span>{t.cropSelectionBtn}</span>
                        </button>
                        {scanCroppedImage && (
                          <button
                            type="button"
                            disabled={isScanning}
                            onClick={() => setScanCroppedImage(null)}
                            className="min-h-[36px] px-2.5 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#6B6A66] dark:text-[#9B9A97] text-[12px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors duration-150"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{t.resetCropBtn}</span>
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => scanInputRef.current?.click()}
                          className="min-h-[40px] flex-1 px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[13px] font-medium cursor-pointer transition-colors duration-150"
                        >
                          {t.retakeImage}
                        </button>
                        <button
                          type="button"
                          disabled={isScanning}
                          onClick={handleRunOCR}
                          className="min-h-[40px] flex-1 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors duration-150"
                        >
                          {isScanning ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          <span>{isScanning ? t.scanningImage : t.scanAndExtract}</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col space-y-3 min-h-[260px]">
                      {scannedMarkdown ? (
                        <>
                          <input
                            type="text"
                            value={scannedTitle}
                            onChange={(e) => setScannedTitle(e.target.value)}
                            placeholder={t.docTitlePlaceholder}
                            className="w-full min-h-[40px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[15px] font-semibold"
                          />

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[12px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                                {t.editTags} ({scannedTags.length}/{MAX_TAGS})
                              </span>
                              <span className="text-[11px] text-[#9B9A97]">
                                {t.selectExistingTagsHint}
                              </span>
                            </div>
                            <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#191919]">
                              {customTags.map((tag) => {
                                const selected = scannedTags.includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() =>
                                      toggleTagInList(tag, scannedTags, setScannedTags)
                                    }
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[12px] font-medium cursor-pointer transition-colors ${
                                      selected
                                        ? 'border-[#2563EB]/45 bg-[#EFF6FF] text-[#2563EB] dark:border-[#60A5FA]/45 dark:bg-[#2563EB]/[0.18] dark:text-[#60A5FA]'
                                        : 'border-[#E4E4E7] dark:border-[#323232] bg-[#FFFFFF] dark:bg-[#242424] text-[#52525B] dark:text-[#A1A1AA]'
                                    }`}
                                  >
                                    {selected && <Check className="w-3 h-3 shrink-0" />}
                                    <span>{tag}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex-1 max-h-[240px] overflow-y-auto rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#191919] p-3.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97] mb-2">
                              {t.scannedPreviewTitle}
                            </p>
                            <div className="study-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                              >
                                {scannedMarkdown}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 rounded-xl border border-dashed border-[#E8E8E5] dark:border-[#343434] flex flex-col items-center justify-center p-6 text-center text-[#6B6A66] dark:text-[#9B9A97]">
                          {isScanning ? (
                            <>
                              <Loader2 className="w-7 h-7 animate-spin text-indigo-500 mb-2" />
                              <p className="text-[14px]">{t.scanningImage}</p>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-7 h-7 mb-2 opacity-50" />
                              <p className="text-[14px]">{t.scanAndExtract}</p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    handleSelectScanImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
              </div>

              {scannedMarkdown && (
                <div className="px-5 py-3.5 border-t border-[#E8E8E5] dark:border-[#2F2F2F] flex justify-end gap-2 shrink-0 bg-[#FBFBFA] dark:bg-[#202020]">
                  <button
                    type="button"
                    onClick={() => setShowScanner(false)}
                    className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[14px] font-medium cursor-pointer transition-colors duration-150"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveScannedDocument}
                    className="min-h-[40px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold cursor-pointer transition-colors duration-150"
                  >
                    {t.saveScannedDoc}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Interactive Crop Modal for A4 OCR Scanner */}
      <ImageCropModal
        isOpen={scanCropModalOpen}
        imageSrc={scanCroppedImage?.dataUrl || scanImagePreview}
        onCancel={() => setScanCropModalOpen(false)}
        onConfirm={(croppedResult) => {
          setScanCroppedImage(croppedResult);
          setScanCropModalOpen(false);
        }}
        t={t}
      />
    </div>
  );
}

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
  ChevronDown,
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
  AlertCircle,
} from 'lucide-react';
import { fileToBase64, scanA4Document } from '../../services/geminiService';
import { convertDocxFileToMarkdown, importGoogleDoc } from '../../services/importService';

const MAX_TAGS = 3;

export default function DocumentList({
  documents,
  folders,
  selectedDocId,
  onOpenDocument,
  onCreateDocument,
  onUpdateDocument,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState(() =>
    folders.length > 0 ? [folders[0].id] : []
  );

  // Document Rename / Tags modal
  const [editingMetaDoc, setEditingMetaDoc] = useState(null);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaTags, setMetaTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');

  // Folder Create / Edit modal
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderTagsDraft, setFolderTagsDraft] = useState([]);
  const [folderTagInput, setFolderTagInput] = useState('');

  // Many-to-many "Assign to Folders" modal for a document
  const [assigningDocId, setAssigningDocId] = useState(null);

  // A4 OCR Scanner Modal state
  const [showScanner, setShowScanner] = useState(false);
  const [scanImageFile, setScanImageFile] = useState(null);
  const [scanImagePreview, setScanImagePreview] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedMarkdown, setScannedMarkdown] = useState('');
  const [scannedTitle, setScannedTitle] = useState('');
  const [scannedTags, setScannedTags] = useState(['A4 Scan']);
  const [scannedTagDraft, setScannedTagDraft] = useState('');

  // Google Docs Import Modal state
  const [showGdocModal, setShowGdocModal] = useState(false);
  const [gdocUrl, setGdocUrl] = useState('');
  const [gdocFolderIds, setGdocFolderIds] = useState([]);
  const [gdocTags, setGdocTags] = useState(['Google Docs']);
  const [gdocTagDraft, setGdocTagDraft] = useState('');
  const [isImportingGdoc, setIsImportingGdoc] = useState(false);
  const [gdocError, setGdocError] = useState('');

  const uploadInputRef = useRef(null);
  const scanInputRef = useRef(null);

  const allTags = useMemo(() => {
    const set = new Set();
    documents.forEach((doc) => (doc.tags || []).forEach((tag) => set.add(tag)));
    folders.forEach((folder) => (folder.tags || []).forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [documents, folders]);

  const sortedDocs = useMemo(() => {
    return [...documents].sort(
      (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
    );
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedDocs.filter((doc) => {
      const matchesTag = !activeTagFilter || (doc.tags || []).includes(activeTagFilter);
      if (!matchesTag) return false;
      if (!q) return true;
      const inTitle = (doc.title || '').toLowerCase().includes(q);
      const inTags = (doc.tags || []).some((tag) => tag.toLowerCase().includes(q));
      return inTitle || inTags;
    });
  }, [sortedDocs, searchQuery, activeTagFilter]);

  const filteredFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...folders]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .filter((folder) => {
        const folderDocs = sortedDocs.filter((d) => (d.folderIds || []).includes(folder.id));
        const matchesTag =
          !activeTagFilter ||
          (folder.tags || []).includes(activeTagFilter) ||
          folderDocs.some((d) => (d.tags || []).includes(activeTagFilter));
        if (!matchesTag) return false;
        if (!q) return true;
        const inName = (folder.name || '').toLowerCase().includes(q);
        const inFolderTags = (folder.tags || []).some((tag) => tag.toLowerCase().includes(q));
        const inChildDocs = folderDocs.some(
          (d) =>
            (d.title || '').toLowerCase().includes(q) ||
            (d.tags || []).some((tag) => tag.toLowerCase().includes(q))
        );
        return inName || inFolderTags || inChildDocs;
      });
  }, [folders, sortedDocs, searchQuery, activeTagFilter]);

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

  const addTagToList = (draft, list, setList, setDraft) => {
    const clean = draft.trim();
    if (!clean) return;
    if (list.length >= MAX_TAGS) {
      onNotify(t.maxTagsReached, 'warning');
      return;
    }
    if (!list.includes(clean)) {
      setList([...list, clean]);
    }
    setDraft('');
  };

  // Plain text, Markdown, or Word (.docx) upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const now = Date.now();
    const isDocx =
      /\.docx$/i.test(file.name) ||
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isDocx) {
      try {
        const { title, content } = await convertDocxFileToMarkdown(file);
        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          title,
          tags: ['DOCX'],
          folderIds: [],
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
      folderIds: [],
      createdAt: now,
      updatedAt: now,
      content: normalizedContent,
    };
    onCreateDocument(newDoc, true);
  };

  // Google Docs Import Handlers
  const handleOpenGdocModal = () => {
    setGdocUrl('');
    setGdocFolderIds([]);
    setGdocTags(['Google Docs']);
    setGdocTagDraft('');
    setGdocError('');
    setShowGdocModal(true);
  };

  const toggleGdocTargetFolder = (folderId) => {
    setGdocFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const handleImportGdocSubmit = async (e) => {
    e.preventDefault();
    if (!gdocUrl.trim()) return;
    setIsImportingGdoc(true);
    setGdocError('');

    try {
      const { title, markdown } = await importGoogleDoc(gdocUrl.trim());
      const finalTags = [...gdocTags];
      if (
        gdocTagDraft.trim() &&
        finalTags.length < MAX_TAGS &&
        !finalTags.includes(gdocTagDraft.trim())
      ) {
        finalTags.push(gdocTagDraft.trim());
      }

      const now = Date.now();
      const newDoc = {
        id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
        title: title || t.untitledDoc,
        tags: finalTags.slice(0, MAX_TAGS),
        folderIds: [...gdocFolderIds],
        createdAt: now,
        updatedAt: now,
        content: markdown,
      };
      onCreateDocument(newDoc, true);
      setShowGdocModal(false);
      onNotify(t.gdocImportSuccess, 'success');
    } catch (err) {
      if (err.code === 'RESTRICTED_DOC') {
        setGdocError(t.gdocRestrictedError);
      } else {
        setGdocError(err.message || 'Failed to import Google Doc.');
      }
    } finally {
      setIsImportingGdoc(false);
    }
  };

  const handleNewNote = () => {
    const now = Date.now();
    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
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
    setFolderTagInput('');
    setFolderModalOpen(true);
  };

  const openEditFolder = (folder, e) => {
    e.stopPropagation();
    setEditingFolder(folder);
    setFolderNameDraft(folder.name || '');
    setFolderTagsDraft([...(folder.tags || [])].slice(0, MAX_TAGS));
    setFolderTagInput('');
    setFolderModalOpen(true);
  };

  const handleSaveFolder = (e) => {
    e.preventDefault();
    const cleanName = folderNameDraft.trim();
    if (!cleanName) return;
    const nextTags = [...folderTagsDraft];
    if (
      folderTagInput.trim() &&
      nextTags.length < MAX_TAGS &&
      !nextTags.includes(folderTagInput.trim())
    ) {
      nextTags.push(folderTagInput.trim());
    }

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
    setTagDraft('');
  };

  const handleSaveMeta = (e) => {
    e.preventDefault();
    if (!editingMetaDoc) return;
    const nextTags = [...metaTags];
    if (tagDraft.trim() && nextTags.length < MAX_TAGS && !nextTags.includes(tagDraft.trim())) {
      nextTags.push(tagDraft.trim());
    }
    onUpdateDocument({
      ...editingMetaDoc,
      title: metaTitle.trim() || t.untitledDoc,
      tags: nextTags.slice(0, MAX_TAGS),
      updatedAt: Date.now(),
    });
    setEditingMetaDoc(null);
  };

  // A4 OCR Scanner handlers
  const handleOpenScanner = () => {
    setScanImageFile(null);
    setScanImagePreview('');
    setScannedMarkdown('');
    setScannedTitle('');
    setScannedTags(['A4 Scan']);
    setScannedTagDraft('');
    setShowScanner(true);
  };

  const handleSelectScanImage = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setScanImageFile(file);
    setScannedMarkdown('');
    const url = URL.createObjectURL(file);
    setScanImagePreview(url);
  };

  const handleRunOCR = async () => {
    if (!scanImageFile) return;
    setIsScanning(true);
    try {
      const { data, mimeType } = await fileToBase64(scanImageFile);
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
        className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${rowPad} rounded-xl border transition cursor-pointer ${
          nested
            ? 'border-transparent hover:bg-[#EBEBE8]/70 dark:hover:bg-[#2E2E2E]'
            : isSelected
              ? 'border-[#D3D3CF] dark:border-[#3A3A3A] bg-[#F7F7F5] dark:bg-[#262626]'
              : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#191919] hover:bg-[#F1F1EF] dark:hover:bg-[#262626]'
        }`}
      >
        {/* Left: Icon + Title + Metadata */}
        <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
          <FileText
            className={`w-4 h-4 mt-1 sm:mt-0 shrink-0 ${
              nested
                ? 'text-[#787774] dark:text-[#9B9A97]'
                : 'text-indigo-600 dark:text-indigo-400'
            }`}
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-[15px] leading-snug text-[#2F2F2F] dark:text-[#E8E8E6] truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
              {doc.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-0.5 text-[13px] text-[#787774] dark:text-[#9B9A97]">
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(doc.createdAt)}
              </span>

              {!nested && assignedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-[#787774] dark:text-[#9B9A97]">
                  <Folder className="w-3 h-3" />
                  {t.inFoldersCount(assignedCount)}
                </span>
              )}

              <div className="flex flex-wrap items-center gap-1">
                {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F1F1EF] dark:bg-[#2C2C2C] text-[#555552] dark:text-[#C5C4C0] font-medium text-[12px]"
                  >
                    <Tag className="w-2.5 h-2.5 text-indigo-500" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Row Action Controls */}
        <div
          className="flex items-center gap-1 shrink-0 self-end sm:self-center opacity-85 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => setAssigningDocId(doc.id)}
            title={t.assignToFolders}
            className="min-h-[34px] px-2 rounded-lg text-[12px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:bg-[#E5E5E3]/70 dark:hover:bg-[#343434] inline-flex items-center gap-1 transition"
          >
            <FolderInput className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{t.assignToFolders}</span>
          </button>
          <button
            type="button"
            onClick={(e) => openMetaEditor(doc, e)}
            title={`${t.renameDoc} / ${t.editTags}`}
            className="p-2 rounded-lg text-[#787774] hover:text-[#2F2F2F] dark:hover:text-white hover:bg-[#E5E5E3]/70 dark:hover:bg-[#343434] transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteDocument(doc.id)}
            title={t.deleteDoc}
            className="p-2 rounded-lg text-[#787774] hover:text-rose-600 hover:bg-rose-500/10 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919]">
      {/* Top Workspace Header & Actions */}
      <div className="px-5 sm:px-8 pt-5 pb-3.5 border-b border-[#E5E5E3] dark:border-[#2F2F2F] shrink-0">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-bold text-xl tracking-tight text-[#2F2F2F] dark:text-[#E8E8E6]">
                {t.documentsTitle}
              </h1>
              <p className="text-[13px] text-[#787774] dark:text-[#9B9A97]">
                {t.folderCount(folders.length)} · {t.docCount(documents.length)} · Markdown + KaTeX
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* + New Folder */}
              <button
                type="button"
                onClick={openCreateFolder}
                className="min-h-[38px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center gap-1.5 transition"
              >
                <FolderPlus className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>{t.newFolder}</span>
              </button>

              {/* Import Google Doc */}
              <button
                type="button"
                onClick={handleOpenGdocModal}
                className="min-h-[38px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center gap-1.5 transition"
              >
                <Link2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>{t.importGdoc}</span>
              </button>

              {/* AI A4 OCR Scanner */}
              <button
                type="button"
                onClick={handleOpenScanner}
                className="min-h-[38px] px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shadow-xs transition"
              >
                <ScanLine className="w-4 h-4" />
                <span>{t.scanA4}</span>
              </button>

              {/* Upload .md / .txt / .docx */}
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                title=".md, .txt, .docx"
                className="min-h-[38px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center gap-1.5 transition"
              >
                <Upload className="w-4 h-4" />
                <span>{t.uploadFile}</span>
              </button>
              <input
                ref={uploadInputRef}
                type="file"
                accept=".md,.markdown,.txt,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* New Note */}
              <button
                type="button"
                onClick={handleNewNote}
                className="min-h-[38px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center gap-1.5 transition"
              >
                <FilePlus2 className="w-4 h-4" />
                <span>{t.newDoc}</span>
              </button>
            </div>
          </div>

          {/* Search & Tag Filter Strip */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#787774] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchDocsPlaceholder}
                className="w-full min-h-[38px] pl-9 pr-3.5 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] text-[14px] text-[#2F2F2F] dark:text-[#E8E8E6] placeholder:text-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            {allTags.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {allTags.map((tag) => {
                  const active = activeTagFilter === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setActiveTagFilter(active ? '' : tag)}
                      className={`min-h-[32px] px-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap border transition ${
                        active
                          ? 'bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] border-transparent'
                          : 'bg-[#F7F7F5] dark:bg-[#202020] border-[#E5E5E3] dark:border-[#2F2F2F] text-[#555552] dark:text-[#B5B4B0] hover:bg-[#F1F1EF] dark:hover:bg-[#262626]'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
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
              <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97] px-1">
                {t.foldersSectionLabel} ({filteredFolders.length})
              </h2>

              <div className="space-y-1.5">
                {filteredFolders.map((folder) => {
                  const isExpanded = expandedFolderIds.includes(folder.id);
                  const folderDocs = sortedDocs.filter((d) =>
                    (d.folderIds || []).includes(folder.id)
                  );

                  return (
                    <div
                      key={folder.id}
                      className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] overflow-hidden transition"
                    >
                      {/* Folder Accordion Header Row */}
                      <div
                        onClick={() => toggleFolderAccordion(folder.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleFolderAccordion(folder.id);
                          }
                        }}
                        className={`group flex items-center justify-between gap-2 ${rowPad} hover:bg-[#F1F1EF] dark:hover:bg-[#262626] cursor-pointer transition`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[#787774] dark:text-[#9B9A97] shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </span>
                          {isExpanded ? (
                            <FolderOpen className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <Folder className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                          )}
                          <span className="font-semibold text-[15px] text-[#2F2F2F] dark:text-[#E8E8E6] truncate">
                            {folder.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-[#EBEBE8] dark:bg-[#2C2C2C] text-[#787774] dark:text-[#9B9A97] text-[12px] font-medium shrink-0">
                            {folderDocs.length}
                          </span>

                          {/* Folder Tags (max 3) */}
                          <div className="hidden sm:flex flex-wrap items-center gap-1 ml-1">
                            {(folder.tags || []).slice(0, MAX_TAGS).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#343434] text-[#555552] dark:text-[#C5C4C0] text-[12px] font-medium"
                              >
                                <Tag className="w-2.5 h-2.5 text-amber-500" />
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Folder Actions */}
                        <div
                          className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => openEditFolder(folder, e)}
                            title={t.editFolder}
                            className="p-1.5 rounded-lg text-[#787774] hover:text-[#2F2F2F] dark:hover:text-white hover:bg-[#E5E5E3]/70 dark:hover:bg-[#343434]"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteFolder(folder.id)}
                            title={t.deleteFolder}
                            className="p-1.5 rounded-lg text-[#787774] hover:text-rose-600 hover:bg-rose-500/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Inline Documents */}
                      {isExpanded && (
                        <div className="border-t border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF]/65 dark:bg-[#1C1C1C] px-3 py-2 pl-7 space-y-1">
                          {folderDocs.length === 0 ? (
                            <p className="text-[13px] text-[#787774] dark:text-[#8E8D8A] py-2 px-1 italic">
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

          {/* 2. All Documents List */}
          <div className="space-y-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97] px-1">
              {t.allDocumentsSectionLabel} ({filteredDocs.length})
            </h2>

            {filteredDocs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#E5E5E3] dark:border-[#2F2F2F] p-10 text-center text-[#787774] dark:text-[#9B9A97]">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-[15px]">{t.noDocsFound}</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredDocs.map((doc) => renderDocumentRow(doc, false))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create / Edit Folder Modal */}
      {folderModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4">
            <div className="w-full max-w-md rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px]">
                  {editingFolder ? t.editFolder : t.createFolder}
                </h3>
                <button
                  type="button"
                  onClick={() => setFolderModalOpen(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveFolder} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                    {t.folderNameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={folderNameDraft}
                    onChange={(e) => setFolderNameDraft(e.target.value)}
                    placeholder={t.folderNamePlaceholder}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {t.editTags} ({folderTagsDraft.length}/{MAX_TAGS})
                    </label>
                    <span className="text-[12px] text-[#9B9A97]">{t.maxTagsHint}</span>
                  </div>

                  {folderTagsDraft.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {folderTagsDraft.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F1F1EF] dark:bg-[#323232] text-[13px] font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() =>
                              setFolderTagsDraft(folderTagsDraft.filter((x) => x !== tag))
                            }
                            className="hover:text-rose-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      disabled={folderTagsDraft.length >= MAX_TAGS}
                      value={folderTagInput}
                      onChange={(e) => setFolderTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTagToList(
                            folderTagInput,
                            folderTagsDraft,
                            setFolderTagsDraft,
                            setFolderTagInput
                          );
                        }
                      }}
                      placeholder={
                        folderTagsDraft.length >= MAX_TAGS
                          ? t.maxTagsReached
                          : t.addTagPlaceholder
                      }
                      className="flex-1 min-h-[40px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13px] disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={folderTagsDraft.length >= MAX_TAGS || !folderTagInput.trim()}
                      onClick={() =>
                        addTagToList(
                          folderTagInput,
                          folderTagsDraft,
                          setFolderTagsDraft,
                          setFolderTagInput
                        )
                      }
                      className="px-3.5 rounded-xl bg-[#F1F1EF] dark:bg-[#323232] text-[14px] font-semibold disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setFolderModalOpen(false)}
                    className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-xl bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] text-[14px] font-semibold inline-flex items-center gap-1.5"
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => setAssigningDocId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[16px]">{t.assignToFolders}</h3>
                  <p className="text-[13px] text-[#787774] dark:text-[#9B9A97] truncate">
                    {assigningDoc.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssigningDocId(null)}
                  className="p-1.5 rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {folders.length === 0 ? (
                <p className="text-[14px] text-[#787774] dark:text-[#9B9A97] py-4 text-center">
                  {t.noFoldersCreated}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                  {folders.map((folder) => {
                    const isChecked = (assigningDoc.folderIds || []).includes(folder.id);
                    return (
                      <label
                        key={folder.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${
                          isChecked
                            ? 'border-indigo-500/50 bg-indigo-500/5'
                            : 'border-[#E5E5E3] dark:border-[#343434] hover:bg-[#F7F7F5] dark:hover:bg-[#2F2F2F]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleDocFolder(assigningDoc.id, folder.id)}
                            className="w-4 h-4 rounded border-[#BDBCB8] text-indigo-600 focus:ring-indigo-500 shrink-0"
                          />
                          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-[14px] font-medium truncate">{folder.name}</span>
                        </div>
                        {(folder.tags || []).length > 0 && (
                          <span className="text-[12px] text-[#787774] truncate max-w-[35%]">
                            #{folder.tags[0]}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-[#E5E5E3] dark:border-[#2F2F2F]">
                <button
                  type="button"
                  onClick={() => {
                    setAssigningDocId(null);
                    openCreateFolder();
                  }}
                  className="text-[13px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>{t.newFolder}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAssigningDocId(null)}
                  className="min-h-[38px] px-4 rounded-xl bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] text-[13px] font-semibold"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4">
            <div className="w-full max-w-md rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px]">
                  {t.renameDoc} & {t.editTags}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingMetaDoc(null)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveMeta} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                    {t.docTitlePlaceholder}
                  </label>
                  <input
                    type="text"
                    required
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {t.editTags} ({metaTags.length}/{MAX_TAGS})
                    </label>
                    <span className="text-[12px] text-[#9B9A97]">{t.maxTagsHint}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {metaTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F1F1EF] dark:bg-[#323232] text-[13px] font-medium"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setMetaTags(metaTags.filter((x) => x !== tag))}
                          className="hover:text-rose-500"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      disabled={metaTags.length >= MAX_TAGS}
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTagToList(tagDraft, metaTags, setMetaTags, setTagDraft);
                        }
                      }}
                      placeholder={
                        metaTags.length >= MAX_TAGS ? t.maxTagsReached : t.addTagPlaceholder
                      }
                      className="flex-1 min-h-[40px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13px] disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={metaTags.length >= MAX_TAGS || !tagDraft.trim()}
                      onClick={() => addTagToList(tagDraft, metaTags, setMetaTags, setTagDraft)}
                      className="px-3.5 rounded-xl bg-[#F1F1EF] dark:bg-[#323232] font-semibold text-[14px] disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditingMetaDoc(null)}
                    className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-xl bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] text-[14px] font-semibold inline-flex items-center gap-1.5"
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

      {/* Import Google Doc Modal */}
      {showGdocModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => !isImportingGdoc && setShowGdocModal(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                    <Link2 className="w-4 h-4" />
                  </div>
                  <h3 className="font-semibold text-[16px]">{t.gdocModalTitle}</h3>
                </div>
                <button
                  type="button"
                  disabled={isImportingGdoc}
                  onClick={() => setShowGdocModal(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[13px] text-[#787774] dark:text-[#9B9A97] mb-4 leading-relaxed">
                {t.gdocModalDesc}
              </p>

              <form onSubmit={handleImportGdocSubmit} className="space-y-4">
                {/* Google Docs URL */}
                <div>
                  <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                    {t.gdocUrlLabel}
                  </label>
                  <input
                    type="url"
                    required
                    autoFocus
                    value={gdocUrl}
                    onChange={(e) => {
                      setGdocUrl(e.target.value);
                      if (gdocError) setGdocError('');
                    }}
                    placeholder={t.gdocUrlPlaceholder}
                    className="w-full min-h-[42px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[14px] focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>

                {/* Inline Error Alert (e.g. Restricted Google Doc) */}
                {gdocError && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2.5 text-[13px] text-rose-700 dark:text-rose-300">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="leading-snug">{gdocError}</span>
                  </div>
                )}

                {/* Optional Target Folders (Many-to-Many) */}
                {folders.length > 0 && (
                  <div>
                    <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                      {t.gdocTargetFoldersLabel}
                    </label>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                      {folders.map((folder) => {
                        const checked = gdocFolderIds.includes(folder.id);
                        return (
                          <label
                            key={folder.id}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-[14px] cursor-pointer transition ${
                              checked
                                ? 'border-indigo-500/50 bg-indigo-500/5'
                                : 'border-[#E5E5E3] dark:border-[#343434] hover:bg-[#F7F7F5] dark:hover:bg-[#2F2F2F]'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGdocTargetFolder(folder.id)}
                              className="w-4 h-4 rounded border-[#BDBCB8] text-indigo-600 focus:ring-indigo-500 shrink-0"
                            />
                            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                            <span className="truncate font-medium">{folder.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Optional Tags (Max 3) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {t.editTags} ({gdocTags.length}/{MAX_TAGS})
                    </label>
                    <span className="text-[12px] text-[#9B9A97]">{t.maxTagsHint}</span>
                  </div>

                  {gdocTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {gdocTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F1F1EF] dark:bg-[#323232] text-[13px] font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => setGdocTags(gdocTags.filter((x) => x !== tag))}
                            className="hover:text-rose-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      disabled={gdocTags.length >= MAX_TAGS}
                      value={gdocTagDraft}
                      onChange={(e) => setGdocTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTagToList(gdocTagDraft, gdocTags, setGdocTags, setGdocTagDraft);
                        }
                      }}
                      placeholder={
                        gdocTags.length >= MAX_TAGS ? t.maxTagsReached : t.addTagPlaceholder
                      }
                      className="flex-1 min-h-[38px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13px] disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={gdocTags.length >= MAX_TAGS || !gdocTagDraft.trim()}
                      onClick={() =>
                        addTagToList(gdocTagDraft, gdocTags, setGdocTags, setGdocTagDraft)
                      }
                      className="px-3.5 rounded-xl bg-[#F1F1EF] dark:bg-[#323232] font-semibold text-[14px] disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={isImportingGdoc}
                    onClick={() => setShowGdocModal(false)}
                    className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={isImportingGdoc || !gdocUrl.trim()}
                    className="min-h-[40px] px-5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[14px] font-semibold inline-flex items-center gap-2"
                  >
                    {isImportingGdoc ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4" />
                    )}
                    <span>{isImportingGdoc ? t.gdocImporting : t.gdocImportSubmit}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* AI A4 Document OCR Scanner Modal */}
      {showScanner &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4">
            <div className="w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E3] dark:border-[#2F2F2F] shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <ScanLine className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[16px]">{t.scannerTitle}</h3>
                    <p className="text-[12px] text-[#787774] dark:text-[#9B9A97]">
                      Gemini Vision → Markdown + KaTeX
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowScanner(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
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
                    className="border-2 border-dashed border-[#D3D3CF] dark:border-[#3A3A3A] hover:border-indigo-500 rounded-2xl p-10 text-center cursor-pointer transition bg-[#F7F7F5] dark:bg-[#202020]"
                  >
                    <Camera className="w-10 h-10 mx-auto text-indigo-500 mb-3" />
                    <p className="text-[15px] font-medium">{t.dropImagePrompt}</p>
                    <span className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[13px] font-semibold">
                      <Upload className="w-4 h-4" />
                      {t.captureCamera}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2.5">
                      <div className="rounded-xl overflow-hidden border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#191919] max-h-[340px] flex items-center justify-center">
                        <img
                          src={scanImagePreview}
                          alt="A4 Page Preview"
                          className="max-h-[340px] object-contain"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => scanInputRef.current?.click()}
                          className="min-h-[40px] flex-1 px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[13px] font-medium"
                        >
                          {t.retakeImage}
                        </button>
                        <button
                          type="button"
                          disabled={isScanning}
                          onClick={handleRunOCR}
                          className="min-h-[40px] flex-1 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-[13px] font-semibold inline-flex items-center justify-center gap-2"
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
                            className="w-full min-h-[40px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] font-semibold"
                          />

                          <div>
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {scannedTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[12px] font-medium"
                                >
                                  {tag}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setScannedTags(scannedTags.filter((x) => x !== tag))
                                    }
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            {scannedTags.length < MAX_TAGS && (
                              <input
                                type="text"
                                value={scannedTagDraft}
                                onChange={(e) => setScannedTagDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addTagToList(
                                      scannedTagDraft,
                                      scannedTags,
                                      setScannedTags,
                                      setScannedTagDraft
                                    );
                                  }
                                }}
                                placeholder={`${t.addTagPlaceholder} (${scannedTags.length}/${MAX_TAGS})`}
                                className="w-full min-h-[36px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[12px]"
                              />
                            )}
                          </div>

                          <div className="flex-1 max-h-[240px] overflow-y-auto rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#191919] p-3.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#787774] mb-2">
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
                        <div className="flex-1 rounded-xl border border-dashed border-[#E5E5E3] dark:border-[#343434] flex flex-col items-center justify-center p-6 text-center text-[#787774]">
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
                <div className="px-5 py-3.5 border-t border-[#E5E5E3] dark:border-[#2F2F2F] flex justify-end gap-2 shrink-0 bg-[#F7F7F5] dark:bg-[#202020]">
                  <button
                    type="button"
                    onClick={() => setShowScanner(false)}
                    className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveScannedDocument}
                    className="min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold"
                  >
                    {t.saveScannedDoc}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

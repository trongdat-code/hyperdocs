import React, { useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import {
  FileText,
  ScanLine,
  Upload,
  FilePlus2,
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
} from 'lucide-react';
import { fileToBase64, scanA4Document } from '../../services/geminiService';

const MAX_TAGS = 3;

export default function DocumentList({
  documents,
  selectedDocId,
  onOpenDocument,
  onCreateDocument,
  onUpdateDocument,
  onDeleteDocument,
  onNotify,
  t,
  lang,
  density,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTagFilter, setActiveTagFilter] = useState('');

  // Inline rename / tag editing modal
  const [editingMetaDoc, setEditingMetaDoc] = useState(null);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaTags, setMetaTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');

  // A4 OCR Scanner Modal state
  const [showScanner, setShowScanner] = useState(false);
  const [scanImageFile, setScanImageFile] = useState(null);
  const [scanImagePreview, setScanImagePreview] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedMarkdown, setScannedMarkdown] = useState('');
  const [scannedTitle, setScannedTitle] = useState('');
  const [scannedTags, setScannedTags] = useState(['A4 Scan']);
  const [scannedTagDraft, setScannedTagDraft] = useState('');

  const uploadInputRef = useRef(null);
  const scanInputRef = useRef(null);

  const allTags = useMemo(() => {
    const set = new Set();
    documents.forEach((doc) => (doc.tags || []).forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...documents]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .filter((doc) => {
        const matchesTag = !activeTagFilter || (doc.tags || []).includes(activeTagFilter);
        if (!matchesTag) return false;
        if (!q) return true;
        const inTitle = (doc.title || '').toLowerCase().includes(q);
        const inTags = (doc.tags || []).some((tag) => tag.toLowerCase().includes(q));
        return inTitle || inTags;
      });
  }, [documents, searchQuery, activeTagFilter]);

  const formatDate = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Plain text / Markdown upload -> auto-convert to rich Markdown + KaTeX document
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const text = await file.text();
    const baseName = file.name.replace(/\.(md|markdown|txt)$/i, '').trim() || t.untitledDoc;
    const isPlainText = /\.txt$/i.test(file.name);
    const normalizedContent = isPlainText && !text.trim().startsWith('#')
      ? `# ${baseName}\n\n${text}`
      : text;

    const now = Date.now();
    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: baseName,
      tags: [isPlainText ? 'Text' : 'Markdown'],
      createdAt: now,
      updatedAt: now,
      content: normalizedContent,
    };
    onCreateDocument(newDoc, true);
  };

  const handleNewNote = () => {
    const now = Date.now();
    const newDoc = {
      id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
      title: t.untitledDoc,
      tags: ['Notes'],
      createdAt: now,
      updatedAt: now,
      content: `# ${t.untitledDoc}\n\nStart writing notes with **Markdown** and **KaTeX** equations:\n\n$$E = mc^2$$\n`,
    };
    onCreateDocument(newDoc, true, true);
  };

  // Metadata (rename + max-3 tags) modal helpers
  const openMetaEditor = (doc, e) => {
    e.stopPropagation();
    setEditingMetaDoc(doc);
    setMetaTitle(doc.title || '');
    setMetaTags([...(doc.tags || [])].slice(0, MAX_TAGS));
    setTagDraft('');
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
      createdAt: now,
      updatedAt: now,
      content: scannedMarkdown,
    };
    onCreateDocument(newDoc, true);
    setShowScanner(false);
  };

  const rowPad = density === 'compact' ? 'px-3.5 py-2.5' : 'px-4 py-3.5';

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50/50 dark:bg-[#09090B]">
      {/* Top Hub Header & Action Toolbar */}
      <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-xl leading-tight text-slate-900 dark:text-white">
                {t.documentsTitle}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.docCount(documents.length)} • Markdown + KaTeX
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* AI A4 OCR Scanner Button */}
            <button
              type="button"
              onClick={handleOpenScanner}
              className="min-h-[44px] px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-sm transition active:scale-[0.98]"
            >
              <ScanLine className="w-4 h-4" />
              <span>{t.scanA4}</span>
            </button>

            {/* Upload .md / .txt */}
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-semibold inline-flex items-center gap-2 transition"
            >
              <Upload className="w-4 h-4" />
              <span>{t.uploadFile}</span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/plain,text/markdown"
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* New Markdown Note */}
            <button
              type="button"
              onClick={handleNewNote}
              className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-semibold inline-flex items-center gap-2 transition"
            >
              <FilePlus2 className="w-4 h-4" />
              <span>{t.newDoc}</span>
            </button>
          </div>
        </div>

        {/* Search & Tag Filter Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchDocsPlaceholder}
              className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                    className={`min-h-[36px] px-3 rounded-full text-xs font-semibold whitespace-nowrap border transition ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
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

      {/* Horizontal Row Layout Document List */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5 min-h-0">
        {filteredDocs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center text-slate-500 dark:text-slate-400">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-[17px]">{t.noDocsFound}</p>
          </div>
        ) : (
          filteredDocs.map((doc) => {
            const isSelected = doc.id === selectedDocId;
            return (
              <div
                key={doc.id}
                onClick={() => onOpenDocument(doc.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenDocument(doc.id);
                  }
                }}
                className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${rowPad} rounded-2xl border bg-white dark:bg-[#0F172A] cursor-pointer transition shadow-sm hover:shadow-md ${
                  isSelected
                    ? 'border-indigo-500 ring-1 ring-indigo-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600'
                }`}
              >
                {/* Left: Icon + Title + Date */}
                <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-[17px] text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                      {doc.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(doc.createdAt)}
                      </span>
                      {/* Tag Badges (max 3) */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-xs"
                          >
                            <Tag className="w-3 h-3 text-indigo-500" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Row Action Controls */}
                <div
                  className="flex items-center gap-1 shrink-0 self-end sm:self-center"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => openMetaEditor(doc, e)}
                    title={`${t.renameDoc} / ${t.editTags}`}
                    className="touch-target inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDocument(doc.id)}
                    title={t.deleteDoc}
                    className="touch-target inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rename & Max-3 Tags Modal */}
      {editingMetaDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[19px] text-slate-900 dark:text-slate-100">
                {t.renameDoc} & {t.editTags}
              </h3>
              <button
                type="button"
                onClick={() => setEditingMetaDoc(null)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMeta} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.docTitlePlaceholder}
                </label>
                <input
                  type="text"
                  required
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t.editTags} ({metaTags.length}/{MAX_TAGS})
                  </label>
                  <span className="text-xs text-slate-400">{t.maxTagsHint}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {metaTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-sm font-medium"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => setMetaTags(metaTags.filter((x) => x !== tag))}
                        className="hover:text-rose-500"
                      >
                        <X className="w-3.5 h-3.5" />
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
                    className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={metaTags.length >= MAX_TAGS || !tagDraft.trim()}
                    onClick={() => addTagToList(tagDraft, metaTags, setMetaTags, setTagDraft)}
                    className="touch-target px-3.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-sm disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMetaDoc(null)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.save}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI A4 Document OCR Scanner Modal */}
      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <ScanLine className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-[18px] text-slate-900 dark:text-slate-100">
                    {t.scannerTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gemini Vision → Markdown + KaTeX
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScanner(false)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">{t.scannerDesc}</p>

              {/* Upload / Dropzone */}
              {!scanImagePreview ? (
                <div
                  onClick={() => scanInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSelectScanImage(e.dataTransfer.files?.[0]);
                  }}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 rounded-2xl p-10 text-center cursor-pointer transition bg-slate-50/70 dark:bg-slate-900/40"
                >
                  <Camera className="w-12 h-12 mx-auto text-indigo-500 mb-3" />
                  <p className="text-[17px] font-medium text-slate-700 dark:text-slate-200">
                    {t.dropImagePrompt}
                  </p>
                  <span className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold">
                    <Upload className="w-4 h-4" />
                    {t.captureCamera}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Image Preview */}
                  <div className="space-y-2.5">
                    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 max-h-[340px] flex items-center justify-center">
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
                        className="min-h-[44px] flex-1 px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                      >
                        {t.retakeImage}
                      </button>
                      <button
                        type="button"
                        disabled={isScanning}
                        onClick={handleRunOCR}
                        className="min-h-[44px] flex-1 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2"
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

                  {/* Extracted Preview + Metadata */}
                  <div className="flex flex-col space-y-3 min-h-[260px]">
                    {scannedMarkdown ? (
                      <>
                        <input
                          type="text"
                          value={scannedTitle}
                          onChange={(e) => setScannedTitle(e.target.value)}
                          placeholder={t.docTitlePlaceholder}
                          className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] font-semibold"
                        />

                        {/* Up to 3 Tags */}
                        <div>
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {scannedTags.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-semibold"
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
                              className="w-full min-h-[38px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                            />
                          )}
                        </div>

                        <div className="flex-1 max-h-[240px] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
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
                      <div className="flex-1 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center p-6 text-center text-slate-400">
                        {isScanning ? (
                          <>
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                            <p className="text-sm">{t.scanningImage}</p>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">{t.scanAndExtract}</p>
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

            {/* Footer */}
            {scannedMarkdown && (
              <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 shrink-0 bg-slate-50 dark:bg-slate-900/40">
                <button
                  type="button"
                  onClick={() => setShowScanner(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSaveScannedDocument}
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm"
                >
                  {t.saveScannedDoc}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

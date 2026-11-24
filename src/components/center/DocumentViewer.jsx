import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
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
} from 'lucide-react';

const MAX_TAGS = 3;

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [draftTitle, setDraftTitle] = useState(doc.title || '');
  const [draftContent, setDraftContent] = useState(doc.content || '');
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    setDraftTitle(doc.title || '');
    setDraftContent(doc.content || '');
  }, [doc.id, doc.title, doc.content]);

  useEffect(() => {
    setIsEditing(initialEditMode);
  }, [initialEditMode, doc.id]);

  // Escape exits fullscreen reader
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const handleSaveEdits = () => {
    onUpdateDocument({
      ...doc,
      title: draftTitle.trim() || t.untitledDoc,
      content: draftContent,
      updatedAt: Date.now(),
    });
    setIsEditing(false);
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
    if (isEditing) {
      handleSaveEdits();
      setTimeout(() => window.print(), 120);
    } else {
      window.print();
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const formattedDate = new Date(doc.updatedAt || doc.createdAt || Date.now()).toLocaleDateString(
    lang === 'vi' ? 'vi-VN' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-white dark:bg-[#09090B] ${
        isFullscreen ? 'fixed inset-0 z-40' : ''
      }`}
    >
      {/* Top Reader Toolbar (hidden when printing) */}
      <div className="no-print px-3 sm:px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0F172A]/95 backdrop-blur flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Left: Back button */}
        <button
          type="button"
          onClick={() => {
            if (isEditing) handleSaveEdits();
            setIsFullscreen(false);
            onBack();
          }}
          className="min-h-[44px] px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold inline-flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">{t.backToList}</span>
        </button>

        {/* Center/Right: Viewport & Export Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Edit / Preview Toggle */}
          <button
            type="button"
            onClick={() => (isEditing ? handleSaveEdits() : setIsEditing(true))}
            className={`min-h-[44px] px-3 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 border transition ${
              isEditing
                ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isEditing ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
            <span className="hidden md:inline">
              {isEditing ? t.previewMarkdown : t.editMarkdown}
            </span>
          </button>

          {/* Zoom Controls */}
          <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(75, z - 10))}
              title={t.zoomOut}
              className="touch-target inline-flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              title={t.resetZoom}
              className="min-h-[44px] px-2 text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(175, z + 10))}
              title={t.zoomIn}
              className="touch-target inline-flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? t.exitFullscreen : t.fullscreen}
            className="touch-target inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Share */}
          <button
            type="button"
            onClick={handleShare}
            title={t.shareDoc}
            className="touch-target sm:px-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold transition"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden xl:inline">{t.shareDoc}</span>
          </button>

          {/* Export PDF / Print */}
          <button
            type="button"
            onClick={handleExportPdf}
            title={t.exportPdf}
            className="min-h-[44px] px-3.5 inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm transition"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">{t.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* Document Body (Printable A4 container) */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-10 py-6 min-h-0">
        <article
          className="print-only-document mx-auto max-w-4xl transition-all duration-150"
          style={{ fontSize: `${(17 * zoom) / 100}px` }}
        >
          {/* Metadata Header */}
          <header className="mb-6 pb-4 border-b border-slate-200 dark:border-slate-800">
            {isEditing ? (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t.docTitlePlaceholder}
                className="w-full px-3 py-2 rounded-xl border border-indigo-400 bg-white dark:bg-slate-900 text-2xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                {doc.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {t.updatedLabel}: {formattedDate}
              </span>
              <span className="no-print">•</span>

              {/* Tag badges (max 3) */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(doc.tags || []).slice(0, MAX_TAGS).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold"
                  >
                    <Tag className="w-3 h-3" />
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
                    className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 text-slate-500 hover:text-indigo-600 transition"
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
                      className="w-32 px-2 py-0.5 rounded-md border border-indigo-400 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none"
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
                      className="p-1 rounded text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          </header>

          {/* Editor or Rendered Markdown + KaTeX */}
          {isEditing ? (
            <div className="space-y-3 no-print">
              <textarea
                rows={18}
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={t.markdownPlaceholder}
                className="w-full p-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-[15px] leading-relaxed text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftTitle(doc.title || '');
                    setDraftContent(doc.content || '');
                    setIsEditing(false);
                  }}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>{t.cancel}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{t.save}</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              className="study-markdown text-slate-800 dark:text-slate-100"
              style={{ fontSize: 'inherit' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {doc.content || ''}
              </ReactMarkdown>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

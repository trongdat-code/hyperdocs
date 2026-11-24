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

  const formattedDate = new Date(doc.updatedAt || doc.createdAt || Date.now()).toLocaleDateString(
    lang === 'vi' ? 'vi-VN' : 'en-US',
    { year: 'numeric', month: 'short', day: 'numeric' }
  );

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919] ${
        isFullscreen ? 'fixed inset-0 z-40' : ''
      }`}
    >
      {/* Top Reader Toolbar */}
      <div className="no-print px-4 sm:px-6 py-2.5 border-b border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF]/95 dark:bg-[#191919]/95 backdrop-blur flex flex-wrap items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            if (isEditing) handleSaveEdits();
            setIsFullscreen(false);
            onBack();
          }}
          className="min-h-[38px] px-3 rounded-lg hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[#555552] dark:text-[#C5C4C0] text-[14px] font-medium inline-flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">{t.backToList}</span>
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Edit / Read Toggle */}
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

          {/* Zoom Controls */}
          <div className="inline-flex items-center rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(75, z - 10))}
              title={t.zoomOut}
              className="h-[36px] w-[36px] inline-flex items-center justify-center hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] transition"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              title={t.resetZoom}
              className="h-[36px] px-2 text-[12px] font-semibold tabular-nums hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] transition"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(175, z + 10))}
              title={t.zoomIn}
              className="h-[36px] w-[36px] inline-flex items-center justify-center hover:bg-[#EBEBE8] dark:hover:bg-[#2F2F2F] transition"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? t.exitFullscreen : t.fullscreen}
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
            className="h-[36px] px-3 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[13px] font-medium transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t.shareDoc}</span>
          </button>

          {/* Export PDF / Print */}
          <button
            type="button"
            onClick={handleExportPdf}
            title={t.exportPdf}
            className="h-[36px] px-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2F2F2F] hover:bg-[#191919] dark:bg-[#E8E8E6] dark:hover:bg-white text-white dark:text-[#191919] text-[13px] font-semibold transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* Document Body (Printable A4 container) */}
      <div className="flex-1 overflow-y-auto px-5 sm:px-10 lg:px-14 py-7 min-h-0">
        <article
          className="print-only-document mx-auto max-w-3xl transition-all duration-150"
          style={{ fontSize: `${(15 * zoom) / 100}px` }}
        >
          <header className="mb-6 pb-4 border-b border-[#E5E5E3] dark:border-[#2F2F2F]">
            {isEditing ? (
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={t.docTitlePlaceholder}
                className="w-full px-3 py-2 rounded-xl border border-indigo-400 bg-[#FFFFFF] dark:bg-[#202020] text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#2F2F2F] dark:text-[#E8E8E6]">
                {doc.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px] text-[#787774] dark:text-[#9B9A97]">
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
                rows={18}
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder={t.markdownPlaceholder}
                className="w-full p-4 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] font-mono text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
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
                  type="submit"
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

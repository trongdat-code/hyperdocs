import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Link2,
  FileText,
  Folder,
  X,
  Loader2,
  AlertCircle,
  Eye,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import {
  cleanPdfTitle,
  derivePdfTitleFromUrl,
  fetchPdfFileFromUrl,
  importGoogleDoc,
  importPdfFile,
  normalizePdfUrl,
} from '../services/importService';

const MAX_TAGS = 3;

/**
 * Auto-detect link type from pasted URL:
 * - Google Docs (`docs.google.com/document/...`) -> 'gdoc'
 * - Google Drive file (`drive.google.com/file/d/...`, `open?id=`, `uc?id=`) -> 'pdf'
 * - Direct `.pdf` URL (including query string/hash) -> 'pdf'
 * - Otherwise -> null (user can choose manually via the compact switcher)
 */
export function detectLinkType(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;

  if (/docs\.google\.com\/document\//i.test(trimmed)) {
    return 'gdoc';
  }

  if (
    /drive\.google\.com\/file\/(?:u\/\d+\/)?d\//i.test(trimmed) ||
    /drive\.google\.com\/(?:open|uc)\?.*?(?:^|[?&])id=/i.test(trimmed)
  ) {
    return 'pdf';
  }

  try {
    const parsed = new URL(trimmed);
    if (/\.pdf$/i.test(parsed.pathname)) {
      return 'pdf';
    }
  } catch {
    if (/\.pdf(?:$|[?#])/i.test(trimmed)) {
      return 'pdf';
    }
  }

  return null;
}

export default function ImportModal({
  isOpen,
  folders,
  onClose,
  onCreateDocument,
  onNotify,
  t,
  lang,
}) {
  // Unified URL input + auto-detection with optional manual override
  const [linkUrl, setLinkUrl] = useState('');
  const [manualTypeOverride, setManualTypeOverride] = useState(null); // null | 'gdoc' | 'pdf'

  // PDF-specific options (shown when effectiveType === 'pdf')
  const [pdfImportMode, setPdfImportMode] = useState('embed'); // 'embed' | 'extract'
  const [pdfTitleOverride, setPdfTitleOverride] = useState('');

  // Shared metadata & submission state
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagsCustomized, setTagsCustomized] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [autoSanitizeKatex, setAutoSanitizeKatex] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Reset modal state on open
  useEffect(() => {
    if (!isOpen) return;
    setLinkUrl('');
    setManualTypeOverride(null);
    setPdfImportMode('embed');
    setPdfTitleOverride('');
    setSelectedFolderIds([]);
    setTags([]);
    setTagsCustomized(false);
    setTagDraft('');
    setAutoSanitizeKatex(true);
    setIsSubmitting(false);
    setStatusMessage('');
    setErrorMsg('');
  }, [isOpen]);

  const detectedType = useMemo(() => detectLinkType(linkUrl), [linkUrl]);
  const effectiveType = manualTypeOverride || detectedType;

  // Detect Google Drive link info when URL points to Google Drive
  const detectedDriveInfo = useMemo(() => {
    if (!linkUrl.trim()) return null;
    try {
      const info = normalizePdfUrl(linkUrl);
      return info.isGoogleDrive ? info : null;
    } catch {
      return null;
    }
  }, [linkUrl]);

  // Keep default tag synced with detected/selected link type unless user edited tags
  useEffect(() => {
    if (tagsCustomized) return;
    if (effectiveType === 'gdoc') {
      setTags(['Google Docs']);
    } else if (effectiveType === 'pdf') {
      setTags(['PDF']);
    } else {
      setTags([]);
    }
  }, [effectiveType, tagsCustomized]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleUrlChange = (nextVal) => {
    setLinkUrl(nextVal);
    if (errorMsg) setErrorMsg('');
    // If the user clears the input or pastes a URL that clearly matches a type, reset manual override
    if (!nextVal.trim()) {
      setManualTypeOverride(null);
    } else if (manualTypeOverride && detectLinkType(nextVal) === manualTypeOverride) {
      setManualTypeOverride(null);
    }
  };

  const handleManualTypeSelect = (nextType) => {
    if (isSubmitting) return;
    setManualTypeOverride(nextType);
    setErrorMsg('');
  };

  const toggleTargetFolder = (folderId) => {
    setSelectedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  };

  const addTag = () => {
    const clean = tagDraft.trim();
    if (!clean) return;
    if (tags.length >= MAX_TAGS) {
      onNotify(t.maxTagsReached, 'warning');
      return;
    }
    if (!tags.includes(clean)) {
      setTags([...tags, clean]);
      setTagsCustomized(true);
    }
    setTagDraft('');
  };

  const removeTag = (tagToRemove) => {
    setTags((prev) => prev.filter((x) => x !== tagToRemove));
    setTagsCustomized(true);
  };

  const getFinalTags = () => {
    const next = [...tags];
    if (tagDraft.trim() && next.length < MAX_TAGS && !next.includes(tagDraft.trim())) {
      next.push(tagDraft.trim());
    }
    return next.slice(0, MAX_TAGS);
  };

  const handleSubmitGdoc = async (trimmedUrl) => {
    setIsSubmitting(true);
    setErrorMsg('');
    setStatusMessage(t.gdocImporting);

    try {
      const { title, markdown } = await importGoogleDoc(trimmedUrl, {
        sanitizeKatex: autoSanitizeKatex,
      });

      const now = Date.now();
      const newDoc = {
        id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
        docType: 'imported-gdoc',
        title: title || t.untitledDoc,
        tags: getFinalTags(),
        folderIds: [...selectedFolderIds],
        createdAt: now,
        updatedAt: now,
        content: markdown,
      };
      onCreateDocument(newDoc, true);
      onClose();
      onNotify(t.gdocImportSuccess, 'success');
    } catch (err) {
      if (err.code === 'RESTRICTED_DOC') {
        setErrorMsg(t.gdocRestrictedError);
      } else {
        setErrorMsg(err.message || 'Failed to import Google Doc.');
      }
    } finally {
      setIsSubmitting(false);
      setStatusMessage('');
    }
  };

  const handleSubmitPdfUrl = async (trimmedUrl) => {
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const now = Date.now();
      const finalTags = getFinalTags();

      if (pdfImportMode === 'embed') {
        const info = normalizePdfUrl(trimmedUrl);
        setStatusMessage(t.pdfFetchingUrl);
        let resolvedTitle =
          cleanPdfTitle(pdfTitleOverride.trim(), '') ||
          derivePdfTitleFromUrl(info.originalUrl, t.untitledDoc);

        try {
          const fetched = await fetchPdfFileFromUrl(info.originalUrl);
          if (!pdfTitleOverride.trim() && fetched.title) {
            resolvedTitle = cleanPdfTitle(fetched.title, resolvedTitle);
          }
        } catch (err) {
          if (err.code === 'RESTRICTED_PDF') {
            setErrorMsg(t.pdfRestrictedError);
            setIsSubmitting(false);
            setStatusMessage('');
            return;
          }
          if (err.code === 'NOT_A_PDF') {
            setErrorMsg(err.message);
            setIsSubmitting(false);
            setStatusMessage('');
            return;
          }
        }

        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          docType: 'pdf-embed',
          title: resolvedTitle,
          tags: finalTags,
          folderIds: [...selectedFolderIds],
          pdfUrl: info.downloadUrl,
          pdfOriginalUrl: info.originalUrl,
          pdfPreviewUrl: info.previewUrl,
          pdfDriveId: info.driveFileId,
          createdAt: now,
          updatedAt: now,
          content: `# ${resolvedTitle}\n\n[Open Original PDF](${info.originalUrl})\n`,
        };
        onCreateDocument(newDoc, true);
        onClose();
        onNotify(t.pdfEmbedSuccess, 'success');
        return;
      }

      // Extract to Editable Markdown + KaTeX
      let fallbackTitle = cleanPdfTitle(pdfTitleOverride.trim(), '');
      setStatusMessage(t.pdfFetchingUrl);
      const fetched = await fetchPdfFileFromUrl(trimmedUrl);
      const fileToExtract = fetched.file;
      if (!fallbackTitle) fallbackTitle = cleanPdfTitle(fetched.title, '');

      const sourceMeta = {
        pdfUrl: fetched.downloadUrl,
        pdfOriginalUrl: fetched.originalUrl,
        pdfPreviewUrl: fetched.previewUrl,
      };

      const { title, content, method } = await importPdfFile(fileToExtract, {
        language: lang,
        sanitizeKatex: autoSanitizeKatex,
        onProgress: (progress) => {
          if (!progress) return;
          if (progress.stage === 'ai') {
            setStatusMessage(t.pdfConvertingAi);
          } else if (progress.stage === 'ocr') {
            setStatusMessage(
              t.pdfOcrPageProgress(
                progress.currentPage,
                progress.endPage || progress.currentPage,
                progress.totalPages
              )
            );
          } else if (progress.stage === 'local' && progress.totalPages) {
            setStatusMessage(
              t.pdfExtractingPageProgress(progress.currentPage, progress.totalPages)
            );
          } else {
            setStatusMessage(t.pdfExtractingLocal);
          }
        },
      });

      const resolvedTitle = fallbackTitle || cleanPdfTitle(title, t.untitledDoc);
      const newDoc = {
        id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
        docType: 'imported-pdf',
        title: resolvedTitle,
        tags: finalTags,
        folderIds: [...selectedFolderIds],
        ...sourceMeta,
        createdAt: now,
        updatedAt: now,
        content,
      };
      onCreateDocument(newDoc, true);
      onClose();
      onNotify(
        method === 'ocr-fallback'
          ? t.pdfImportSuccessOcr
          : method === 'gemini'
            ? t.pdfImportSuccessAi
            : t.pdfImportSuccessLocal,
        'success'
      );
    } catch (err) {
      const msg =
        err.code === 'RESTRICTED_PDF'
          ? t.pdfRestrictedError
          : err.code === 'MISSING_API_KEY'
            ? t.missingApiKeyError
            : err?.message || t.pdfImportError;
      setErrorMsg(msg);
      onNotify(msg, 'error');
    } finally {
      setIsSubmitting(false);
      setStatusMessage('');
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) return;

    const targetType = effectiveType || 'pdf';
    if (targetType === 'gdoc') {
      handleSubmitGdoc(trimmedUrl);
    } else {
      handleSubmitPdfUrl(trimmedUrl);
    }
  };

  const trimmedUrl = linkUrl.trim();
  const isManualOverrideActive = Boolean(manualTypeOverride && manualTypeOverride !== detectedType);
  const canSubmit = !isSubmitting && Boolean(trimmedUrl) && Boolean(effectiveType);

  const showKatexToggle =
    effectiveType === 'gdoc' || (effectiveType === 'pdf' && pdfImportMode === 'extract');

  return createPortal(
    <div
      className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hd-modal-in w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150 ${
                effectiveType === 'pdf'
                  ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                  : 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
              }`}
            >
              {effectiveType === 'pdf' ? (
                <FileText className="w-4 h-4" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
            </div>
            <h3 className="font-semibold text-[16px] text-[#262624] dark:text-[#ECECEA]">
              {t.importLinkModalTitle}
            </h3>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label={t.cancel}
            className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] leading-relaxed mb-4">
          {t.importLinkModalDesc}
        </p>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Single Unified URL Input Box */}
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
              {t.importLinkUrlLabel}
            </label>
            <div className="relative">
              <Link2 className="w-4 h-4 text-[#9B9A97] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                required
                autoFocus
                disabled={isSubmitting}
                value={linkUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder={t.importLinkUrlPlaceholder}
                className="w-full min-h-[42px] pl-9 pr-9 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              {linkUrl && !isSubmitting && (
                <button
                  type="button"
                  onClick={() => handleUrlChange('')}
                  aria-label={t.clearSearch}
                  className="p-1 rounded-md text-[#9B9A97] hover:text-[#262624] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#2F2F2F] absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Live Auto-Detection Status Banner */}
            {detectedType && !isManualOverrideActive && (
              <div
                className={`flex items-center gap-1.5 text-[12px] font-medium ${
                  detectedType === 'gdoc'
                    ? 'text-sky-700 dark:text-sky-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {detectedType === 'gdoc'
                    ? t.importLinkAutoGdoc
                    : detectedDriveInfo
                      ? t.importLinkAutoDrivePdf
                      : t.importLinkAutoPdf}
                </span>
              </div>
            )}

            {/* Compact Manual Type Switcher (always available to override auto-detection) */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="inline-flex items-center gap-1.5">
                <span className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                  {t.importLinkTypeLabel}:
                </span>
                <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-[#F3F3F1] dark:bg-[#202020] border border-[#E8E8E5] dark:border-[#343434]">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleManualTypeSelect('gdoc')}
                    className={`h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                      effectiveType === 'gdoc'
                        ? 'bg-[#FFFFFF] dark:bg-[#2E2E2E] text-[#262624] dark:text-[#ECECEA] shadow-xs'
                        : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
                    }`}
                  >
                    <Link2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                    <span>{t.importLinkTypeGdoc}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleManualTypeSelect('pdf')}
                    className={`h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                      effectiveType === 'pdf'
                        ? 'bg-[#FFFFFF] dark:bg-[#2E2E2E] text-[#262624] dark:text-[#ECECEA] shadow-xs'
                        : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
                    }`}
                  >
                    <FileText className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    <span>{t.importLinkTypePdf}</span>
                  </button>
                </div>
              </div>

              {isManualOverrideActive && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/12 text-amber-700 dark:text-amber-300 text-[11px] font-medium">
                  {t.importLinkManualBadge}
                </span>
              )}
            </div>

            {trimmedUrl && !effectiveType && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">
                {t.importLinkManualHint}
              </p>
            )}
          </div>

          {/* PDF 2-Mode Selector (Embed Original PDF vs Extract to Editable Markdown) */}
          {effectiveType === 'pdf' && (
            <>
              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                  {t.pdfImportModeLabel}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setPdfImportMode('embed')}
                    className={`text-left p-3 rounded-xl border cursor-pointer transition-colors duration-150 ${
                      pdfImportMode === 'embed'
                        ? 'border-indigo-500 bg-indigo-500/8'
                        : 'border-[#E8E8E5] dark:border-[#343434] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Eye
                        className={`w-4 h-4 shrink-0 ${
                          pdfImportMode === 'embed'
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-[#6B6A66] dark:text-[#9B9A97]'
                        }`}
                      />
                      <span className="text-[13px] font-semibold text-[#262624] dark:text-[#ECECEA]">
                        {t.pdfModeEmbedTitle}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97] leading-snug">
                      {t.pdfModeEmbedDesc}
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setPdfImportMode('extract')}
                    className={`text-left p-3 rounded-xl border cursor-pointer transition-colors duration-150 ${
                      pdfImportMode === 'extract'
                        ? 'border-indigo-500 bg-indigo-500/8'
                        : 'border-[#E8E8E5] dark:border-[#343434] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles
                        className={`w-4 h-4 shrink-0 ${
                          pdfImportMode === 'extract'
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-[#6B6A66] dark:text-[#9B9A97]'
                        }`}
                      />
                      <span className="text-[13px] font-semibold text-[#262624] dark:text-[#ECECEA]">
                        {t.pdfModeExtractTitle}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97] leading-snug">
                      {t.pdfModeExtractDesc}
                    </p>
                  </button>
                </div>
              </div>

              {/* Optional Custom Title for PDF */}
              <div>
                <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                  {t.pdfCustomTitleLabel}
                </label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  value={pdfTitleOverride}
                  onChange={(e) => setPdfTitleOverride(e.target.value)}
                  placeholder={t.pdfCustomTitlePlaceholder}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[13.5px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>
            </>
          )}

          {/* Live Progress Banner */}
          {isSubmitting && statusMessage && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3 flex items-center gap-2.5 text-[13px] font-medium text-indigo-700 dark:text-indigo-300">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span className="leading-snug">{statusMessage}</span>
            </div>
          )}

          {/* Inline Error Alert */}
          {errorMsg && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-start gap-2.5 text-[13px] text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-snug">{errorMsg}</span>
            </div>
          )}

          {/* Optional Target Folders (Many-to-Many) */}
          {folders.length > 0 && (
            <div>
              <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                {t.gdocTargetFoldersLabel}
              </label>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-0.5">
                {folders.map((folder) => {
                  const checked = selectedFolderIds.includes(folder.id);
                  return (
                    <label
                      key={folder.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-[13.5px] cursor-pointer transition-colors duration-150 ${
                        checked
                          ? 'border-indigo-500/50 bg-indigo-500/6'
                          : 'border-[#E8E8E5] dark:border-[#343434] hover:bg-[#FBFBFA] dark:hover:bg-[#2F2F2F]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTargetFolder(folder.id)}
                        className="w-4 h-4 rounded border-[#C6C5C0] text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
                      />
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="truncate font-medium text-[#262624] dark:text-[#ECECEA]">
                        {folder.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional Tags (Max 3) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                {t.editTags} ({tags.length}/{MAX_TAGS})
              </label>
              <span className="text-[12px] text-[#9B9A97]">{t.maxTagsHint}</span>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F3F3F1] dark:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[12.5px] font-medium"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="hover:text-rose-500 cursor-pointer"
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
                disabled={tags.length >= MAX_TAGS}
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder={tags.length >= MAX_TAGS ? t.maxTagsReached : t.addTagPlaceholder}
                className="flex-1 min-h-[38px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[13px] disabled:opacity-50"
              />
              <button
                type="button"
                disabled={tags.length >= MAX_TAGS || !tagDraft.trim()}
                onClick={addTag}
                className="px-3.5 rounded-lg bg-[#F3F3F1] dark:bg-[#323232] hover:bg-[#E8E8E5] dark:hover:bg-[#3C3C3C] font-semibold text-[14px] disabled:opacity-40 cursor-pointer transition-colors duration-150"
              >
                +
              </button>
            </div>
          </div>

          {/* Auto-format Math/Chemistry KaTeX Checkbox */}
          {showKatexToggle && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-[#E8E8E5] dark:border-[#343434] bg-[#FBFBFA] dark:bg-[#202020] cursor-pointer transition-colors duration-150 hover:border-indigo-500/40">
              <input
                type="checkbox"
                checked={autoSanitizeKatex}
                onChange={(e) => setAutoSanitizeKatex(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-[#C6C5C0] text-indigo-600 focus:ring-indigo-500 shrink-0 cursor-pointer"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#262624] dark:text-[#ECECEA]">
                  {t.autoFormatKatexLabel}
                </p>
                <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] leading-snug mt-0.5">
                  {t.autoFormatKatexHint}
                </p>
              </div>
            </label>
          )}

          {/* Footer Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[14px] font-medium cursor-pointer transition-colors duration-150"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`min-h-[40px] px-5 rounded-lg disabled:opacity-50 text-white text-[14px] font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors duration-150 ${
                effectiveType === 'pdf'
                  ? 'bg-indigo-600 hover:bg-indigo-700'
                  : 'bg-sky-600 hover:bg-sky-700'
              }`}
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : effectiveType === 'pdf' ? (
                pdfImportMode === 'extract' ? (
                  <Sparkles className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )
              ) : (
                <Link2 className="w-4 h-4" />
              )}
              <span>
                {isSubmitting
                  ? statusMessage || t.gdocImporting
                  : effectiveType === 'pdf'
                    ? pdfImportMode === 'embed'
                      ? t.pdfImportEmbedSubmit
                      : t.pdfImportExtractSubmit
                    : effectiveType === 'gdoc'
                      ? t.gdocImportSubmit
                      : t.importLinkSubmitDefault}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

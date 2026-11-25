import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Link2,
  FileText,
  Upload,
  Folder,
  X,
  Loader2,
  AlertCircle,
  Eye,
  Sparkles,
  CheckCircle2,
  Crop,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Image as ImageIcon,
  Check,
} from 'lucide-react';
import {
  cleanPdfTitle,
  derivePdfTitleFromUrl,
  fetchPdfFileFromUrl,
  importGoogleDoc,
  importPdfFile,
  normalizePdfUrl,
  ocrPreparedImages,
  readFileAsPdfDataUrl,
} from '../services/importService';
import {
  compressImageFile,
  isImageFile,
  isPdfFile,
  loadPdfDocument,
  parsePageSelectionInput,
  renderPdfPageToCompressedImage,
} from '../utils/documentProcessor';
import ImageCropModal from './ImageCropModal';

const MAX_TAGS = 3;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function cleanFileBaseTitle(filename, fallback = '') {
  return String(filename || '')
    .replace(/\.(pdf|png|jpe?g|webp|gif|bmp)$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

export default function ImportModal({
  isOpen,
  initialTab = 'gdoc', // 'gdoc' | 'pdf'
  folders,
  onClose,
  onCreateDocument,
  onNotify,
  t,
  lang,
}) {
  const [activeTab, setActiveTab] = useState(initialTab);

  // Shared metadata state
  const [selectedFolderIds, setSelectedFolderIds] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [autoSanitizeKatex, setAutoSanitizeKatex] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Google Docs tab state
  const [gdocUrl, setGdocUrl] = useState('');

  // PDF Link / Local File (PDF or Image) tab state
  const [pdfSourceType, setPdfSourceType] = useState('url'); // 'url' | 'file'
  const [pdfUrl, setPdfUrl] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [localFileKind, setLocalFileKind] = useState(null); // null | 'pdf' | 'image'
  const [pdfTitleOverride, setPdfTitleOverride] = useState('');
  const [pdfImportMode, setPdfImportMode] = useState('embed'); // 'embed' | 'extract'
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

  // Client-side image compression, PDF page preview & selection, and interactive crop state
  const [compressedImage, setCompressedImage] = useState(null); // { dataUrl, base64, mimeType, width, height, byteSize }
  const [croppedImage, setCroppedImage] = useState(null);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [selectedPages, setSelectedPages] = useState([]);
  const [activePreviewPage, setActivePreviewPage] = useState(1);
  const [pageRangeDraft, setPageRangeDraft] = useState('');
  const [renderedPagesMap, setRenderedPagesMap] = useState({}); // { [pageNum]: compressedObj }
  const [croppedPagesMap, setCroppedPagesMap] = useState({}); // { [pageNum]: compressedObj }
  const [isPreparingPreview, setIsPreparingPreview] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);

  const pdfFileInputRef = useRef(null);
  const pdfDocRef = useRef(null);
  const loadSessionRef = useRef(0);

  const cleanupLoadedPdfDoc = () => {
    if (pdfDocRef.current) {
      try {
        pdfDocRef.current.destroy?.();
      } catch {
        // ignore cleanup error
      }
      pdfDocRef.current = null;
    }
  };

  const resetLocalFilePreviewState = () => {
    loadSessionRef.current += 1;
    cleanupLoadedPdfDoc();
    setPdfFile(null);
    setLocalFileKind(null);
    setCompressedImage(null);
    setCroppedImage(null);
    setPdfTotalPages(0);
    setSelectedPages([]);
    setActivePreviewPage(1);
    setPageRangeDraft('');
    setRenderedPagesMap({});
    setCroppedPagesMap({});
    setIsPreparingPreview(false);
    setCropModalOpen(false);
  };

  // Cleanup pdfjs worker document on unmount
  useEffect(() => {
    return () => {
      cleanupLoadedPdfDoc();
    };
  }, []);

  // Reset modal state whenever opened or closed
  useEffect(() => {
    if (!isOpen) {
      cleanupLoadedPdfDoc();
      return;
    }
    loadSessionRef.current += 1;
    cleanupLoadedPdfDoc();
    setActiveTab(initialTab);
    setSelectedFolderIds([]);
    setTags(initialTab === 'pdf' ? ['PDF'] : ['Google Docs']);
    setTagDraft('');
    setAutoSanitizeKatex(true);
    setIsSubmitting(false);
    setStatusMessage('');
    setErrorMsg('');
    setGdocUrl('');
    setPdfSourceType('url');
    setPdfUrl('');
    setPdfFile(null);
    setLocalFileKind(null);
    setPdfTitleOverride('');
    setPdfImportMode('embed');
    setIsDraggingPdf(false);
    setCompressedImage(null);
    setCroppedImage(null);
    setPdfTotalPages(0);
    setSelectedPages([]);
    setActivePreviewPage(1);
    setPageRangeDraft('');
    setRenderedPagesMap({});
    setCroppedPagesMap({});
    setIsPreparingPreview(false);
    setCropModalOpen(false);
  }, [isOpen, initialTab]);

  // Lazily render and cache the active PDF preview page at scale 2.0 -> compressed JPEG
  useEffect(() => {
    if (!isOpen || localFileKind !== 'pdf' || !pdfDocRef.current || pdfTotalPages <= 0) return;
    if (renderedPagesMap[activePreviewPage]) return;

    const sessionId = loadSessionRef.current;
    let cancelled = false;
    setIsPreparingPreview(true);

    renderPdfPageToCompressedImage(pdfDocRef.current, activePreviewPage)
      .then((rendered) => {
        if (cancelled || sessionId !== loadSessionRef.current) return;
        setRenderedPagesMap((prev) => ({
          ...prev,
          [activePreviewPage]: rendered,
        }));
      })
      .catch((err) => {
        if (cancelled || sessionId !== loadSessionRef.current) return;
        setErrorMsg(err?.message || t.pdfImportError);
      })
      .finally(() => {
        if (!cancelled && sessionId === loadSessionRef.current) {
          setIsPreparingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, localFileKind, pdfTotalPages, activePreviewPage, renderedPagesMap, t.pdfImportError]);

  // Update default tag cleanly when user switches tabs without custom edits
  const handleSwitchTab = (nextTab) => {
    if (isSubmitting || nextTab === activeTab) return;
    setActiveTab(nextTab);
    setErrorMsg('');
    setStatusMessage('');
    if (
      tags.length === 0 ||
      (tags.length === 1 && (tags[0] === 'Google Docs' || tags[0] === 'PDF' || tags[0] === 'OCR'))
    ) {
      setTags([nextTab === 'pdf' ? 'PDF' : 'Google Docs']);
    }
  };

  // Detect Google Drive PDF link live to show helpful conversion indicator
  const detectedDriveInfo = useMemo(() => {
    if (!pdfUrl.trim()) return null;
    try {
      const info = normalizePdfUrl(pdfUrl);
      return info.isGoogleDrive ? info : null;
    } catch {
      return null;
    }
  }, [pdfUrl]);

  // Current preview object for either local image or active PDF page
  const activePreviewAsset = useMemo(() => {
    if (localFileKind === 'image') {
      return croppedImage || compressedImage;
    }
    if (localFileKind === 'pdf') {
      return croppedPagesMap[activePreviewPage] || renderedPagesMap[activePreviewPage] || null;
    }
    return null;
  }, [localFileKind, croppedImage, compressedImage, croppedPagesMap, renderedPagesMap, activePreviewPage]);

  const isActiveAssetCropped = useMemo(() => {
    if (localFileKind === 'image') return Boolean(croppedImage);
    if (localFileKind === 'pdf') return Boolean(croppedPagesMap[activePreviewPage]);
    return false;
  }, [localFileKind, croppedImage, croppedPagesMap, activePreviewPage]);

  const croppedPagesCount = useMemo(
    () => Object.keys(croppedPagesMap).length,
    [croppedPagesMap]
  );

  if (!isOpen || typeof document === 'undefined') return null;

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
    }
    setTagDraft('');
  };

  const getFinalTags = () => {
    const next = [...tags];
    if (tagDraft.trim() && next.length < MAX_TAGS && !next.includes(tagDraft.trim())) {
      next.push(tagDraft.trim());
    }
    return next.slice(0, MAX_TAGS);
  };

  const handleSelectLocalFile = async (file) => {
    if (!file) return;
    const isPdf = isPdfFile(file);
    const isImg = isImageFile(file);

    if (!isPdf && !isImg) {
      setErrorMsg(t.pdfInvalidFileError);
      return;
    }

    const sessionId = ++loadSessionRef.current;
    cleanupLoadedPdfDoc();
    setErrorMsg('');
    setPdfFile(file);
    setCompressedImage(null);
    setCroppedImage(null);
    setPdfTotalPages(0);
    setSelectedPages([]);
    setActivePreviewPage(1);
    setPageRangeDraft('');
    setRenderedPagesMap({});
    setCroppedPagesMap({});
    setIsPreparingPreview(true);

    if (!pdfTitleOverride.trim()) {
      setPdfTitleOverride(cleanFileBaseTitle(file.name, ''));
    }

    if (isImg) {
      setLocalFileKind('image');
      setPdfImportMode('extract');
      if (tags.length === 1 && tags[0] === 'PDF') {
        setTags(['OCR']);
      }
      try {
        const compressed = await compressImageFile(file);
        if (sessionId !== loadSessionRef.current) return;
        setCompressedImage(compressed);
      } catch (err) {
        if (sessionId !== loadSessionRef.current) return;
        setErrorMsg(err?.message || t.pdfInvalidFileError);
      } finally {
        if (sessionId === loadSessionRef.current) {
          setIsPreparingPreview(false);
        }
      }
      return;
    }

    // PDF file
    setLocalFileKind('pdf');
    if (tags.length === 1 && tags[0] === 'OCR') {
      setTags(['PDF']);
    }
    try {
      const { pdfDoc, numPages } = await loadPdfDocument(file);
      if (sessionId !== loadSessionRef.current) {
        pdfDoc.destroy?.();
        return;
      }
      pdfDocRef.current = pdfDoc;
      setPdfTotalPages(numPages);
      setSelectedPages(Array.from({ length: numPages }, (_, idx) => idx + 1));
      setActivePreviewPage(1);

      const firstPage = await renderPdfPageToCompressedImage(pdfDoc, 1);
      if (sessionId !== loadSessionRef.current) return;
      setRenderedPagesMap({ 1: firstPage });
    } catch (err) {
      if (sessionId !== loadSessionRef.current) return;
      setErrorMsg(err?.message || t.pdfImportError);
    } finally {
      if (sessionId === loadSessionRef.current) {
        setIsPreparingPreview(false);
      }
    }
  };

  const togglePageSelected = (pageNum, alsoPreview = true) => {
    setSelectedPages((prev) =>
      prev.includes(pageNum)
        ? prev.filter((p) => p !== pageNum)
        : [...prev, pageNum].sort((a, b) => a - b)
    );
    if (alsoPreview) {
      setActivePreviewPage(pageNum);
    }
    if (errorMsg) setErrorMsg('');
  };

  const handleApplyPageRange = () => {
    if (!pdfTotalPages) return;
    const parsed = parsePageSelectionInput(pageRangeDraft, pdfTotalPages);
    if (parsed.length === 0) {
      setErrorMsg(t.pdfNoPagesSelectedError);
      return;
    }
    setErrorMsg('');
    setSelectedPages(parsed);
    setActivePreviewPage(parsed[0]);
  };

  const handleConfirmCrop = (croppedResult) => {
    if (localFileKind === 'image') {
      setCroppedImage(croppedResult);
    } else if (localFileKind === 'pdf') {
      setCroppedPagesMap((prev) => ({
        ...prev,
        [activePreviewPage]: {
          pageNumber: activePreviewPage,
          ...croppedResult,
        },
      }));
      // Automatically ensure this cropped page is included & switch to AI Extract mode
      setSelectedPages((prev) =>
        prev.includes(activePreviewPage)
          ? prev
          : [...prev, activePreviewPage].sort((a, b) => a - b)
      );
      if (pdfImportMode !== 'extract') {
        setPdfImportMode('extract');
      }
    }
    setCropModalOpen(false);
  };

  const handleResetActiveCrop = () => {
    if (localFileKind === 'image') {
      setCroppedImage(null);
    } else if (localFileKind === 'pdf') {
      setCroppedPagesMap((prev) => {
        const next = { ...prev };
        delete next[activePreviewPage];
        return next;
      });
    }
  };

  const handleSubmitGdoc = async () => {
    if (!gdocUrl.trim()) return;
    setIsSubmitting(true);
    setErrorMsg('');
    setStatusMessage(t.gdocImporting);

    try {
      const { title, markdown } = await importGoogleDoc(gdocUrl.trim(), {
        sanitizeKatex: autoSanitizeKatex,
      });

      const now = Date.now();
      const newDoc = {
        id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
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

  const handleSubmitPdf = async () => {
    if (pdfSourceType === 'url' && !pdfUrl.trim()) return;
    if (pdfSourceType === 'file' && !pdfFile) return;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const now = Date.now();
      const finalTags = getFinalTags();

      // Case 1: Local Image OCR via compressed / cropped JPEG payload
      if (pdfSourceType === 'file' && localFileKind === 'image') {
        const imagePayload = croppedImage || compressedImage || (await compressImageFile(pdfFile));
        setStatusMessage(t.pdfExtractingPageProgress(1, 1));

        const fallbackTitle = cleanFileBaseTitle(
          pdfTitleOverride.trim() || pdfFile.name,
          ''
        );

        const { title, content } = await ocrPreparedImages([imagePayload], {
          baseName: fallbackTitle,
          language: lang,
          sanitizeKatex: autoSanitizeKatex,
          onProgress: (progress) => {
            if (!progress) return;
            setStatusMessage(
              t.pdfExtractingPageProgress(progress.currentPage, progress.totalPages)
            );
          },
        });

        const resolvedTitle =
          pdfTitleOverride.trim() || cleanPdfTitle(title, fallbackTitle || t.untitledDoc);
        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          title: resolvedTitle,
          tags: finalTags,
          folderIds: [...selectedFolderIds],
          createdAt: now,
          updatedAt: now,
          content,
        };
        onCreateDocument(newDoc, true);
        onClose();
        onNotify(t.imageScanSuccess, 'success');
        return;
      }

      // Case 2: Embed / View Original PDF directly in Document Workspace
      if (pdfImportMode === 'embed') {
        if (pdfSourceType === 'url') {
          const info = normalizePdfUrl(pdfUrl.trim());
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

        // Local PDF Embed
        setStatusMessage(t.pdfPreparingEmbed);
        const dataUrl = await readFileAsPdfDataUrl(pdfFile);
        const resolvedTitle =
          cleanPdfTitle(pdfTitleOverride.trim(), '') ||
          cleanPdfTitle(pdfFile.name, t.untitledDoc);

        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          docType: 'pdf-embed',
          title: resolvedTitle,
          tags: finalTags,
          folderIds: [...selectedFolderIds],
          pdfDataUrl: dataUrl,
          pdfFileName: pdfFile.name,
          pdfFileSize: pdfFile.size,
          createdAt: now,
          updatedAt: now,
          content: `# ${resolvedTitle}\n\nEmbedded local PDF (${formatBytes(pdfFile.size)}).\n`,
        };
        onCreateDocument(newDoc, true);
        onClose();
        onNotify(t.pdfEmbedSuccess, 'success');
        return;
      }

      // Case 3: Local PDF Extract using selected pages + client-side compression & cropped regions
      if (pdfSourceType === 'file' && localFileKind === 'pdf') {
        const pagesToScan = [...selectedPages].sort((a, b) => a - b);
        if (pagesToScan.length === 0) {
          setErrorMsg(t.pdfNoPagesSelectedError);
          setIsSubmitting(false);
          return;
        }

        let pdfDoc = pdfDocRef.current;
        if (!pdfDoc) {
          const loaded = await loadPdfDocument(pdfFile);
          pdfDoc = loaded.pdfDoc;
          pdfDocRef.current = pdfDoc;
        }

        const preparedPages = [];
        const newlyRendered = {};

        for (let i = 0; i < pagesToScan.length; i++) {
          const pageNum = pagesToScan[i];
          setStatusMessage(t.pdfExtractingPageProgress(i + 1, pagesToScan.length));

          if (croppedPagesMap[pageNum]) {
            preparedPages.push({
              pageNumber: pageNum,
              ...croppedPagesMap[pageNum],
            });
          } else if (renderedPagesMap[pageNum]) {
            preparedPages.push(renderedPagesMap[pageNum]);
          } else {
            const rendered = await renderPdfPageToCompressedImage(pdfDoc, pageNum);
            newlyRendered[pageNum] = rendered;
            preparedPages.push(rendered);
          }
        }

        if (Object.keys(newlyRendered).length > 0) {
          setRenderedPagesMap((prev) => ({ ...prev, ...newlyRendered }));
        }

        const fallbackTitle = cleanPdfTitle(pdfTitleOverride.trim() || pdfFile.name, '');
        const { title, content } = await ocrPreparedImages(preparedPages, {
          baseName: fallbackTitle,
          language: lang,
          sanitizeKatex: autoSanitizeKatex,
          onProgress: (progress) => {
            if (!progress) return;
            if (progress.stage === 'ocr') {
              setStatusMessage(
                t.pdfOcrPageProgress(
                  progress.currentPage,
                  progress.endPage || progress.currentPage,
                  progress.totalPages
                )
              );
            } else {
              setStatusMessage(
                t.pdfExtractingPageProgress(progress.currentPage, progress.totalPages)
              );
            }
          },
        });

        const resolvedTitle =
          cleanPdfTitle(pdfTitleOverride.trim(), '') ||
          cleanPdfTitle(title, cleanPdfTitle(pdfFile.name, t.untitledDoc));
        const newDoc = {
          id: `doc_${now}_${Math.random().toString(36).slice(2, 7)}`,
          title: resolvedTitle,
          tags: finalTags,
          folderIds: [...selectedFolderIds],
          createdAt: now,
          updatedAt: now,
          content,
        };
        onCreateDocument(newDoc, true);
        onClose();
        onNotify(t.pdfImportSuccessOcr, 'success');
        return;
      }

      // Case 4: Remote PDF URL Extract (existing flow with live progress)
      let fallbackTitle = cleanPdfTitle(pdfTitleOverride.trim(), '');
      setStatusMessage(t.pdfFetchingUrl);
      const fetched = await fetchPdfFileFromUrl(pdfUrl.trim());
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
    if (activeTab === 'gdoc') {
      handleSubmitGdoc();
    } else {
      handleSubmitPdf();
    }
  };

  const canSubmit =
    !isSubmitting &&
    !isPreparingPreview &&
    (activeTab === 'gdoc'
      ? Boolean(gdocUrl.trim())
      : pdfSourceType === 'url'
        ? Boolean(pdfUrl.trim())
        : Boolean(pdfFile) &&
          (localFileKind === 'image'
            ? Boolean(compressedImage || croppedImage)
            : pdfImportMode === 'embed' || selectedPages.length > 0));

  const showPreviewPanel =
    activeTab === 'pdf' && pdfSourceType === 'file' && Boolean(pdfFile);

  const cropModalTitle =
    localFileKind === 'pdf' && pdfTotalPages > 1
      ? `${t.cropModalTitle} · ${t.pdfPageIndicator(activePreviewPage, pdfTotalPages)}`
      : t.cropModalTitle;

  const currentPageIncluded =
    localFileKind === 'pdf' && selectedPages.includes(activePreviewPage);

  return createPortal(
    <>
      <div
        className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
        onClick={() => !isSubmitting && !cropModalOpen && onClose()}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`hd-modal-in w-full ${
            showPreviewPanel ? 'max-w-xl' : 'max-w-lg'
          } max-h-[90dvh] overflow-y-auto rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5 transition-[max-width] duration-150`}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  activeTab === 'pdf'
                    ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                    : 'bg-sky-500/12 text-sky-600 dark:text-sky-400'
                }`}
              >
                {activeTab === 'pdf' ? (
                  <FileText className="w-4 h-4" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
              </div>
              <h3 className="font-semibold text-[16px] text-[#262624] dark:text-[#ECECEA]">
                {activeTab === 'pdf' ? t.pdfModalTitle : t.gdocModalTitle}
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

          {/* Source Tab Switcher: Google Docs vs PDF Link / File */}
          <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-lg bg-[#F3F3F1] dark:bg-[#202020] border border-[#E8E8E5] dark:border-[#2F2F2F]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSwitchTab('gdoc')}
              className={`min-h-[34px] px-3 rounded-md text-[13px] font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                activeTab === 'gdoc'
                  ? 'bg-[#FFFFFF] dark:bg-[#2E2E2E] text-[#262624] dark:text-[#ECECEA] shadow-xs'
                  : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>{t.importTabGdoc}</span>
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSwitchTab('pdf')}
              className={`min-h-[34px] px-3 rounded-md text-[13px] font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                activeTab === 'pdf'
                  ? 'bg-[#FFFFFF] dark:bg-[#2E2E2E] text-[#262624] dark:text-[#ECECEA] shadow-xs'
                  : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              <span>{t.importTabPdf}</span>
            </button>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {activeTab === 'gdoc' ? (
              <>
                <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] leading-relaxed">
                  {t.gdocModalDesc}
                </p>

                {/* Google Docs URL */}
                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.gdocUrlLabel}
                  </label>
                  <input
                    type="url"
                    required
                    autoFocus
                    value={gdocUrl}
                    onChange={(e) => {
                      setGdocUrl(e.target.value);
                      if (errorMsg) setErrorMsg('');
                    }}
                    placeholder={t.gdocUrlPlaceholder}
                    className="w-full min-h-[42px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[14px] focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] leading-relaxed">
                  {t.pdfModalDesc}
                </p>

                {/* PDF Source Toggle: URL vs Local PDF / Image File */}
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setPdfSourceType('url');
                      setErrorMsg('');
                    }}
                    className={`h-8 px-3 rounded-lg text-[12.5px] font-medium border inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                      pdfSourceType === 'url'
                        ? 'bg-[#262624] dark:bg-[#ECECEA] text-white dark:text-[#191919] border-transparent'
                        : 'border-[#E8E8E5] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#202020] text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#2B2B2B]'
                    }`}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>{t.pdfSourceUrlTab}</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setPdfSourceType('file');
                      setErrorMsg('');
                    }}
                    className={`h-8 px-3 rounded-lg text-[12.5px] font-medium border inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                      pdfSourceType === 'file'
                        ? 'bg-[#262624] dark:bg-[#ECECEA] text-white dark:text-[#191919] border-transparent'
                        : 'border-[#E8E8E5] dark:border-[#363636] bg-[#FBFBFA] dark:bg-[#202020] text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#2B2B2B]'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{t.pdfSourceFileTab}</span>
                  </button>
                </div>

                {pdfSourceType === 'url' ? (
                  <div className="space-y-1.5">
                    <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                      {t.pdfUrlLabel}
                    </label>
                    <input
                      type="url"
                      required
                      autoFocus
                      value={pdfUrl}
                      onChange={(e) => {
                        setPdfUrl(e.target.value);
                        if (errorMsg) setErrorMsg('');
                      }}
                      placeholder={t.pdfUrlPlaceholder}
                      className="w-full min-h-[42px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                    {detectedDriveInfo && (
                      <div className="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{t.pdfDriveDetectedHint}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Dropzone / Selected File Summary */}
                    <div
                      onClick={() => !isSubmitting && pdfFileInputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingPdf(true);
                      }}
                      onDragLeave={() => setIsDraggingPdf(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingPdf(false);
                        handleSelectLocalFile(e.dataTransfer.files?.[0]);
                      }}
                      className={`rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-colors duration-150 ${
                        isDraggingPdf
                          ? 'border-indigo-500 bg-indigo-500/8'
                          : 'border-[#D8D8D4] dark:border-[#3A3A3A] bg-[#FBFBFA] dark:bg-[#202020] hover:border-indigo-500/70'
                      }`}
                    >
                      {pdfFile ? (
                        <div className="flex items-center justify-between gap-3 text-left">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                                localFileKind === 'image'
                                  ? 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400'
                                  : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {localFileKind === 'image' ? (
                                <ImageIcon className="w-4 h-4" />
                              ) : (
                                <FileText className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-medium text-[#262624] dark:text-[#ECECEA] truncate">
                                {pdfFile.name}
                              </p>
                              <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                                {formatBytes(pdfFile.size)}
                                {localFileKind === 'pdf' && pdfTotalPages > 0
                                  ? ` · ${t.pdfPagesSelectedCount(selectedPages.length, pdfTotalPages)}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={(e) => {
                              e.stopPropagation();
                              resetLocalFilePreviewState();
                            }}
                            className="p-1.5 rounded-lg text-[#6B6A66] hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="py-1.5">
                          <Upload className="w-6 h-6 mx-auto text-indigo-500 mb-2" />
                          <p className="text-[13.5px] font-medium text-[#262624] dark:text-[#ECECEA]">
                            {t.pdfDropzonePrompt}
                          </p>
                          <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] mt-0.5">
                            {t.pdfDropzoneHint}
                          </p>
                        </div>
                      )}
                    </div>

                    <input
                      ref={pdfFileInputRef}
                      type="file"
                      accept=".pdf,application/pdf,image/png,image/jpeg,image/webp,image/*"
                      onChange={(e) => {
                        handleSelectLocalFile(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />

                    {/* Compressed Page Preview & Interactive Crop Controls */}
                    {showPreviewPanel && (
                      <div className="rounded-xl border border-[#E8E8E5] dark:border-[#343434] bg-[#FBFBFA] dark:bg-[#202020] overflow-hidden">
                        {/* Preview Header Bar */}
                        <div className="px-3 py-2.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F] flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[12.5px] font-semibold text-[#262624] dark:text-[#ECECEA]">
                              {localFileKind === 'pdf' && pdfTotalPages > 0
                                ? t.pdfPageIndicator(activePreviewPage, pdfTotalPages)
                                : t.pdfPreviewLabel}
                            </span>

                            {localFileKind === 'pdf' && pdfTotalPages > 1 && (
                              <div className="inline-flex items-center rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] overflow-hidden">
                                <button
                                  type="button"
                                  disabled={isSubmitting || activePreviewPage <= 1}
                                  onClick={() => setActivePreviewPage((p) => Math.max(1, p - 1))}
                                  className="p-1 text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] disabled:opacity-35 cursor-pointer"
                                  aria-label="Previous page"
                                >
                                  <ChevronLeft className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting || activePreviewPage >= pdfTotalPages}
                                  onClick={() =>
                                    setActivePreviewPage((p) => Math.min(pdfTotalPages, p + 1))
                                  }
                                  className="p-1 text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] disabled:opacity-35 cursor-pointer"
                                  aria-label="Next page"
                                >
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}

                            {isActiveAssetCropped && (
                              <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
                                {t.croppedBadge}
                              </span>
                            )}
                          </div>

                          {/* Crop Selection & Reset Crop Actions */}
                          <div className="flex items-center gap-1.5">
                            {isActiveAssetCropped && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={handleResetActiveCrop}
                                title={t.resetCropBtn}
                                className="h-7 px-2 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA] text-[12px] inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span className="hidden sm:inline">{t.resetCropBtn}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isSubmitting || isPreparingPreview || !activePreviewAsset}
                              onClick={() => setCropModalOpen(true)}
                              className="h-7 px-2.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/16 text-indigo-700 dark:text-indigo-300 disabled:opacity-45 text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                            >
                              <Crop className="w-3.5 h-3.5" />
                              <span>{t.cropSelectionBtn}</span>
                            </button>
                          </div>
                        </div>

                        {/* Preview Image Stage */}
                        <div className="relative p-3 flex flex-col items-center justify-center min-h-[180px] max-h-[260px] bg-[#F3F3F1]/70 dark:bg-[#191919]">
                          {isPreparingPreview && !activePreviewAsset ? (
                            <div className="flex flex-col items-center gap-2 text-[#6B6A66] dark:text-[#9B9A97] py-6">
                              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                              <span className="text-[12.5px]">{t.pdfPreviewRendering}</span>
                            </div>
                          ) : activePreviewAsset ? (
                            <>
                              <img
                                src={activePreviewAsset.dataUrl}
                                alt={t.pdfPreviewLabel}
                                className="max-h-[220px] max-w-full object-contain rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-white shadow-xs"
                              />
                              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97] tabular-nums">
                                <span>
                                  {t.compressedBadge(formatBytes(activePreviewAsset.byteSize))}
                                </span>
                                <span>·</span>
                                <span>
                                  {activePreviewAsset.width} × {activePreviewAsset.height}px
                                </span>
                                {localFileKind === 'pdf' && pdfTotalPages > 1 && (
                                  <>
                                    <span>·</span>
                                    <label className="inline-flex items-center gap-1.5 text-[#262624] dark:text-[#ECECEA] font-medium cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={currentPageIncluded}
                                        disabled={isSubmitting}
                                        onChange={() => togglePageSelected(activePreviewPage, false)}
                                        className="w-3.5 h-3.5 rounded border-[#C6C5C0] text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                      />
                                      <span>{t.pdfTogglePageIncluded}</span>
                                    </label>
                                  </>
                                )}
                              </div>
                            </>
                          ) : null}
                        </div>

                        {/* Multi-Page PDF Selection Controls */}
                        {localFileKind === 'pdf' && pdfTotalPages > 1 && (
                          <div className="px-3 py-2.5 border-t border-[#E8E8E5] dark:border-[#2F2F2F] space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                                  {t.pdfPageSelectionLabel}
                                </span>
                                <span className="text-[11.5px] font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                  {t.pdfPagesSelectedCount(selectedPages.length, pdfTotalPages)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() =>
                                    setSelectedPages(
                                      Array.from({ length: pdfTotalPages }, (_, idx) => idx + 1)
                                    )
                                  }
                                  className="px-2 py-0.5 rounded-md text-[11.5px] font-medium border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] cursor-pointer"
                                >
                                  {t.pdfSelectAllPages}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => setSelectedPages([])}
                                  className="px-2 py-0.5 rounded-md text-[11.5px] font-medium border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#6B6A66] dark:text-[#9B9A97] cursor-pointer"
                                >
                                  {t.pdfClearPages}
                                </button>
                              </div>
                            </div>

                            {/* Clickable Page Pills */}
                            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5">
                              {Array.from({ length: pdfTotalPages }, (_, idx) => idx + 1).map(
                                (pageNum) => {
                                  const isSelected = selectedPages.includes(pageNum);
                                  const isViewing = activePreviewPage === pageNum;
                                  const isCropped = Boolean(croppedPagesMap[pageNum]);
                                  return (
                                    <button
                                      key={pageNum}
                                      type="button"
                                      disabled={isSubmitting}
                                      onClick={() => togglePageSelected(pageNum, true)}
                                      className={`relative min-w-[30px] h-7 px-2 rounded-md text-[12px] font-medium tabular-nums inline-flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'bg-indigo-600 text-white'
                                          : 'bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#363636] text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232]'
                                      } ${
                                        isViewing
                                          ? 'ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-[#202020]'
                                          : ''
                                      }`}
                                    >
                                      {isSelected && <Check className="w-2.5 h-2.5" />}
                                      <span>{pageNum}</span>
                                      {isCropped && (
                                        <span
                                          className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                                          title={t.croppedBadge}
                                        />
                                      )}
                                    </button>
                                  );
                                }
                              )}
                            </div>

                            {/* Quick Page Range Input for larger PDFs */}
                            {pdfTotalPages > 4 && (
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <input
                                  type="text"
                                  value={pageRangeDraft}
                                  disabled={isSubmitting}
                                  onChange={(e) => setPageRangeDraft(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleApplyPageRange();
                                    }
                                  }}
                                  placeholder={t.pdfPageRangePlaceholder}
                                  className="flex-1 h-7 px-2.5 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[12px]"
                                />
                                <button
                                  type="button"
                                  disabled={isSubmitting || !pageRangeDraft.trim()}
                                  onClick={handleApplyPageRange}
                                  className="h-7 px-2.5 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] disabled:opacity-40 text-[12px] font-medium text-[#262624] dark:text-[#ECECEA] cursor-pointer"
                                >
                                  {t.pdfApplyRange}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Import Mode Selector: Embed Original PDF vs Extract to Markdown (AI) */}
                {localFileKind !== 'image' && (
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
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <Sparkles
                              className={`w-4 h-4 shrink-0 ${
                                pdfImportMode === 'extract'
                                  ? 'text-indigo-600 dark:text-indigo-400'
                                  : 'text-[#6B6A66] dark:text-[#9B9A97]'
                              }`}
                            />
                            <span className="text-[13px] font-semibold text-[#262624] dark:text-[#ECECEA] truncate">
                              {t.pdfModeExtractTitle}
                            </span>
                          </div>
                          {croppedPagesCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-semibold shrink-0">
                              {croppedPagesCount} {t.croppedBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97] leading-snug">
                          {t.pdfModeExtractDesc}
                        </p>
                      </button>
                    </div>
                  </div>
                )}

                {/* Optional Document Title */}
                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.pdfCustomTitleLabel}
                  </label>
                  <input
                    type="text"
                    value={pdfTitleOverride}
                    onChange={(e) => setPdfTitleOverride(e.target.value)}
                    placeholder={t.pdfCustomTitlePlaceholder}
                    className="w-full min-h-[38px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[13.5px] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              </>
            )}

            {/* Live Progress Banner during multi-page extraction / OCR */}
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
                        onClick={() => setTags(tags.filter((x) => x !== tag))}
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

            {/* Auto-format Math/Chemistry KaTeX Checkbox (for Google Docs & Extract / Image OCR modes) */}
            {(activeTab === 'gdoc' || pdfImportMode === 'extract' || localFileKind === 'image') && (
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
                  activeTab === 'pdf'
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : 'bg-sky-600 hover:bg-sky-700'
                }`}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : activeTab === 'pdf' ? (
                  localFileKind === 'image' || pdfImportMode === 'extract' ? (
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
                    : activeTab === 'pdf'
                      ? localFileKind === 'image'
                        ? t.imageScanSubmit
                        : pdfImportMode === 'embed'
                          ? t.pdfImportEmbedSubmit
                          : t.pdfImportExtractSubmit
                      : t.gdocImportSubmit}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Interactive Freeform Crop Modal */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={
          localFileKind === 'image'
            ? croppedImage?.dataUrl || compressedImage?.dataUrl || ''
            : croppedPagesMap[activePreviewPage]?.dataUrl ||
              renderedPagesMap[activePreviewPage]?.dataUrl ||
              ''
        }
        title={cropModalTitle}
        onCancel={() => setCropModalOpen(false)}
        onConfirm={handleConfirmCrop}
        t={t}
      />
    </>,
    document.body
  );
}

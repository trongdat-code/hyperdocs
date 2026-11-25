/**
 * Client-Side Document & Image Processing Utility
 *
 * - Configures Vite-compatible `pdfjs-dist` worker via `new URL(..., import.meta.url)`
 * - Renders selected PDF pages onto HTML5 <canvas> at `scale: 2.0`
 * - Compresses & resizes images/canvases to max 1500px longest dimension, `#FFFFFF`
 *   background (avoiding black backgrounds on transparent PNGs), JPEG Base64 (`quality: 0.8`)
 * - Crops user-selected pixel regions (`cropImageByArea`) using the same compression pipeline
 */

export const MAX_IMAGE_DIMENSION = 1500;
export const JPEG_QUALITY = 0.8;
export const PDF_RENDER_SCALE = 2.0;

const PDF_WORKER_URL = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

let pdfjsModulePromise = null;

async function getPdfJs() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      return pdfjsLib;
    });
  }
  return pdfjsModulePromise;
}

export function isPdfFile(file) {
  if (!file) return false;
  return /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
}

export function isImageFile(file) {
  if (!file) return false;
  return (
    (typeof file.type === 'string' && file.type.startsWith('image/')) ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '')
  );
}

export function stripDataUrlPrefix(dataUrl) {
  const str = String(dataUrl || '');
  const commaIdx = str.indexOf(',');
  return commaIdx >= 0 ? str.slice(commaIdx + 1) : str;
}

export function estimateBase64ByteSize(base64) {
  if (!base64) return 0;
  const clean = stripDataUrlPrefix(base64);
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Load an image source (data URL, blob URL, or remote URL) into an HTMLImageElement.
 */
export function loadImageElement(imageSrc) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('Image decoding is only available in the browser.'));
      return;
    }
    const img = new Image();
    if (!/^data:|^blob:/i.test(String(imageSrc || ''))) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for processing.'));
    img.src = imageSrc;
  });
}

/**
 * Resize and compress any HTMLCanvasElement or HTMLImageElement:
 * - Scales down the longest dimension to a maximum of 1500px (never upscales)
 * - Fills the canvas background with `#FFFFFF` (prevents black fill on transparent PNGs)
 * - Exports as a JPEG Base64 data URL & raw Base64 payload (`quality: 0.8`)
 */
export function compressCanvasToJpeg(
  source,
  { maxDimension = MAX_IMAGE_DIMENSION, quality = JPEG_QUALITY } = {}
) {
  if (typeof document === 'undefined') {
    throw new Error('Canvas compression is only available in the browser.');
  }

  const srcWidth = source.naturalWidth || source.width || 1;
  const srcHeight = source.naturalHeight || source.height || 1;
  const longest = Math.max(srcWidth, srcHeight);
  const scale = longest > maxDimension ? maxDimension / longest : 1;

  const targetWidth = Math.max(1, Math.round(srcWidth * scale));
  const targetHeight = Math.max(1, Math.round(srcHeight * scale));

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = targetWidth;
  outputCanvas.height = targetHeight;

  const ctx = outputCanvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  const dataUrl = outputCanvas.toDataURL('image/jpeg', quality);
  const base64 = stripDataUrlPrefix(dataUrl);

  // Release GPU/canvas backing store promptly
  outputCanvas.width = 0;
  outputCanvas.height = 0;

  return {
    dataUrl,
    base64,
    mimeType: 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
    byteSize: estimateBase64ByteSize(base64),
  };
}

/**
 * Compress an image URL / data URL into a standardized JPEG payload.
 */
export async function compressImageSource(imageSrc, options = {}) {
  const img = await loadImageElement(imageSrc);
  return compressCanvasToJpeg(img, options);
}

/**
 * Compress a user-uploaded image File/Blob client-side before previewing or sending to Gemini Vision.
 */
export async function compressImageFile(file, options = {}) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await compressImageSource(objectUrl, options);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Crop an image by pixel coordinates (`{ x, y, width, height }`) on an HTML5 <canvas>
 * and compress the result using the standard 1500px / `#FFFFFF` / JPEG 0.8 pipeline.
 */
export async function cropImageByArea(
  imageSrc,
  pixelCrop,
  { maxDimension = MAX_IMAGE_DIMENSION, quality = JPEG_QUALITY } = {}
) {
  if (typeof document === 'undefined') {
    throw new Error('Canvas cropping is only available in the browser.');
  }

  const img = await loadImageElement(imageSrc);
  const naturalWidth = img.naturalWidth || img.width || 1;
  const naturalHeight = img.naturalHeight || img.height || 1;

  const rawX = Number(pixelCrop?.x) || 0;
  const rawY = Number(pixelCrop?.y) || 0;
  const rawWidth = Number(pixelCrop?.width) || naturalWidth;
  const rawHeight = Number(pixelCrop?.height) || naturalHeight;

  const sx = Math.min(Math.max(0, Math.round(rawX)), naturalWidth - 1);
  const sy = Math.min(Math.max(0, Math.round(rawY)), naturalHeight - 1);
  const sw = Math.max(1, Math.min(Math.round(rawWidth), naturalWidth - sx));
  const sh = Math.max(1, Math.min(Math.round(rawHeight), naturalHeight - sy));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = sw;
  cropCanvas.height = sh;

  const ctx = cropCanvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  try {
    return compressCanvasToJpeg(cropCanvas, { maxDimension, quality });
  } finally {
    cropCanvas.width = 0;
    cropCanvas.height = 0;
  }
}

/**
 * Load a PDF File/Blob/ArrayBuffer/Uint8Array with `pdfjs-dist` using the Vite worker.
 */
export async function loadPdfDocument(fileOrData) {
  const pdfjsLib = await getPdfJs();

  let data;
  if (fileOrData instanceof Uint8Array) {
    data = fileOrData;
  } else if (fileOrData instanceof ArrayBuffer) {
    data = new Uint8Array(fileOrData);
  } else if (typeof fileOrData?.arrayBuffer === 'function') {
    const buffer = await fileOrData.arrayBuffer();
    data = new Uint8Array(buffer);
  } else {
    throw new Error('Unsupported PDF input source.');
  }

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdfDoc = await loadingTask.promise;

  return {
    pdfDoc,
    numPages: pdfDoc.numPages,
  };
}

/**
 * Render a single PDF page onto an HTML5 <canvas> at `scale: 2.0`,
 * then resize & compress to max 1500px JPEG (`quality: 0.8`) with `#FFFFFF` background.
 */
export async function renderPdfPageToCompressedImage(
  pdfDoc,
  pageNumber,
  {
    scale = PDF_RENDER_SCALE,
    maxDimension = MAX_IMAGE_DIMENSION,
    quality = JPEG_QUALITY,
  } = {}
) {
  if (typeof document === 'undefined') {
    throw new Error('Canvas rendering is only available in the browser.');
  }

  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = Math.max(1, Math.round(viewport.width));
  renderCanvas.height = Math.max(1, Math.round(viewport.height));

  const ctx = renderCanvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);

  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
    const compressed = compressCanvasToJpeg(renderCanvas, { maxDimension, quality });
    return {
      pageNumber,
      ...compressed,
    };
  } finally {
    renderCanvas.width = 0;
    renderCanvas.height = 0;
    try {
      page.cleanup?.();
    } catch {
      // Ignore cleanup errors on already-destroyed pages
    }
  }
}

/**
 * Render & compress a list of selected PDF pages at `scale: 2.0` with live progress callback.
 */
export async function extractPdfPages(
  source,
  pageNumbers,
  {
    scale = PDF_RENDER_SCALE,
    maxDimension = MAX_IMAGE_DIMENSION,
    quality = JPEG_QUALITY,
    onProgress,
  } = {}
) {
  let pdfDoc = source;
  let shouldDestroy = false;

  if (!source || typeof source.getPage !== 'function') {
    const loaded = await loadPdfDocument(source);
    pdfDoc = loaded.pdfDoc;
    shouldDestroy = true;
  }

  try {
    const totalPdfPages = pdfDoc.numPages;
    const requested =
      Array.isArray(pageNumbers) && pageNumbers.length > 0
        ? pageNumbers
        : Array.from({ length: totalPdfPages }, (_, idx) => idx + 1);

    const validPages = Array.from(
      new Set(
        requested
          .map((n) => Math.floor(Number(n)))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= totalPdfPages)
      )
    ).sort((a, b) => a - b);

    const results = [];
    for (let i = 0; i < validPages.length; i++) {
      const pageNumber = validPages[i];
      onProgress?.({
        current: i + 1,
        total: validPages.length,
        pageNumber,
      });
      const rendered = await renderPdfPageToCompressedImage(pdfDoc, pageNumber, {
        scale,
        maxDimension,
        quality,
      });
      results.push(rendered);
    }

    return results;
  } finally {
    if (shouldDestroy) {
      try {
        await pdfDoc.destroy?.();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Parse a human-friendly page range string (e.g. "1-3, 5, 8-10") into sorted valid page numbers.
 */
export function parsePageSelectionInput(rawInput, totalPages) {
  const maxPage = Math.max(1, Number(totalPages) || 1);
  const str = String(rawInput || '').trim();
  if (!str) return [];

  const selected = new Set();
  const segments = str.split(/[,;\s]+/).filter(Boolean);

  for (const seg of segments) {
    const rangeMatch = seg.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = Math.max(1, Math.min(maxPage, Number(rangeMatch[1])));
      const end = Math.max(1, Math.min(maxPage, Number(rangeMatch[2])));
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      for (let p = low; p <= high; p++) selected.add(p);
      continue;
    }

    const single = Number(seg);
    if (Number.isInteger(single) && single >= 1 && single <= maxPage) {
      selected.add(single);
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import {
  Crop,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  Loader2,
} from 'lucide-react';
import { cropImageByArea } from '../utils/documentProcessor';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const MIN_CROP_BOX = 56;
const VIEWPORT_PADDING = 20;

const HANDLE_CONFIGS = [
  { id: 'nw', cursor: 'nwse-resize', dx: -1, dy: -1, pos: '-top-2 -left-2 w-4 h-4 rounded-full' },
  { id: 'ne', cursor: 'nesw-resize', dx: 1, dy: -1, pos: '-top-2 -right-2 w-4 h-4 rounded-full' },
  { id: 'sw', cursor: 'nesw-resize', dx: -1, dy: 1, pos: '-bottom-2 -left-2 w-4 h-4 rounded-full' },
  { id: 'se', cursor: 'nwse-resize', dx: 1, dy: 1, pos: '-bottom-2 -right-2 w-4 h-4 rounded-full' },
  { id: 'n', cursor: 'ns-resize', dx: 0, dy: -1, pos: '-top-1.5 left-1/2 -translate-x-1/2 w-9 h-3 rounded-full' },
  { id: 's', cursor: 'ns-resize', dx: 0, dy: 1, pos: '-bottom-1.5 left-1/2 -translate-x-1/2 w-9 h-3 rounded-full' },
  { id: 'w', cursor: 'ew-resize', dx: -1, dy: 0, pos: 'top-1/2 -left-1.5 -translate-y-1/2 w-3 h-9 rounded-full' },
  { id: 'e', cursor: 'ew-resize', dx: 1, dy: 0, pos: 'top-1/2 -right-1.5 -translate-y-1/2 w-3 h-9 rounded-full' },
];

export default function ImageCropModal({
  isOpen,
  imageSrc,
  title,
  onCancel,
  onConfirm,
  t,
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropSize, setCropSize] = useState(null);
  const [mediaSize, setMediaSize] = useState(null);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [cropError, setCropError] = useState('');

  const viewportRef = useRef(null);
  const dragStateRef = useRef(null);

  // Reset cropper state whenever modal opens with a new image
  useEffect(() => {
    if (!isOpen) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropSize(null);
    setMediaSize(null);
    setCroppedAreaPixels(null);
    setIsApplying(false);
    setCropError('');
  }, [isOpen, imageSrc]);

  // Escape key closes modal safely
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isApplying) {
        e.stopPropagation();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isApplying, onCancel]);

  const getBoundsForZoom = useCallback(
    (targetZoom, currentMedia = mediaSize) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const containerW = rect ? Math.max(MIN_CROP_BOX, rect.width - VIEWPORT_PADDING) : 500;
      const containerH = rect ? Math.max(MIN_CROP_BOX, rect.height - VIEWPORT_PADDING) : 400;

      if (!currentMedia || !currentMedia.width || !currentMedia.height) {
        return { maxW: containerW, maxH: containerH };
      }

      const maxW = Math.max(
        MIN_CROP_BOX,
        Math.min(containerW, Math.floor(currentMedia.width * targetZoom))
      );
      const maxH = Math.max(
        MIN_CROP_BOX,
        Math.min(containerH, Math.floor(currentMedia.height * targetZoom))
      );
      return { maxW, maxH };
    },
    [mediaSize]
  );

  // Clamp cropSize whenever zoom decreases so the crop box never exceeds the zoomed image
  useEffect(() => {
    if (!cropSize || !mediaSize) return;
    const { maxW, maxH } = getBoundsForZoom(zoom, mediaSize);
    if (cropSize.width > maxW || cropSize.height > maxH) {
      setCropSize({
        width: Math.max(MIN_CROP_BOX, Math.min(cropSize.width, maxW)),
        height: Math.max(MIN_CROP_BOX, Math.min(cropSize.height, maxH)),
      });
    }
  }, [zoom, mediaSize, cropSize, getBoundsForZoom]);

  const handleMediaLoaded = useCallback(
    (loadedMedia) => {
      setMediaSize(loadedMedia);
      const { maxW, maxH } = getBoundsForZoom(1, loadedMedia);
      // Initialize to ~92% of the visible page so freeform margins are immediately clear
      setCropSize({
        width: Math.max(MIN_CROP_BOX, Math.round(maxW * 0.92)),
        height: Math.max(MIN_CROP_BOX, Math.round(maxH * 0.92)),
      });
    },
    [getBoundsForZoom]
  );

  const handleCropMetrics = useCallback((_croppedArea, pixels) => {
    if (pixels && pixels.width > 0 && pixels.height > 0) {
      setCroppedAreaPixels(pixels);
    }
  }, []);

  const applyPreset = (preset) => {
    if (!mediaSize) return;
    const { maxW, maxH } = getBoundsForZoom(zoom, mediaSize);
    if (preset === 'full') {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      const fullBounds = getBoundsForZoom(1, mediaSize);
      setCropSize({
        width: Math.max(MIN_CROP_BOX, Math.round(fullBounds.maxW * 0.96)),
        height: Math.max(MIN_CROP_BOX, Math.round(fullBounds.maxH * 0.96)),
      });
    } else if (preset === 'half') {
      setCropSize({
        width: Math.max(MIN_CROP_BOX, Math.round(maxW * 0.94)),
        height: Math.max(MIN_CROP_BOX, Math.round(maxH * 0.52)),
      });
    } else if (preset === 'strip') {
      setCropSize({
        width: Math.max(MIN_CROP_BOX, Math.round(maxW * 0.94)),
        height: Math.max(MIN_CROP_BOX, Math.round(maxH * 0.28)),
      });
    }
  };

  // Pointer drag handlers for freeform corner & edge resizing
  const handleResizePointerDown = (e, handle) => {
    if (!cropSize) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: cropSize.width,
      startHeight: cropSize.height,
      dx: handle.dx,
      dy: handle.dy,
    };
  };

  const handleResizePointerMove = (e) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    e.preventDefault();

    const { maxW, maxH } = getBoundsForZoom(zoom);
    const deltaX = (e.clientX - drag.startX) * drag.dx * 2;
    const deltaY = (e.clientY - drag.startY) * drag.dy * 2;

    const nextWidth =
      drag.dx !== 0
        ? Math.round(Math.min(maxW, Math.max(MIN_CROP_BOX, drag.startWidth + deltaX)))
        : drag.startWidth;
    const nextHeight =
      drag.dy !== 0
        ? Math.round(Math.min(maxH, Math.max(MIN_CROP_BOX, drag.startHeight + deltaY)))
        : drag.startHeight;

    setCropSize({ width: nextWidth, height: nextHeight });
  };

  const handleResizePointerUp = (e) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragStateRef.current = null;
  };

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels || isApplying) return;
    setIsApplying(true);
    setCropError('');
    try {
      const result = await cropImageByArea(imageSrc, croppedAreaPixels);
      onConfirm?.(result);
    } catch (err) {
      setCropError(err?.message || 'Failed to crop selected region.');
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen || !imageSrc || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="hd-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-3 sm:p-5"
      onClick={() => !isApplying && onCancel?.()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hd-modal-in w-full max-w-3xl max-h-[92dvh] flex flex-col rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl overflow-hidden"
      >
        {/* Minimal Notion-style Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F] shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/12 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Crop className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] truncate">
                {title || t?.cropModalTitle || 'Crop Selection'}
              </h3>
              <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] truncate">
                {t?.cropModalHint || 'Drag handles to resize freely, or pan & zoom the page'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isApplying}
            onClick={onCancel}
            aria-label={t?.cancel || 'Cancel'}
            className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Interactive Crop Canvas Area */}
        <div
          ref={viewportRef}
          className="relative w-full h-[54dvh] min-h-[300px] max-h-[540px] bg-[#161615] dark:bg-[#141414] overflow-hidden select-none"
        >
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            aspect={undefined}
            cropSize={cropSize || undefined}
            objectFit="contain"
            showGrid={true}
            restrictPosition={true}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onMediaLoaded={handleMediaLoaded}
            onCropComplete={handleCropMetrics}
            onCropAreaChange={handleCropMetrics}
            style={{
              cropAreaStyle: {
                border: '1.5px solid rgba(255, 255, 255, 0.92)',
                boxShadow: '0 0 0 9999em rgba(0, 0, 0, 0.56)',
              },
            }}
          />

          {/* Freeform Resize Handles synced to centered cropSize */}
          {cropSize && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
              <div
                style={{ width: cropSize.width, height: cropSize.height }}
                className="relative pointer-events-none"
              >
                {HANDLE_CONFIGS.map((handle) => (
                  <div
                    key={handle.id}
                    role="slider"
                    aria-label={`Resize ${handle.id}`}
                    style={{ cursor: handle.cursor, touchAction: 'none' }}
                    onPointerDown={(e) => handleResizePointerDown(e, handle)}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerUp}
                    onPointerCancel={handleResizePointerUp}
                    className={`pointer-events-auto absolute ${handle.pos} bg-white dark:bg-[#ECECEA] border-2 border-indigo-600 shadow-md hover:scale-110 transition-transform`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Controls Strip: Freeform Presets + Zoom Slider (1x-3x) */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Quick Shape Presets (still freely resizable afterwards) */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isApplying || !mediaSize}
                onClick={() => applyPreset('full')}
                className="h-7 px-2.5 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[12px] font-medium text-[#262624] dark:text-[#ECECEA] cursor-pointer transition-colors"
              >
                {t?.cropPresetFull || 'Full Page'}
              </button>
              <button
                type="button"
                disabled={isApplying || !mediaSize}
                onClick={() => applyPreset('half')}
                className="h-7 px-2.5 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[12px] font-medium text-[#262624] dark:text-[#ECECEA] cursor-pointer transition-colors"
              >
                {t?.cropPresetHalf || 'Half A4'}
              </button>
              <button
                type="button"
                disabled={isApplying || !mediaSize}
                onClick={() => applyPreset('strip')}
                className="h-7 px-2.5 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[12px] font-medium text-[#262624] dark:text-[#ECECEA] cursor-pointer transition-colors"
              >
                {t?.cropPresetStrip || 'Question Strip'}
              </button>
              <button
                type="button"
                disabled={isApplying || !mediaSize}
                onClick={() => applyPreset('full')}
                title={t?.cropReset || 'Reset'}
                className="h-7 px-2 rounded-md border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[12px] text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA] inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Zoom Range Slider (1x–3x) */}
            <div className="flex items-center gap-2.5 sm:min-w-[230px]">
              <span className="text-[12px] font-medium text-[#6B6A66] dark:text-[#9B9A97] shrink-0">
                {t?.cropZoomLabel || 'Zoom'}
              </span>
              <button
                type="button"
                disabled={isApplying || zoom <= MIN_ZOOM}
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Number((z - 0.2).toFixed(2))))}
                aria-label={t?.zoomOut || 'Zoom Out'}
                className="p-1 rounded-md text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#E8E8E5] dark:hover:bg-[#323232] disabled:opacity-35 cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.05}
                value={zoom}
                disabled={isApplying}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label={t?.cropZoomLabel || 'Zoom'}
                className="flex-1 h-1.5 accent-indigo-600 cursor-pointer"
              />
              <button
                type="button"
                disabled={isApplying || zoom >= MAX_ZOOM}
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Number((z + 0.2).toFixed(2))))}
                aria-label={t?.zoomIn || 'Zoom In'}
                className="p-1 rounded-md text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#E8E8E5] dark:hover:bg-[#323232] disabled:opacity-35 cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-[12px] font-medium tabular-nums text-[#262624] dark:text-[#ECECEA] w-9 text-right shrink-0">
                {zoom.toFixed(1)}x
              </span>
            </div>
          </div>

          {cropError && (
            <p className="text-[12.5px] text-rose-600 dark:text-rose-400">{cropError}</p>
          )}

          {/* Footer Action Buttons */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97] tabular-nums">
              {croppedAreaPixels
                ? `${Math.round(croppedAreaPixels.width)} × ${Math.round(croppedAreaPixels.height)} px`
                : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={onCancel}
                className="min-h-[38px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] text-[#262624] dark:text-[#ECECEA] text-[13.5px] font-medium cursor-pointer transition-colors duration-150"
              >
                {t?.cancel || 'Cancel'}
              </button>
              <button
                type="button"
                disabled={isApplying || !croppedAreaPixels}
                onClick={handleConfirm}
                className="min-h-[38px] px-4 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] disabled:opacity-50 text-[13.5px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
              >
                {isApplying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>{t?.cropConfirm || 'Confirm Crop'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

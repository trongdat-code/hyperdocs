import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Palette, X } from 'lucide-react';

export const STICKY_NOTE_COLORS = [
  // Light pastel swatches
  { id: 'yellow', hex: '#FEF9C3', text: '#262624', border: '#EAB308', isDark: false, label: 'Soft Yellow' },
  { id: 'mint', hex: '#DCFCE7', text: '#1F2937', border: '#22C55E', isDark: false, label: 'Mint Green' },
  { id: 'sky', hex: '#DBEAFE', text: '#1E293B', border: '#3B82F6', isDark: false, label: 'Sky Blue' },
  { id: 'rose', hex: '#FCE7F3', text: '#262624', border: '#EC4899', isDark: false, label: 'Rose Pink' },
  { id: 'lavender', hex: '#F3E8FF', text: '#262624', border: '#A855F7', isDark: false, label: 'Lavender' },
  { id: 'neutral', hex: '#F4F4F5', text: '#18181B', border: '#A1A1AA', isDark: false, label: 'Clean Neutral' },
  // Rich, low-glare dark-mode swatches
  { id: 'charcoal', hex: '#27272A', text: '#F4F4F5', border: '#3F3F46', isDark: true, label: 'Dark Slate' },
  { id: 'midnight', hex: '#1E293B', text: '#E2E8F0', border: '#334155', isDark: true, label: 'Deep Midnight Blue' },
  { id: 'forest', hex: '#143326', text: '#DCFCE7', border: '#1E4D3B', isDark: true, label: 'Dark Forest Green' },
  { id: 'espresso', hex: '#3B2818', text: '#FEF3C7', border: '#573B24', isDark: true, label: 'Deep Amber' },
  { id: 'plum', hex: '#361D2E', text: '#FCE7F3', border: '#522B45', isDark: true, label: 'Dark Plum' },
];

const LIGHT_SWATCHES = STICKY_NOTE_COLORS.filter((c) => !c.isDark);
const DARK_SWATCHES = STICKY_NOTE_COLORS.filter((c) => c.isDark);

const MIN_WIDTH = 210;
const MAX_WIDTH = 560;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 540;

function getStickyTheme(hex) {
  const match = STICKY_NOTE_COLORS.find(
    (c) => c.hex.toUpperCase() === String(hex || '').toUpperCase()
  );
  if (match) return match;
  return STICKY_NOTE_COLORS[0];
}

/**
 * Free-moving, draggable & resizable Sticky Notes overlay bound inside the Note canvas.
 *
 * Persists `{ id, title, content, x, y, width, height, color }` on the parent document
 * so notes sync automatically to IndexedDB/localStorage and Supabase `user_workspaces`.
 *
 * On `@media print`, CSS switches `.hd-sticky-layer` to a clean static black-and-white grid
 * with `#ffffff` background, thin `#000000` border, and `#000000` ink.
 */
export default function StickyNoteLayer({
  notes = [],
  visible = true,
  canvasRef,
  onUpdateNote,
  onDeleteNote,
  t,
}) {
  const [activeId, setActiveId] = useState(null);
  const [openColorId, setOpenColorId] = useState(null);
  const [liveGeometry, setLiveGeometry] = useState(null); // { id, x, y, width, height }
  const interactionRef = useRef(null);

  useEffect(() => {
    if (!openColorId) return;
    const onDown = (e) => {
      if (!e.target.closest?.('[data-sticky-color-menu]')) {
        setOpenColorId(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openColorId]);

  if (!Array.isArray(notes) || notes.length === 0) return null;

  const getCanvasBounds = () => {
    const el = canvasRef?.current;
    if (!el) return { maxWidth: 1200, maxHeight: 2400 };
    return {
      maxWidth: Math.max(el.clientWidth, el.scrollWidth, 340),
      maxHeight: Math.max(el.clientHeight, el.scrollHeight, 600),
    };
  };

  const handleDragPointerDown = (e, note) => {
    // Do not start dragging if user clicked an interactive control or title input
    if (
      e.target.closest('button') ||
      e.target.closest('input') ||
      e.target.closest('textarea')
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setActiveId(note.id);
    setOpenColorId(null);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = Number(note.x) || 24;
    const origY = Number(note.y) || 24;
    const width = Number(note.width) || 260;
    const height = Number(note.height) || 200;

    interactionRef.current = {
      type: 'drag',
      pointerId: e.pointerId,
      id: note.id,
      startX,
      startY,
      origX,
      origY,
      width,
      height,
      latest: { x: origX, y: origY, width, height },
    };

    e.currentTarget.setPointerCapture?.(e.pointerId);
    setLiveGeometry({ id: note.id, x: origX, y: origY, width, height });
  };

  const handleResizePointerDown = (e, note) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveId(note.id);
    setOpenColorId(null);

    const startX = e.clientX;
    const startY = e.clientY;
    const origX = Number(note.x) || 24;
    const origY = Number(note.y) || 24;
    const origW = Number(note.width) || 260;
    const origH = Number(note.height) || 200;

    interactionRef.current = {
      type: 'resize',
      pointerId: e.pointerId,
      id: note.id,
      startX,
      startY,
      origX,
      origY,
      origW,
      origH,
      latest: { x: origX, y: origY, width: origW, height: origH },
    };

    e.currentTarget.setPointerCapture?.(e.pointerId);
    setLiveGeometry({ id: note.id, x: origX, y: origY, width: origW, height: origH });
  };

  const handlePointerMove = (e) => {
    const state = interactionRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const { maxWidth } = getCanvasBounds();

    if (state.type === 'drag') {
      const nextX = Math.round(Math.min(Math.max(8, state.origX + dx), Math.max(8, maxWidth - state.width - 8)));
      const nextY = Math.round(Math.max(8, state.origY + dy));
      state.latest = { x: nextX, y: nextY, width: state.width, height: state.height };
      setLiveGeometry({ id: state.id, ...state.latest });
    } else if (state.type === 'resize') {
      const maxAllowedW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, maxWidth - state.origX - 12));
      const nextW = Math.round(Math.min(maxAllowedW, Math.max(MIN_WIDTH, state.origW + dx)));
      const nextH = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, state.origH + dy)));
      state.latest = { x: state.origX, y: state.origY, width: nextW, height: nextH };
      setLiveGeometry({ id: state.id, ...state.latest });
    }
  };

  const handlePointerUp = (e) => {
    const state = interactionRef.current;
    if (!state || state.pointerId !== e.pointerId) return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const { id, latest } = state;
    interactionRef.current = null;
    setLiveGeometry(null);

    onUpdateNote(id, {
      x: latest.x,
      y: latest.y,
      width: latest.width,
      height: latest.height,
    });
  };

  return (
    <div
      className={`hd-sticky-layer pointer-events-none absolute inset-0 z-20 ${
        visible ? '' : 'hidden print:block'
      }`}
    >
      <p className="hidden print:block col-span-2 text-[11pt] font-bold uppercase tracking-wider text-black border-b border-black pb-1 mb-2">
        {t.stickyNotesPrintHeading}
      </p>

      {notes.map((note, idx) => {
        const isLive = liveGeometry && liveGeometry.id === note.id;
        const x = isLive ? liveGeometry.x : Number(note.x) || 24;
        const y = isLive ? liveGeometry.y : Number(note.y) || 24;
        const width = isLive ? liveGeometry.width : Number(note.width) || 260;
        const height = isLive ? liveGeometry.height : Number(note.height) || 200;
        const bgHex = note.color || '#FEF9C3';
        const theme = getStickyTheme(bgHex);
        const isDarkSwatch = theme.isDark;
        const isActive = activeId === note.id;

        return (
          <div
            key={note.id}
            onMouseDown={() => setActiveId(note.id)}
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: `${width}px`,
              height: `${height}px`,
              backgroundColor: bgHex,
              color: theme.text,
              borderColor: isDarkSwatch ? theme.border : `${theme.border}66`,
              zIndex: isActive ? 35 : 20 + idx,
            }}
            className="hd-sticky-card pointer-events-auto absolute rounded-xl border shadow-lg hover:shadow-xl transition-shadow duration-150 flex flex-col select-none font-sans"
          >
            {/* Draggable Header Bar with Inline Editable Title, Color Picker & Delete */}
            <div
              onPointerDown={(e) => handleDragPointerDown(e, note)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`hd-sticky-header px-2.5 py-2 border-b flex items-center gap-1.5 cursor-grab active:cursor-grabbing shrink-0 rounded-t-xl touch-none ${
                isDarkSwatch ? 'border-white/12' : 'border-black/10'
              }`}
            >
              <GripHorizontal
                className={`no-print w-3.5 h-3.5 shrink-0 ${
                  isDarkSwatch ? 'text-white/55' : 'text-[#555552]/75'
                }`}
              />

              <input
                type="text"
                value={note.title ?? ''}
                onChange={(e) => onUpdateNote(note.id, { title: e.target.value })}
                placeholder={t.stickyNoteTitlePlaceholder}
                aria-label={t.stickyNoteTitlePlaceholder}
                style={{ color: theme.text }}
                className={`no-print flex-1 min-w-0 bg-transparent text-[13px] font-semibold focus:outline-none truncate ${
                  isDarkSwatch ? 'placeholder:text-white/45' : 'placeholder:text-[#6B6A66]/75'
                }`}
              />
              <span className="hidden print:block font-bold text-[10.5pt] text-black">
                {note.title || t.stickyNoteDefaultTitle}
              </span>

              <div className="no-print relative flex items-center gap-0.5 shrink-0" data-sticky-color-menu>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenColorId((prev) => (prev === note.id ? null : note.id));
                  }}
                  title={t.stickyNoteColorLabel}
                  aria-label={t.stickyNoteColorLabel}
                  className={`p-1 rounded-md cursor-pointer transition-colors ${
                    isDarkSwatch
                      ? 'text-white/75 hover:text-white hover:bg-white/12'
                      : 'text-[#555552] hover:text-[#191919] hover:bg-black/10'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteNote(note.id);
                  }}
                  title={t.deleteStickyNote}
                  aria-label={t.deleteStickyNote}
                  className={`p-1 rounded-md cursor-pointer transition-colors ${
                    isDarkSwatch
                      ? 'text-white/75 hover:text-rose-300 hover:bg-white/12'
                      : 'text-[#555552] hover:text-rose-700 hover:bg-black/10'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                {openColorId === note.id && (
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    className="hd-modal-in absolute right-0 top-8 z-50 p-2.5 rounded-xl bg-[#FFFFFF] dark:bg-[#202020] border border-[#E4E4E7] dark:border-[#3A3A3A] shadow-xl space-y-2 w-[204px]"
                  >
                    <div className="flex items-center gap-1.5">
                      {LIGHT_SWATCHES.map((swatch) => {
                        const isSelected = swatch.hex.toUpperCase() === bgHex.toUpperCase();
                        return (
                          <button
                            key={swatch.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateNote(note.id, { color: swatch.hex });
                              setOpenColorId(null);
                            }}
                            title={swatch.label}
                            aria-label={swatch.label}
                            style={{ backgroundColor: swatch.hex }}
                            className={`w-6 h-6 rounded-full border cursor-pointer transition-transform hover:scale-110 ${
                              isSelected
                                ? 'border-[#111111] ring-2 ring-[#2563EB]'
                                : 'border-black/20'
                            }`}
                          />
                        );
                      })}
                    </div>
                    <div className="pt-1.5 border-t border-[#E4E4E7] dark:border-[#323232] flex items-center gap-1.5">
                      {DARK_SWATCHES.map((swatch) => {
                        const isSelected = swatch.hex.toUpperCase() === bgHex.toUpperCase();
                        return (
                          <button
                            key={swatch.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateNote(note.id, { color: swatch.hex });
                              setOpenColorId(null);
                            }}
                            title={swatch.label}
                            aria-label={swatch.label}
                            style={{ backgroundColor: swatch.hex, borderColor: swatch.border }}
                            className={`w-6 h-6 rounded-full border cursor-pointer transition-transform hover:scale-110 ${
                              isSelected ? 'ring-2 ring-[#2563EB] dark:ring-[#60A5FA]' : ''
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Editable Sticky Note Body */}
            <textarea
              value={note.content ?? ''}
              onChange={(e) => onUpdateNote(note.id, { content: e.target.value })}
              placeholder={t.stickyNoteBodyPlaceholder}
              aria-label={note.title || t.stickyNoteDefaultTitle}
              style={{ color: theme.text }}
              className={`no-print flex-1 w-full min-h-0 p-3 bg-transparent text-[13.5px] leading-relaxed resize-none focus:outline-none select-text ${
                isDarkSwatch ? 'placeholder:text-white/40' : 'placeholder:text-[#6B6A66]/70'
              }`}
            />
            <div className="hidden print:block p-2 text-[10pt] leading-relaxed text-black whitespace-pre-wrap break-words">
              {note.content || ''}
            </div>

            {/* Bottom-Right Custom Resize Corner Handle */}
            <div
              onPointerDown={(e) => handleResizePointerDown(e, note)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              title="Resize"
              className="no-print absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-1 touch-none opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path
                  d="M9 1L1 9M9 5L5 9"
                  stroke={isDarkSwatch ? '#D4D4D8' : '#3F3F3C'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}

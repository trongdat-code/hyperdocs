import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tag, Plus, Pencil, Trash2, Check, X, Lock } from 'lucide-react';
import { isSystemTag } from '../../services/storageService';

/**
 * Centralized Tag Manager Modal ("Tạo nhãn" / "Create Tag").
 * Single source of truth for creating, renaming, and deleting workspace tags
 * while preserving system tags (`Notes`, `PDF`).
 */
export default function TagManagerModal({
  isOpen,
  onClose,
  customTags = [],
  documents = [],
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  t,
}) {
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setNewTagName('');
    setEditingTag(null);
    setRenameDraft('');
    setErrorText('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (editingTag) {
          setEditingTag(null);
          setRenameDraft('');
          setErrorText('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, editingTag, onClose]);

  const usageCountMap = useMemo(() => {
    const counts = new Map();
    documents.forEach((doc) => {
      (doc.tags || []).forEach((tg) => {
        const key = String(tg || '').trim().toLowerCase();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return counts;
  }, [documents]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    const clean = newTagName.trim();
    if (!clean) return;
    const exists = customTags.some((tg) => tg.toLowerCase() === clean.toLowerCase());
    if (exists) {
      setErrorText(t.tagAlreadyExists);
      return;
    }
    onCreateTag(clean);
    setNewTagName('');
    setErrorText('');
  };

  const startRename = (tag) => {
    setEditingTag(tag);
    setRenameDraft(tag);
    setErrorText('');
  };

  const commitRename = (oldTag) => {
    const clean = renameDraft.trim();
    if (!clean || clean === oldTag) {
      setEditingTag(null);
      setRenameDraft('');
      setErrorText('');
      return;
    }
    const conflict = customTags.some(
      (tg) => tg !== oldTag && tg.toLowerCase() === clean.toLowerCase()
    );
    if (conflict) {
      setErrorText(t.tagAlreadyExists);
      return;
    }
    onRenameTag(oldTag, clean);
    setEditingTag(null);
    setRenameDraft('');
    setErrorText('');
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.tagManagerTitle}
      className="hd-fade-in no-print fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="hd-modal-in w-full max-w-md rounded-2xl bg-[#FFFFFF] dark:bg-[#242424] border border-[#E8E8E5] dark:border-[#343434] shadow-2xl overflow-hidden flex flex-col max-h-[85dvh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E8E8E5] dark:border-[#323232] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#F4F4F5] dark:bg-[#2E2E2E] text-[#18181B] dark:text-[#E4E4E7] flex items-center justify-center shrink-0">
              <Tag className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[16px] text-[#18181B] dark:text-[#ECECEA] leading-tight">
                {t.tagManagerTitle}
              </h3>
              <p className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97] truncate">
                {t.tagManagerSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="p-1.5 rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#18181B] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Create New Tag Form */}
        <form
          onSubmit={handleCreateSubmit}
          className="px-5 py-3.5 border-b border-[#E8E8E5] dark:border-[#323232] bg-[#FBFBFA] dark:bg-[#202020] shrink-0 space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={newTagName}
              onChange={(e) => {
                setNewTagName(e.target.value);
                if (errorText) setErrorText('');
              }}
              placeholder={t.newTagPlaceholder}
              className="flex-1 min-h-[38px] px-3 rounded-lg border border-[#D4D4D8] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13.5px] text-[#18181B] dark:text-[#ECECEA] placeholder:text-[#9B9A97] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/35"
            />
            <button
              type="submit"
              disabled={!newTagName.trim()}
              className="min-h-[38px] px-3.5 rounded-lg bg-[#111111] hover:bg-[#27272A] disabled:opacity-45 text-[#FFFFFF] border border-[#3F3F46] text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t.createTagBtn}</span>
            </button>
          </div>
          {errorText && (
            <p className="text-[12px] text-rose-600 dark:text-rose-400 font-medium">{errorText}</p>
          )}
        </form>

        {/* Master Tag List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {customTags.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[#6B6A66] dark:text-[#9B9A97]">
              {t.noTagsCreatedYet}
            </p>
          ) : (
            customTags.map((tag) => {
              const locked = isSystemTag(tag);
              const isEditing = editingTag === tag;
              const docCount = usageCountMap.get(tag.toLowerCase()) || 0;

              return (
                <div
                  key={tag}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-[#E8E8E5] dark:border-[#323232] bg-[#FFFFFF] dark:bg-[#1E1E1E] hover:border-[#D4D4D8] dark:hover:border-[#3F3F46] transition-colors"
                >
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => {
                          setRenameDraft(e.target.value);
                          if (errorText) setErrorText('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename(tag);
                          } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setEditingTag(null);
                            setRenameDraft('');
                            setErrorText('');
                          }
                        }}
                        className="flex-1 min-w-0 h-8 px-2.5 rounded-lg border border-[#2563EB] bg-[#FFFFFF] dark:bg-[#191919] text-[13px] text-[#18181B] dark:text-[#ECECEA] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitRename(tag)}
                        title={t.save}
                        aria-label={t.save}
                        className="h-8 w-8 rounded-lg bg-[#111111] hover:bg-[#27272A] text-white inline-flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTag(null);
                          setRenameDraft('');
                          setErrorText('');
                        }}
                        title={t.cancel}
                        aria-label={t.cancel}
                        className="h-8 w-8 rounded-lg text-[#6B6A66] hover:bg-[#F3F3F1] dark:hover:bg-[#2E2E2E] inline-flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Tag className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
                        <span className="text-[13.5px] font-medium text-[#18181B] dark:text-[#ECECEA] truncate">
                          {tag}
                        </span>
                        {locked && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F4F4F5] dark:bg-[#2E2E2E] text-[#71717A] dark:text-[#A1A1AA] text-[10.5px] font-medium shrink-0">
                            <Lock className="w-2.5 h-2.5" />
                            <span>{t.systemTagBadge}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          title={t.docCount(docCount)}
                          className="px-2 py-0.5 rounded-full bg-[#F4F4F5] dark:bg-[#2A2A2A] text-[#71717A] dark:text-[#A1A1AA] text-[11px] font-medium tabular-nums"
                        >
                          {docCount}
                        </span>

                        {!locked && (
                          <>
                            <button
                              type="button"
                              onClick={() => startRename(tag)}
                              title={t.renameTag}
                              aria-label={`${t.renameTag} ${tag}`}
                              className="p-1.5 rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#18181B] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#2F2F2F] cursor-pointer transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteTag(tag)}
                              title={t.deleteTag}
                              aria-label={`${t.deleteTag} ${tag}`}
                              className="p-1.5 rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#E8E8E5] dark:border-[#323232] bg-[#FBFBFA] dark:bg-[#202020] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
            {t.tagRegistryCount(customTags.length)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[34px] px-4 rounded-lg border border-[#D4D4D8] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F4F4F5] dark:hover:bg-[#323232] text-[#18181B] dark:text-[#ECECEA] text-[13px] font-medium cursor-pointer transition-colors"
          >
            {t.doneReviewing}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

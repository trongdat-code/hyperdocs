import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sun,
  Moon,
  Languages,
  LayoutGrid,
  Download,
  Upload,
  ShieldCheck,
  Server,
  X,
  Settings,
} from 'lucide-react';
import { checkGeminiProxyStatus } from '../../services/geminiService';

export default function SettingsPanel({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onExportBackup,
  onImportBackup,
  t,
}) {
  const importRef = useRef(null);
  const [proxyStatus, setProxyStatus] = useState({
    checked: false,
    reachable: false,
    configured: false,
  });

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    checkGeminiProxyStatus().then((status) => {
      if (active) setProxyStatus({ checked: true, ...status });
    });
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await onImportBackup(file);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-start bg-black/35 backdrop-blur-[2px] p-4 sm:pl-6 no-print"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.settingsTitle}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E5E3] dark:border-[#2F2F2F]">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#787774] dark:text-[#9B9A97]" />
            <h2 className="font-semibold text-[16px] text-[#2F2F2F] dark:text-[#E8E8E6]">
              {t.settingsTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.closeDrawer}
            className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Theme Switcher */}
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
            {t.themeLabel}
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F1F1EF] dark:bg-[#191919]">
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'light' })}
              className={`min-h-[38px] rounded-lg text-[14px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
                settings.theme === 'light'
                  ? 'bg-[#FFFFFF] text-[#2F2F2F] shadow-xs'
                  : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
              }`}
            >
              <Sun className="w-4 h-4 text-amber-500" />
              <span>{t.lightMode}</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'dark' })}
              className={`min-h-[38px] rounded-lg text-[14px] font-medium inline-flex items-center justify-center gap-1.5 transition ${
                settings.theme === 'dark'
                  ? 'bg-[#262626] text-[#E8E8E6] shadow-xs border border-[#3A3A3A]'
                  : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
              }`}
            >
              <Moon className="w-4 h-4 text-indigo-400" />
              <span>{t.darkMode}</span>
            </button>
          </div>
        </div>

        {/* Language Switcher */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
            <Languages className="w-3.5 h-3.5" />
            <span>{t.languageLabel}</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F1F1EF] dark:bg-[#191919]">
            <button
              type="button"
              onClick={() => onUpdateSettings({ language: 'en' })}
              className={`min-h-[38px] rounded-lg text-[14px] font-medium transition ${
                settings.language === 'en'
                  ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] shadow-xs'
                  : 'text-[#787774] dark:text-[#9B9A97]'
              }`}
            >
              EN · {t.english}
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ language: 'vi' })}
              className={`min-h-[38px] rounded-lg text-[14px] font-medium transition ${
                settings.language === 'vi'
                  ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] shadow-xs'
                  : 'text-[#787774] dark:text-[#9B9A97]'
              }`}
            >
              VI · {t.vietnamese}
            </button>
          </div>
        </div>

        {/* Layout Density */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{t.densityLabel}</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F1F1EF] dark:bg-[#191919]">
            <button
              type="button"
              onClick={() => onUpdateSettings({ density: 'comfortable' })}
              className={`min-h-[36px] rounded-lg text-[13px] font-medium transition ${
                settings.density === 'comfortable'
                  ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] shadow-xs'
                  : 'text-[#787774] dark:text-[#9B9A97]'
              }`}
            >
              {t.comfortable}
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ density: 'compact' })}
              className={`min-h-[36px] rounded-lg text-[13px] font-medium transition ${
                settings.density === 'compact'
                  ? 'bg-[#FFFFFF] dark:bg-[#262626] text-[#2F2F2F] dark:text-[#E8E8E6] shadow-xs'
                  : 'text-[#787774] dark:text-[#9B9A97]'
              }`}
            >
              {t.compact}
            </button>
          </div>
        </div>

        {/* Server Proxy Status */}
        <div
          className={`rounded-xl border px-3 py-2.5 flex items-center gap-2 text-[13px] ${
            proxyStatus.configured
              ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'border-[#E5E5E3] dark:border-[#343434] bg-[#F7F7F5] dark:bg-[#1E1E1E] text-[#555552] dark:text-[#B5B4B0]'
          }`}
        >
          {proxyStatus.configured ? (
            <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Server className="w-4 h-4 shrink-0 text-indigo-500" />
          )}
          <span className="leading-snug font-medium">
            {proxyStatus.configured ? t.geminiEnvConfigured : t.geminiEnvMissing}
          </span>
        </div>

        {/* JSON Backup / Restore */}
        <div className="space-y-1.5 pt-2 border-t border-[#E5E5E3] dark:border-[#2F2F2F]">
          <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
            {t.dataBackupLabel}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onExportBackup}
              className="min-h-[40px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#F7F7F5] dark:bg-[#1F1F1F] hover:bg-[#F1F1EF] dark:hover:bg-[#323232] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-4 h-4" />
              <span>{t.exportBackup}</span>
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="min-h-[40px] px-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#F7F7F5] dark:bg-[#1F1F1F] hover:bg-[#F1F1EF] dark:hover:bg-[#323232] text-[#2F2F2F] dark:text-[#E8E8E6] text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition"
            >
              <Upload className="w-4 h-4" />
              <span>{t.importBackup}</span>
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

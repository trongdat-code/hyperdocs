import React, { useEffect, useRef, useState } from 'react';
import {
  SlidersHorizontal,
  Sun,
  Moon,
  Languages,
  LayoutGrid,
  Download,
  Upload,
  ShieldCheck,
  Server,
} from 'lucide-react';
import { checkGeminiProxyStatus } from '../../services/geminiService';

export default function SettingsPanel({
  settings,
  onUpdateSettings,
  onExportBackup,
  onImportBackup,
  t,
}) {
  const importRef = useRef(null);
  const [proxyStatus, setProxyStatus] = useState({ checked: false, reachable: false, configured: false });

  useEffect(() => {
    let active = true;
    checkGeminiProxyStatus().then((status) => {
      if (active) setProxyStatus({ checked: true, ...status });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await onImportBackup(file);
  };

  const pad = settings.density === 'compact' ? 'p-2.5' : 'p-3.5';

  return (
    <section className={`flex flex-col h-full min-h-0 ${pad} bg-slate-50/50 dark:bg-[#0F172A]`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2.5 shrink-0">
        <SlidersHorizontal className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
        <h2 className="font-semibold text-[17px] leading-tight truncate text-slate-900 dark:text-slate-100">
          {t.settingsTitle}
        </h2>
      </div>

      {/* Controls */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5 min-h-0">
        {/* Theme Switcher: Light (White) / Dark (Black) */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.themeLabel}
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'light' })}
              className={`min-h-[38px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition ${
                settings.theme === 'light'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>{t.lightMode}</span>
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ theme: 'dark' })}
              className={`min-h-[38px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition ${
                settings.theme === 'dark'
                  ? 'bg-[#09090B] text-white shadow-sm border border-slate-700'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t.darkMode}</span>
            </button>
          </div>
        </div>

        {/* Language Switcher: EN / VI */}
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Languages className="w-3.5 h-3.5" />
            <span>{t.languageLabel}</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => onUpdateSettings({ language: 'en' })}
              className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${
                settings.language === 'en'
                  ? 'bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              EN · {t.english}
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ language: 'vi' })}
              className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${
                settings.language === 'vi'
                  ? 'bg-white dark:bg-indigo-600 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              VI · {t.vietnamese}
            </button>
          </div>
        </div>

        {/* Layout Density Toggle */}
        <div className="space-y-1">
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{t.densityLabel}</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => onUpdateSettings({ density: 'comfortable' })}
              className={`min-h-[36px] rounded-lg text-xs font-semibold transition ${
                settings.density === 'comfortable'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.comfortable}
            </button>
            <button
              type="button"
              onClick={() => onUpdateSettings({ density: 'compact' })}
              className={`min-h-[36px] rounded-lg text-xs font-semibold transition ${
                settings.density === 'compact'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.compact}
            </button>
          </div>
        </div>

        {/* Server-Side AI Proxy Badge */}
        <div
          className={`rounded-xl border px-2.5 py-2 flex items-center gap-2 text-xs ${
            proxyStatus.configured
              ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-300'
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

        {/* JSON Backup Export / Import */}
        <div className="space-y-1 pt-1 border-t border-slate-200/80 dark:border-slate-800">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t.dataBackupLabel}
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onExportBackup}
              className="min-h-[40px] px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t.exportBackup}</span>
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="min-h-[40px] px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition"
            >
              <Upload className="w-3.5 h-3.5" />
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
    </section>
  );
}

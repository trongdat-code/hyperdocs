import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Menu,
  SlidersHorizontal,
  X,
  BookMarked,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import TaskManager from './components/left/TaskManager';
import FocusMode from './components/left/FocusMode';
import FlashcardSRS from './components/left/FlashcardSRS';
import DocumentList from './components/center/DocumentList';
import DocumentViewer from './components/center/DocumentViewer';
import QuizGenerator from './components/right/QuizGenerator';
import SettingsPanel from './components/right/SettingsPanel';
import {
  KEYS,
  purgeExpiredCompletedTasks,
  storageService,
} from './services/storageService';
import { getTranslator } from './i18n/translations';

export default function App() {
  const [hydrated, setHydrated] = useState(false);

  // Core Study Hub State
  const [settings, setSettings] = useState(() => storageService.loadSettingsSync());
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [flashcards, setFlashcards] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [srsStats, setSrsStats] = useState({ lastSession: null, totalReviewedAllTime: 0 });

  // Active Selections & UI Modes
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [openDocId, setOpenDocId] = useState(null);
  const [openDocInEditMode, setOpenDocInEditMode] = useState(false);
  const [lastSelectedDocId, setLastSelectedDocId] = useState(null);
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Mobile (< 1024px / < 768px) Collapsible Drawers
  const [mobileDrawer, setMobileDrawer] = useState(null); // null | 'left' | 'right'

  // Toast Notification
  const [toast, setToast] = useState(null);

  const t = useMemo(() => getTranslator(settings.language), [settings.language]);

  const notify = useCallback((message, type = 'info') => {
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Apply Dark / Light Theme class immediately on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.lang = settings.language;
  }, [settings.theme, settings.language]);

  // Hydrate all persisted data from IndexedDB / localStorage on mount
  useEffect(() => {
    let mounted = true;
    storageService.loadAllData().then((data) => {
      if (!mounted) return;
      setTasks(data.tasks);
      setDocuments(data.documents);
      setFlashcards(data.flashcards);
      setQuizzes(data.quizzes);
      setSettings(data.settings);
      setSrsStats(data.srsStats);

      const firstActive = data.tasks
        .filter((item) => !item.completed)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
      if (firstActive) setSelectedTaskId(firstActive.id);
      if (data.documents[0]) setLastSelectedDocId(data.documents[0].id);

      setHydrated(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Periodic 7-day completed task auto-purge check
  useEffect(() => {
    if (!hydrated) return;
    const interval = setInterval(() => {
      setTasks((prev) => {
        const cleaned = purgeExpiredCompletedTasks(prev);
        if (cleaned.length !== prev.length) {
          storageService.saveCollection(KEYS.TASKS, cleaned);
        }
        return cleaned;
      });
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [hydrated]);

  // ---------- Task Handlers ----------
  const handleAddTask = (newTask) => {
    setTasks((prev) => {
      const next = [newTask, ...prev];
      storageService.saveCollection(KEYS.TASKS, next);
      return next;
    });
    if (!selectedTaskId) setSelectedTaskId(newTask.id);
  };

  const handleToggleTask = (taskId) => {
    setTasks((prev) => {
      const next = purgeExpiredCompletedTasks(
        prev.map((task) => {
          if (task.id !== taskId) return task;
          const nextCompleted = !task.completed;
          return {
            ...task,
            completed: nextCompleted,
            completedAt: nextCompleted ? Date.now() : null,
          };
        })
      );
      storageService.saveCollection(KEYS.TASKS, next);
      return next;
    });
  };

  const handleDeleteTask = (taskId) => {
    setTasks((prev) => {
      const next = prev.filter((item) => item.id !== taskId);
      storageService.saveCollection(KEYS.TASKS, next);
      return next;
    });
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  };

  const activeTasks = useMemo(
    () =>
      tasks
        .filter((task) => !task.completed)
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
    [tasks]
  );

  const selectedTask = useMemo(() => {
    return activeTasks.find((task) => task.id === selectedTaskId) || activeTasks[0] || null;
  }, [activeTasks, selectedTaskId]);

  // ---------- Document Handlers ----------
  const handleOpenDocument = (docId, editMode = false) => {
    setOpenDocId(docId);
    setLastSelectedDocId(docId);
    setOpenDocInEditMode(editMode);
    setMobileDrawer(null);
  };

  const handleCreateDocument = (newDoc, openImmediately = true, editMode = false) => {
    setDocuments((prev) => {
      const next = [newDoc, ...prev];
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
    setLastSelectedDocId(newDoc.id);
    if (openImmediately) {
      setOpenDocId(newDoc.id);
      setOpenDocInEditMode(editMode);
    }
  };

  const handleUpdateDocument = (updatedDoc) => {
    setDocuments((prev) => {
      const next = prev.map((d) => (d.id === updatedDoc.id ? updatedDoc : d));
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
  };

  const handleDeleteDocument = (docId) => {
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== docId);
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
    if (openDocId === docId) setOpenDocId(null);
    if (lastSelectedDocId === docId) setLastSelectedDocId(null);
  };

  const openDocument = useMemo(
    () => documents.find((d) => d.id === openDocId) || null,
    [documents, openDocId]
  );

  const activeContextDocument = useMemo(
    () =>
      openDocument ||
      documents.find((d) => d.id === lastSelectedDocId) ||
      documents[0] ||
      null,
    [openDocument, documents, lastSelectedDocId]
  );

  // ---------- Flashcard Handlers ----------
  const handleAddFlashcards = (newCards) => {
    setFlashcards((prev) => {
      const next = [...newCards, ...prev];
      storageService.saveCollection(KEYS.FLASHCARDS, next);
      return next;
    });
  };

  const handleUpdateFlashcard = (updatedCard) => {
    setFlashcards((prev) => {
      const next = prev.map((c) => (c.id === updatedCard.id ? updatedCard : c));
      storageService.saveCollection(KEYS.FLASHCARDS, next);
      return next;
    });
  };

  const handleDeleteFlashcard = (cardId) => {
    setFlashcards((prev) => {
      const next = prev.filter((c) => c.id !== cardId);
      storageService.saveCollection(KEYS.FLASHCARDS, next);
      return next;
    });
  };

  const handleSaveSrsStats = (nextStats) => {
    setSrsStats(nextStats);
    storageService.saveCollection(KEYS.SRS_STATS, nextStats);
  };

  // ---------- Quiz Handlers ----------
  const handleAddQuiz = (newQuiz) => {
    setQuizzes((prev) => {
      const next = [newQuiz, ...prev];
      storageService.saveCollection(KEYS.QUIZZES, next);
      return next;
    });
  };

  const handleUpdateQuiz = (updatedQuiz) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => (q.id === updatedQuiz.id ? updatedQuiz : q));
      storageService.saveCollection(KEYS.QUIZZES, next);
      return next;
    });
  };

  const handleDeleteQuiz = (quizId) => {
    setQuizzes((prev) => {
      const next = prev.filter((q) => q.id !== quizId);
      storageService.saveCollection(KEYS.QUIZZES, next);
      return next;
    });
  };

  // ---------- Settings & Backup Handlers ----------
  const handleUpdateSettings = (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      storageService.saveSettings(next);
      return next;
    });
  };

  const handleExportBackup = async () => {
    const backup = await storageService.exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hyperdocs-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(t.backupExported, 'success');
  };

  const handleImportBackup = async (file) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const restored = await storageService.importBackup(parsed);
      setTasks(restored.tasks);
      setDocuments(restored.documents);
      setFlashcards(restored.flashcards);
      setQuizzes(restored.quizzes);
      setSettings(restored.settings);
      setSrsStats(restored.srsStats);
      setOpenDocId(null);
      notify(t.backupImported, 'success');
    } catch {
      notify(t.backupImportError, 'error');
    }
  };

  // Reusable Sidebar Stacks (used on Desktop columns AND Mobile collapsible drawers)
  const leftColumnContent = (
    <div className="grid grid-rows-3 h-full min-h-0 divide-y divide-slate-200 dark:divide-slate-800">
      <div className="min-h-0 overflow-hidden">
        <TaskManager
          tasks={tasks}
          selectedTaskId={selectedTask?.id || null}
          onSelectTask={setSelectedTaskId}
          onAddTask={handleAddTask}
          onToggleTask={handleToggleTask}
          onDeleteTask={handleDeleteTask}
          t={t}
          lang={settings.language}
          density={settings.density}
        />
      </div>
      <div className="min-h-0 overflow-hidden">
        <FocusMode
          activeTasks={activeTasks}
          selectedTask={selectedTask}
          onSelectTask={setSelectedTaskId}
          isFocusMode={isFocusMode}
          onEnterFocusMode={() => {
            setMobileDrawer(null);
            setIsFocusMode(true);
          }}
          onExitFocusMode={() => setIsFocusMode(false)}
          t={t}
          density={settings.density}
        />
      </div>
      <div className="min-h-0 overflow-hidden">
        <FlashcardSRS
          flashcards={flashcards}
          onAddFlashcards={handleAddFlashcards}
          onUpdateFlashcard={handleUpdateFlashcard}
          onDeleteFlashcard={handleDeleteFlashcard}
          srsStats={srsStats}
          onSaveSrsStats={handleSaveSrsStats}
          selectedDocument={activeContextDocument}
          onNotify={notify}
          t={t}
          lang={settings.language}
          density={settings.density}
        />
      </div>
    </div>
  );

  const rightColumnContent = (
    <div className="grid grid-rows-2 h-full min-h-0 divide-y divide-slate-200 dark:divide-slate-800">
      <div className="min-h-0 overflow-hidden">
        <QuizGenerator
          documents={documents}
          selectedDocument={activeContextDocument}
          quizzes={quizzes}
          onAddQuiz={handleAddQuiz}
          onUpdateQuiz={handleUpdateQuiz}
          onDeleteQuiz={handleDeleteQuiz}
          onNotify={notify}
          t={t}
          lang={settings.language}
          density={settings.density}
        />
      </div>
      <div className="min-h-0 overflow-hidden">
        <SettingsPanel
          settings={settings}
          onUpdateSettings={handleUpdateSettings}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          t={t}
        />
      </div>
    </div>
  );

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-white dark:bg-[#09090B] text-[17px] text-slate-900 dark:text-slate-100">
      {/* Mobile / Tablet Collapsible Drawer Top Bar (< 1024px) */}
      <header className="lg:hidden no-print shrink-0 h-14 px-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F172A] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMobileDrawer(mobileDrawer === 'left' ? null : 'left')}
          aria-label={t.navLeft}
          className="touch-target px-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          <Menu className="w-5 h-5" />
          <span className="hidden sm:inline">{t.navLeft}</span>
        </button>

        <div className="flex items-center gap-2 font-bold text-[17px] text-slate-900 dark:text-white">
          <BookMarked className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <span>{t.appTitle}</span>
        </div>

        <button
          type="button"
          onClick={() => setMobileDrawer(mobileDrawer === 'right' ? null : 'right')}
          aria-label={t.navRight}
          className="touch-target px-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          <span className="hidden sm:inline">{t.navRight}</span>
          <SlidersHorizontal className="w-5 h-5" />
        </button>
      </header>

      {/* Main 3-Column Desktop Layout: 1/5 : 3/5 : 1/5 (20% / 60% / 20%) */}
      <div
        className={`flex-1 min-h-0 w-full lg:grid lg:grid-cols-[1fr_3fr_1fr] transition-opacity duration-300 ${
          isFocusMode ? 'opacity-10 pointer-events-none select-none' : 'opacity-100'
        }`}
      >
        {/* A. Left Sidebar (1/5 Width) — Desktop */}
        <aside className="hidden lg:block no-print h-full min-h-0 min-w-0 border-r border-slate-200 dark:border-slate-800 overflow-hidden">
          {leftColumnContent}
        </aside>

        {/* B. Center Workspace (3/5 Width) — Document Hub & Full-Column Reader */}
        <main className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden">
          {openDocument ? (
            <DocumentViewer
              document={openDocument}
              initialEditMode={openDocInEditMode}
              onBack={() => setOpenDocId(null)}
              onUpdateDocument={handleUpdateDocument}
              onNotify={notify}
              t={t}
              lang={settings.language}
            />
          ) : (
            <DocumentList
              documents={documents}
              selectedDocId={activeContextDocument?.id || null}
              onOpenDocument={(id) => handleOpenDocument(id, false)}
              onCreateDocument={handleCreateDocument}
              onUpdateDocument={handleUpdateDocument}
              onDeleteDocument={handleDeleteDocument}
              onNotify={notify}
              t={t}
              lang={settings.language}
              density={settings.density}
            />
          )}
        </main>

        {/* C. Right Sidebar (1/5 Width) — Desktop */}
        <aside className="hidden lg:block no-print h-full min-h-0 min-w-0 border-l border-slate-200 dark:border-slate-800 overflow-hidden">
          {rightColumnContent}
        </aside>
      </div>

      {/* Mobile Collapsible Drawers (< 1024px) */}
      {mobileDrawer && (
        <div className="lg:hidden fixed inset-0 z-40 flex no-print">
          {mobileDrawer === 'right' && (
            <div
              className="flex-1 bg-black/50 backdrop-blur-xs"
              onClick={() => setMobileDrawer(null)}
            />
          )}

          <div className="w-[88vw] max-w-sm h-[100dvh] bg-white dark:bg-[#0F172A] shadow-2xl flex flex-col border-slate-200 dark:border-slate-800 border-r">
            <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <span className="font-bold text-[17px]">
                {mobileDrawer === 'left' ? t.navLeft : t.navRight}
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawer(null)}
                aria-label={t.closeDrawer}
                className="touch-target inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {mobileDrawer === 'left' ? leftColumnContent : rightColumnContent}
            </div>
          </div>

          {mobileDrawer === 'left' && (
            <div
              className="flex-1 bg-black/50 backdrop-blur-xs"
              onClick={() => setMobileDrawer(null)}
            />
          )}
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div
          role="status"
          className={`no-print fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92vw] sm:w-auto px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-sm font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : toast.type === 'warning'
                  ? 'bg-amber-500 text-white border-amber-400'
                  : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-700'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : toast.type === 'error' || toast.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <Info className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-black/15"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

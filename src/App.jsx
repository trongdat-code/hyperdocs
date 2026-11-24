import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Menu,
  X,
  BookMarked,
  CheckCircle2,
  AlertTriangle,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  Flame,
  Layers,
  FileQuestion,
  Settings,
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
import { formatMMSS, PomodoroProvider, usePomodoro } from './context/PomodoroContext';

function LivePomodoroBadge({ compact = false }) {
  const { isRunning, timeLeft, mode } = usePomodoro();
  if (!isRunning) return null;

  const isBreak = mode === 'shortBreak' || mode === 'longBreak';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold tabular-nums shrink-0 ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2 py-0.5 text-[12px]'
      } ${
        isBreak
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full animate-pulse ${
          isBreak ? 'bg-emerald-500' : 'bg-indigo-500'
        }`}
      />
      <span>{formatMMSS(timeLeft)}</span>
    </span>
  );
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);

  // Core Study Hub State
  const [settings, setSettings] = useState(() => storageService.loadSettingsSync());
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [flashcards, setFlashcards] = useState([]);
  const [quizzes, setQuizzes] = useState([]);
  const [srsStats, setSrsStats] = useState({ lastSession: null, totalReviewedAllTime: 0 });

  // Active Navigation & Selection State
  const [activeView, setActiveView] = useState('documents'); // 'documents' | 'pomodoro' | 'flashcards' | 'quiz'
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [openDocId, setOpenDocId] = useState(null);
  const [openDocInEditMode, setOpenDocInEditMode] = useState(false);
  const [lastSelectedDocId, setLastSelectedDocId] = useState(null);

  // Collapsible Sidebar (Desktop >= 768px) & Mobile Drawer (< 768px)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Apply Dark / Light Theme immediately on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.lang = settings.language;
  }, [settings.theme, settings.language]);

  // Hydrate persisted collections from IndexedDB / localStorage
  useEffect(() => {
    let mounted = true;
    storageService.loadAllData().then((data) => {
      if (!mounted) return;
      setTasks(data.tasks);
      setDocuments(data.documents);
      setFolders(data.folders);
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

  // Periodic 7-day completed task auto-purge
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

  // ---------- Folder Handlers (Many-to-Many Grouping) ----------
  const handleCreateFolder = (newFolder) => {
    setFolders((prev) => {
      const next = [newFolder, ...prev];
      storageService.saveCollection(KEYS.FOLDERS, next);
      return next;
    });
  };

  const handleUpdateFolder = (updatedFolder) => {
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === updatedFolder.id ? updatedFolder : f));
      storageService.saveCollection(KEYS.FOLDERS, next);
      return next;
    });
  };

  const handleDeleteFolder = (folderId) => {
    setFolders((prev) => {
      const next = prev.filter((f) => f.id !== folderId);
      storageService.saveCollection(KEYS.FOLDERS, next);
      return next;
    });
    // Cleanly remove deleted folderId from documents without deleting any document
    setDocuments((prev) => {
      const next = prev.map((doc) => ({
        ...doc,
        folderIds: (doc.folderIds || []).filter((id) => id !== folderId),
      }));
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
  };

  const handleToggleDocFolder = (docId, folderId) => {
    setDocuments((prev) => {
      const next = prev.map((doc) => {
        if (doc.id !== docId) return doc;
        const current = Array.isArray(doc.folderIds) ? doc.folderIds : [];
        const exists = current.includes(folderId);
        return {
          ...doc,
          folderIds: exists ? current.filter((id) => id !== folderId) : [...current, folderId],
        };
      });
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
  };

  // ---------- Document Handlers ----------
  const handleOpenDocument = (docId, editMode = false) => {
    setActiveView('documents');
    setOpenDocId(docId);
    setLastSelectedDocId(docId);
    setOpenDocInEditMode(editMode);
    setMobileDrawerOpen(false);
  };

  const handleCreateDocument = (newDoc, openImmediately = true, editMode = false) => {
    const normalized = {
      ...newDoc,
      folderIds: Array.isArray(newDoc.folderIds) ? newDoc.folderIds : [],
    };
    setDocuments((prev) => {
      const next = [normalized, ...prev];
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
    setLastSelectedDocId(normalized.id);
    if (openImmediately) {
      setActiveView('documents');
      setOpenDocId(normalized.id);
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
      setFolders(restored.folders);
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

  const handleNavigate = (viewKey) => {
    setActiveView(viewKey);
    if (viewKey === 'documents') {
      setOpenDocId(null);
    }
    setMobileDrawerOpen(false);
  };

  const navItems = [
    { key: 'documents', label: t.navDocuments, icon: FileText },
    { key: 'pomodoro', label: t.navPomodoro, icon: Flame },
    { key: 'flashcards', label: t.navFlashcards, icon: Layers },
    { key: 'quiz', label: t.navQuiz, icon: FileQuestion },
  ];

  // Shared Sidebar Content (Desktop 1/5 column & Mobile < 768px drawer)
  const renderSidebarInner = (isMobile = false) => (
    <div className="flex flex-col h-full min-h-0 bg-[#F7F7F5] dark:bg-[#202020] text-[#2F2F2F] dark:text-[#E8E8E6]">
      {/* Brand Header + Collapse Button */}
      <div className="h-12 px-3 border-b border-[#E5E5E3] dark:border-[#2F2F2F] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleNavigate('documents')}
          className="flex items-center gap-2 min-w-0 font-semibold text-[15px] tracking-tight hover:opacity-80 transition"
        >
          <BookMarked className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <span className="truncate">{t.appTitle}</span>
        </button>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            aria-label={t.closeDrawer}
            className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#262626]"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            title={t.collapseSidebar}
            aria-label={t.collapseSidebar}
            className="p-1.5 rounded-lg text-[#787774] hover:text-[#2F2F2F] dark:hover:text-white hover:bg-[#EBEBE8] dark:hover:bg-[#2C2C2C] transition shrink-0"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 1. Expandable Task & Deadline Section (Max 50% Viewport Height) */}
      <TaskManager
        tasks={tasks}
        selectedTaskId={selectedTask?.id || null}
        onSelectTask={setSelectedTaskId}
        onAddTask={handleAddTask}
        onToggleTask={handleToggleTask}
        onDeleteTask={handleDeleteTask}
        t={t}
        density={settings.density}
      />

      {/* 2. Feature Index Links (Clean Single-Line Navigation Items) */}
      <nav
        aria-label={t.navSectionLabel}
        className="flex-1 overflow-y-auto px-2.5 py-3 space-y-0.5 min-h-0"
      >
        <p className="px-2 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97]">
          {t.navSectionLabel}
        </p>

        {navItems.map(({ key, label, icon: Icon }) => {
          const isActive = activeView === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleNavigate(key)}
              className={`w-full min-h-[38px] px-2.5 rounded-lg flex items-center gap-2.5 text-[14px] font-medium transition text-left ${
                isActive
                  ? 'bg-[#EBEBE8] dark:bg-[#2C2C2C] text-[#191919] dark:text-white font-semibold'
                  : 'text-[#555552] dark:text-[#B5B4B0] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] hover:text-[#191919] dark:hover:text-white'
              }`}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-[#787774] dark:text-[#9B9A97]'
                }`}
              />
              <span className="truncate flex-1">{label}</span>
              {key === 'pomodoro' && <LivePomodoroBadge />}
            </button>
          );
        })}
      </nav>

      {/* 3. Pinned Bottom-Left Settings Gear Icon */}
      <div className="px-2.5 py-2.5 border-t border-[#E5E5E3] dark:border-[#2F2F2F] shrink-0 flex items-center justify-start">
        <button
          type="button"
          onClick={() => {
            setMobileDrawerOpen(false);
            setSettingsOpen(true);
          }}
          title={t.settingsButton}
          aria-label={t.settingsButton}
          className="h-10 w-10 rounded-lg inline-flex items-center justify-center text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white hover:bg-[#EBEBE8] dark:hover:bg-[#2C2C2C] transition"
        >
          <Settings className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  );

  return (
    <PomodoroProvider selectedTask={selectedTask}>
      <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#191919] text-[15px] text-[#2F2F2F] dark:text-[#E8E8E6]">
        {/* Mobile Top Bar (< 768px) */}
        <header className="md:hidden no-print shrink-0 h-13 px-3 py-1.5 border-b border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label={t.openMenu}
            className="touch-target inline-flex items-center justify-center rounded-lg text-[#555552] dark:text-[#C5C4C0] hover:bg-[#EBEBE8] dark:hover:bg-[#2C2C2C]"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('documents')}
            className="flex items-center gap-1.5 font-semibold text-[15px]"
          >
            <BookMarked className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>{t.appTitle}</span>
          </button>

          <div className="flex items-center gap-1">
            {activeView !== 'pomodoro' && (
              <button
                type="button"
                onClick={() => handleNavigate('pomodoro')}
                aria-label={t.navPomodoro}
              >
                <LivePomodoroBadge compact />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t.settingsButton}
              className="touch-target inline-flex items-center justify-center rounded-lg text-[#555552] dark:text-[#C5C4C0] hover:bg-[#EBEBE8] dark:hover:bg-[#2C2C2C]"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

      {/* Main Two-Column Layout (1/5 : 4/5 on Desktop >= 768px, expands to 100% when collapsed) */}
      <div className="flex-1 min-h-0 w-full flex overflow-hidden relative">
        {/* Left Sidebar (1/5 Width = 20%, Collapsible) */}
        <aside
          className={`hidden md:block no-print h-full min-h-0 shrink-0 overflow-hidden border-[#E5E5E3] dark:border-[#2F2F2F] transition-all duration-200 ease-out ${
            sidebarCollapsed ? 'w-0 border-r-0 opacity-0 pointer-events-none' : 'w-1/5 min-w-[230px] border-r opacity-100'
          }`}
        >
          {renderSidebarInner(false)}
        </aside>

        {/* Main Workspace Canvas (4/5 Width = 80%, or 100% when Sidebar Collapsed) */}
        <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#191919] relative">
          {/* Desktop Expand Sidebar Toggle (shown cleanly when collapsed) */}
          {sidebarCollapsed && (
            <div className="hidden md:flex no-print items-center justify-between px-4 py-2 border-b border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5]/70 dark:bg-[#202020]/70 shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                title={t.expandSidebar}
                aria-label={t.expandSidebar}
                className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#EBEBE8] dark:hover:bg-[#2C2C2C] transition"
              >
                <PanelLeftOpen className="w-4 h-4" />
                <span>{t.expandSidebar}</span>
              </button>
              {activeView !== 'pomodoro' && (
                <button
                  type="button"
                  onClick={() => handleNavigate('pomodoro')}
                  className="hover:opacity-85 transition"
                >
                  <LivePomodoroBadge />
                </button>
              )}
            </div>
          )}

          {/* Active Workspace View */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeView === 'documents' &&
              (openDocument ? (
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
                  folders={folders}
                  selectedDocId={activeContextDocument?.id || null}
                  onOpenDocument={(id) => handleOpenDocument(id, false)}
                  onCreateDocument={handleCreateDocument}
                  onUpdateDocument={handleUpdateDocument}
                  onDeleteDocument={handleDeleteDocument}
                  onCreateFolder={handleCreateFolder}
                  onUpdateFolder={handleUpdateFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onToggleDocFolder={handleToggleDocFolder}
                  onNotify={notify}
                  t={t}
                  lang={settings.language}
                  density={settings.density}
                />
              ))}

            {activeView === 'pomodoro' && (
              <FocusMode
                activeTasks={activeTasks}
                selectedTask={selectedTask}
                onSelectTask={setSelectedTaskId}
                t={t}
              />
            )}

            {activeView === 'flashcards' && (
              <FlashcardSRS
                flashcards={flashcards}
                documents={documents}
                selectedDocument={activeContextDocument}
                onAddFlashcards={handleAddFlashcards}
                onUpdateFlashcard={handleUpdateFlashcard}
                onDeleteFlashcard={handleDeleteFlashcard}
                srsStats={srsStats}
                onSaveSrsStats={handleSaveSrsStats}
                onNotify={notify}
                t={t}
                lang={settings.language}
              />
            )}

            {activeView === 'quiz' && (
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
              />
            )}
          </div>
        </main>
      </div>

      {/* Mobile Collapsible Drawer (< 768px) */}
      {mobileDrawerOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex no-print">
          <div className="w-[82vw] max-w-xs h-[100dvh] shadow-2xl border-r border-[#E5E5E3] dark:border-[#2F2F2F] overflow-hidden">
            {renderSidebarInner(true)}
          </div>
          <div
            className="flex-1 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setMobileDrawerOpen(false)}
          />
        </div>
      )}

      {/* Settings Popover / Modal */}
      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onExportBackup={handleExportBackup}
        onImportBackup={handleImportBackup}
        t={t}
      />

      {/* Toast Notification Banner */}
      {toast && (
        <div
          role="status"
          className={`no-print fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92vw] sm:w-auto px-4 py-2.5 rounded-xl shadow-xl border flex items-center gap-2.5 text-[14px] font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : toast.type === 'warning'
                  ? 'bg-amber-500 text-white border-amber-400'
                  : 'bg-[#262626] text-[#E8E8E6] border-[#3A3A3A]'
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
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      </div>
    </PomodoroProvider>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
  ChevronRight,
  Folder,
  FolderOpen,
  Tag,
  Pin,
} from 'lucide-react';
import TaskManager from './components/left/TaskManager';
import FocusMode from './components/left/FocusMode';
import FlashcardSRS from './components/left/FlashcardSRS';
import DocumentList from './components/center/DocumentList';
import DocumentViewer from './components/center/DocumentViewer';
import QuizGenerator from './components/right/QuizGenerator';
import SettingsPanel from './components/right/SettingsPanel';
import AuthModal from './components/auth/AuthModal';
import CloudSyncWidget from './components/auth/CloudSyncWidget';
import {
  KEYS,
  purgeExpiredCompletedTasks,
  storageService,
} from './services/storageService';
import { getTranslator } from './i18n/translations';
import { formatMMSS, PomodoroProvider, usePomodoro } from './context/PomodoroContext';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import {
  mergeWorkspaces,
  subscribeToCloudWorkspace,
  syncWorkspaceBidirectional,
  upsertCloudWorkspace,
} from './utils/cloudSync';
import {
  doesDocMatchQuery,
  doesFolderMatchQuery,
  doesTagMatchQuery,
  normalizeSearchText,
} from './utils/searchUtils';

const ALL_DOCS_EXPANDED_KEY = 'hyperdocs_all_docs_expanded';
const PINNED_DOCS_EXPANDED_KEY = 'hyperdocs_pinned_docs_expanded';

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
  const [pomodoroStats, setPomodoroStats] = useState({ completedSessions: 0, updatedAt: 0 });

  // Supabase Auth & Cloud Sync State
  const [cloudUser, setCloudUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle'
  );
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const initialCloudSyncedUserRef = useRef(null);
  const suppressAutoPushRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const latestSnapshotRef = useRef(null);

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

  // Global Search Command Popover & Collapsible "All Documents" / Sidebar Folder Sections
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [allDocsExpanded, setAllDocsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(ALL_DOCS_EXPANDED_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [pinnedDocsExpanded, setPinnedDocsExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(PINNED_DOCS_EXPANDED_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [sidebarExpandedFolderIds, setSidebarExpandedFolderIds] = useState([]);

  const searchPopoverInputRef = useRef(null);
  const docListSearchInputRef = useRef(null);

  const openSearchPopover = useCallback(() => {
    setSearchActiveIndex(0);
    setSearchPopoverOpen(true);
  }, []);

  const closeSearchPopover = useCallback(() => {
    setSearchPopoverOpen(false);
  }, []);

  const toggleAllDocsExpanded = useCallback(() => {
    setAllDocsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ALL_DOCS_EXPANDED_KEY, String(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const togglePinnedDocsExpanded = useCallback(() => {
    setPinnedDocsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PINNED_DOCS_EXPANDED_KEY, String(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const toggleSidebarFolder = useCallback((folderId) => {
    setSidebarExpandedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  }, []);

  // Auto-focus search input whenever Notion-style search popover opens
  useEffect(() => {
    if (!searchPopoverOpen) return;
    setSearchActiveIndex(0);
    const frame = requestAnimationFrame(() => {
      searchPopoverInputRef.current?.focus();
      searchPopoverInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [searchPopoverOpen]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [globalSearchQuery]);

  // Global keyboard shortcuts: Ctrl+K / Cmd+K or `/` opens the Notion-style search popover, Esc closes it
  useEffect(() => {
    const handleGlobalSearchShortcut = (e) => {
      if (e.key === 'Escape' && searchPopoverOpen) {
        e.preventDefault();
        setSearchPopoverOpen(false);
        return;
      }

      const key = e.key?.toLowerCase();
      const isCtrlOrCmdK = (e.ctrlKey || e.metaKey) && key === 'k';
      const target = e.target;
      const isTypingField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const isSlashShortcut =
        e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingField;

      if (!isCtrlOrCmdK && !isSlashShortcut) return;

      e.preventDefault();

      if (isCtrlOrCmdK && searchPopoverOpen) {
        setSearchPopoverOpen(false);
        return;
      }

      setMobileDrawerOpen(false);
      openSearchPopover();
    };

    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, [searchPopoverOpen, openSearchPopover]);

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
      setPomodoroStats(data.pomodoroStats || { completedSessions: 0, updatedAt: 0 });

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

  // Keep ref pointing to latest local snapshot for bidirectional sync & debounce
  useEffect(() => {
    latestSnapshotRef.current = {
      documents,
      folders,
      tasks,
      flashcards,
      quizzes,
      srsStats,
      pomodoroStats,
    };
  }, [documents, folders, tasks, flashcards, quizzes, srsStats, pomodoroStats]);

  const persistMergedSnapshotLocally = useCallback(async (merged) => {
    suppressAutoPushRef.current = true;
    setDocuments(merged.documents);
    setFolders(merged.folders);
    setTasks(merged.tasks);
    setFlashcards(merged.flashcards);
    setQuizzes(merged.quizzes);
    setSrsStats(merged.srsStats);
    setPomodoroStats(merged.pomodoroStats || { completedSessions: 0, updatedAt: 0 });

    await Promise.all([
      storageService.saveCollection(KEYS.DOCUMENTS, merged.documents),
      storageService.saveCollection(KEYS.FOLDERS, merged.folders),
      storageService.saveCollection(KEYS.TASKS, merged.tasks),
      storageService.saveCollection(KEYS.FLASHCARDS, merged.flashcards),
      storageService.saveCollection(KEYS.QUIZZES, merged.quizzes),
      storageService.saveCollection(KEYS.SRS_STATS, merged.srsStats),
      storageService.saveCollection(
        KEYS.POMODORO_STATS,
        merged.pomodoroStats || { completedSessions: 0, updatedAt: 0 }
      ),
    ]);
  }, []);

  // Supabase Auth session listener (gracefully no-ops in local-only mode)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setCloudUser(data?.session?.user || null);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user || null;
      setCloudUser(nextUser);
      if (!nextUser) {
        initialCloudSyncedUserRef.current = null;
        setSyncStatus('idle');
      }
    });

    return () => {
      active = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Bidirectional initial merge on sign-in + Realtime cross-device subscription
  useEffect(() => {
    if (!hydrated || !cloudUser || !isSupabaseConfigured) return;

    let cancelled = false;
    const userId = cloudUser.id;

    const runInitialSync = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      setSyncStatus('syncing');
      const { merged, error } = await syncWorkspaceBidirectional(
        userId,
        latestSnapshotRef.current
      );
      if (cancelled) return;

      if (merged) {
        await persistMergedSnapshotLocally(merged);
      }
      initialCloudSyncedUserRef.current = userId;
      setSyncStatus(error ? 'offline' : 'synced');
    };

    runInitialSync();

    const unsubscribe = subscribeToCloudWorkspace(userId, async (remoteData) => {
      if (cancelled || !latestSnapshotRef.current) return;
      const merged = mergeWorkspaces(latestSnapshotRef.current, remoteData);
      await persistMergedSnapshotLocally(merged);
      setSyncStatus('synced');
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [hydrated, cloudUser, persistMergedSnapshotLocally]);

  // Network online/offline watcher
  useEffect(() => {
    const handleOffline = () => setSyncStatus('offline');
    const handleOnline = async () => {
      if (!cloudUser || !isSupabaseConfigured || !latestSnapshotRef.current) return;
      setSyncStatus('syncing');
      const { merged, error } = await syncWorkspaceBidirectional(
        cloudUser.id,
        latestSnapshotRef.current
      );
      if (merged) await persistMergedSnapshotLocally(merged);
      setSyncStatus(error ? 'offline' : 'synced');
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [cloudUser, persistMergedSnapshotLocally]);

  // Debounced (1500ms) auto-save to Supabase cloud whenever workspace data changes
  useEffect(() => {
    if (!hydrated || !cloudUser || !isSupabaseConfigured) return;
    if (initialCloudSyncedUserRef.current !== cloudUser.id) return;

    if (suppressAutoPushRef.current) {
      suppressAutoPushRef.current = false;
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    setSyncStatus('syncing');
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(async () => {
      if (!latestSnapshotRef.current) return;
      const { error } = await upsertCloudWorkspace(cloudUser.id, latestSnapshotRef.current);
      setSyncStatus(error ? 'offline' : 'synced');
    }, 1500);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [hydrated, cloudUser, documents, folders, tasks, flashcards, quizzes, srsStats, pomodoroStats]);

  const handleManualSyncNow = async () => {
    if (!cloudUser || !isSupabaseConfigured || !latestSnapshotRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncStatus('offline');
      notify(t.syncErrorToast, 'warning');
      return;
    }
    setSyncStatus('syncing');
    const { merged, error } = await syncWorkspaceBidirectional(
      cloudUser.id,
      latestSnapshotRef.current
    );
    if (merged) await persistMergedSnapshotLocally(merged);
    if (error) {
      setSyncStatus('offline');
      notify(t.syncErrorToast, 'error');
    } else {
      setSyncStatus('synced');
      notify(t.syncSuccessToast, 'success');
    }
  };

  const handleSignOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    initialCloudSyncedUserRef.current = null;
    setCloudUser(null);
    setSyncStatus('idle');
    notify(t.signedOutToast, 'info');
  };

  const handlePomodoroSessionsChange = useCallback((completedSessions) => {
    const nextStats = { completedSessions, updatedAt: Date.now() };
    setPomodoroStats(nextStats);
    storageService.saveCollection(KEYS.POMODORO_STATS, nextStats);
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
            updatedAt: Date.now(),
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
    const stamped = { ...updatedFolder, updatedAt: Date.now() };
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === stamped.id ? stamped : f));
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
          updatedAt: Date.now(),
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

  const handleTogglePinDocument = useCallback((docId) => {
    setDocuments((prev) => {
      const next = prev.map((d) =>
        d.id === docId ? { ...d, pinned: !d.pinned, updatedAt: Date.now() } : d
      );
      storageService.saveCollection(KEYS.DOCUMENTS, next);
      return next;
    });
  }, []);

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
      setPomodoroStats(restored.pomodoroStats || { completedSessions: 0, updatedAt: 0 });
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

  // Global search & sidebar collapsible library filtering (diacritic-friendly across title & tags)
  const hasGlobalSearch = Boolean(normalizeSearchText(globalSearchQuery));

  const sidebarSortedDocs = useMemo(
    () =>
      [...documents].sort(
        (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
      ),
    [documents]
  );

  const sidebarFilteredDocs = useMemo(
    () => sidebarSortedDocs.filter((doc) => doesDocMatchQuery(doc, globalSearchQuery)),
    [sidebarSortedDocs, globalSearchQuery]
  );

  const sidebarPinnedDocs = useMemo(
    () => sidebarFilteredDocs.filter((doc) => Boolean(doc.pinned)),
    [sidebarFilteredDocs]
  );

  const sidebarFilteredFolders = useMemo(
    () =>
      [...folders]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .filter((folder) => {
          const folderDocs = sidebarSortedDocs.filter((d) =>
            (d.folderIds || []).includes(folder.id)
          );
          return doesFolderMatchQuery(folder, folderDocs, globalSearchQuery);
        }),
    [folders, sidebarSortedDocs, globalSearchQuery]
  );

  const allDocumentTags = useMemo(() => {
    const tagSet = new Set();
    documents.forEach((doc) => {
      (doc.tags || []).forEach((tag) => {
        const clean = String(tag || '').trim();
        if (clean) tagSet.add(clean);
      });
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const renderSidebarDocItem = (doc, keyPrefix) => {
    const isActiveDoc = activeView === 'documents' && openDocId === doc.id;
    const isPinned = Boolean(doc.pinned);
    const docTags = (doc.tags || []).slice(0, 3);
    const matchingTags = hasGlobalSearch
      ? docTags.filter((tag) => doesTagMatchQuery(tag, globalSearchQuery))
      : [];

    return (
      <div
        key={`${keyPrefix}_${doc.id}`}
        className={`group w-full rounded-lg transition-colors duration-150 flex flex-col ${
          isActiveDoc
            ? 'bg-[#EFF6FF] dark:bg-[#2563EB]/[0.16] text-[#2563EB] dark:text-[#60A5FA] font-semibold'
            : 'text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A] hover:text-[#18181B] dark:hover:text-[#E4E4E7]'
        }`}
      >
        <div className="flex items-center gap-1 min-w-0 pr-1">
          <button
            type="button"
            onClick={() => handleOpenDocument(doc.id, false)}
            title={doc.title}
            className="flex-1 min-w-0 px-2 py-1.5 text-left cursor-pointer flex items-center gap-1.5"
          >
            <FileText
              className={`w-3.5 h-3.5 shrink-0 ${
                isActiveDoc
                  ? 'text-[#2563EB] dark:text-[#60A5FA]'
                  : 'text-[#52525B] dark:text-[#A1A1AA]'
              }`}
            />
            <span className="truncate text-[13px] leading-snug flex-1">{doc.title}</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePinDocument(doc.id);
            }}
            title={isPinned ? t.unpinDoc : t.pinDoc}
            aria-label={isPinned ? t.unpinDoc : t.pinDoc}
            aria-pressed={isPinned}
            className={`p-1 rounded-md shrink-0 cursor-pointer transition-all duration-150 ${
              isPinned
                ? 'text-[#2563EB] dark:text-[#60A5FA] opacity-100 hover:bg-[#EFF6FF] dark:hover:bg-[#2563EB]/20'
                : 'text-[#52525B] dark:text-[#A1A1AA] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#E8E8E5]/70 dark:hover:bg-[#343434]'
            }`}
          >
            <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
          </button>
        </div>

        {(matchingTags.length > 0 || (hasGlobalSearch && docTags.length > 0)) && (
          <div
            onClick={() => handleOpenDocument(doc.id, false)}
            className="flex flex-wrap items-center gap-1 pl-7 pr-2 pb-1.5 cursor-pointer"
          >
            {docTags.map((tag) => {
              const isMatch = doesTagMatchQuery(tag, globalSearchQuery);
              return (
                <span
                  key={tag}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10.5px] leading-none font-medium ${
                    isMatch
                      ? 'bg-amber-200/85 dark:bg-amber-500/30 text-amber-950 dark:text-amber-200 ring-1 ring-amber-400/70 dark:ring-amber-400/50 font-semibold'
                      : 'bg-[#EFEFED] dark:bg-[#2E2E2E] text-[#6B6A66] dark:text-[#9B9A97]'
                  }`}
                >
                  <Tag
                    className={`w-2.5 h-2.5 ${
                      isMatch ? 'text-amber-700 dark:text-amber-300' : 'text-[#8E8D8A]'
                    }`}
                  />
                  <span className="truncate max-w-[90px]">{tag}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Shared Sidebar Content (Desktop 1/5 column & Mobile < 768px drawer)
  // Unified single-column vertical scroll container (flex flex-col h-screen overflow-y-auto)
  const renderSidebarInner = (isMobile = false) => {
    const isAllDocsOpen = allDocsExpanded || hasGlobalSearch;
    const isPinnedOpen = pinnedDocsExpanded || hasGlobalSearch;

    return (
      <div className="sidebar-scroll flex flex-col h-screen max-h-full overflow-y-auto overflow-x-hidden bg-[#FBFBFA] dark:bg-[#202020] text-[#262624] dark:text-[#ECECEA]">
        {/* Brand Header + Compact Search Icon Button + Collapse/Close Button */}
        <div className="sticky top-0 z-10 h-12 px-3 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA]/95 dark:bg-[#202020]/95 backdrop-blur-sm flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleNavigate('documents')}
            className="flex items-center gap-2 min-w-0 font-semibold text-[15px] tracking-tight text-[#18181B] dark:text-[#E4E4E7] hover:opacity-80 cursor-pointer transition-opacity duration-150"
          >
            <BookMarked className="w-4 h-4 text-[#18181B] dark:text-[#E4E4E7] shrink-0" />
            <span className="truncate">{t.appTitle}</span>
          </button>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (isMobile) setMobileDrawerOpen(false);
                openSearchPopover();
              }}
              title={`${t.globalSearchPlaceholder} (${t.searchShortcutHint})`}
              aria-label={t.globalSearchPlaceholder}
              className={`relative ${
                isMobile ? 'touch-target' : 'p-1.5'
              } inline-flex items-center justify-center rounded-lg cursor-pointer transition-colors duration-150 shrink-0 ${
                searchPopoverOpen || hasGlobalSearch
                  ? 'bg-[#EFF6FF] dark:bg-[#2563EB]/[0.16] text-[#2563EB] dark:text-[#60A5FA]'
                  : 'text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C]'
              }`}
            >
              <Search className="w-4 h-4" />
              {hasGlobalSearch && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#2563EB] dark:bg-[#60A5FA]" />
              )}
            </button>

            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label={t.closeDrawer}
                className="touch-target inline-flex items-center justify-center rounded-lg text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] cursor-pointer transition-colors duration-150"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                title={t.collapseSidebar}
                aria-label={t.collapseSidebar}
                className="p-1.5 rounded-lg text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150 shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 1. Spacious Task & Deadline Section (flows smoothly within unified sidebar scroll) */}
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

        {/* 2. Feature Index Links + Collapsible All Documents & Custom Folders */}
        <nav
          aria-label={t.navSectionLabel}
          className="px-3 py-4 space-y-4 shrink-0"
        >
          <div className="space-y-0.5">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97]">
              {t.navSectionLabel}
            </p>

            {navItems.map(({ key, label, icon: Icon }) => {
              const isActive = activeView === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleNavigate(key)}
                  className={`w-full min-h-[36px] px-2.5 rounded-lg flex items-center gap-2.5 text-[14px] font-medium cursor-pointer transition-colors duration-150 text-left ${
                    isActive
                      ? 'bg-[#EFF6FF] dark:bg-[#2563EB]/[0.16] text-[#2563EB] dark:text-[#60A5FA] font-semibold'
                      : 'text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#F3F3F1]/80 dark:hover:bg-[#262626] hover:text-[#18181B] dark:hover:text-[#E4E4E7]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive
                        ? 'text-[#2563EB] dark:text-[#60A5FA]'
                        : 'text-[#52525B] dark:text-[#A1A1AA]'
                    }`}
                  />
                  <span className="truncate flex-1">{label}</span>
                  {key === 'pomodoro' && <LivePomodoroBadge />}
                </button>
              );
            })}
          </div>

          {/* Collapsible "Pinned" (Đã ghim), "All Documents" (Tất cả tài liệu) & Custom Folder Accordions */}
          <div className="pt-3 border-t border-[#E8E8E5] dark:border-[#2F2F2F] space-y-1">
            {/* Collapsible Pinned Section (at the very top right above All Documents) */}
            <div>
              <button
                type="button"
                onClick={togglePinnedDocsExpanded}
                aria-expanded={isPinnedOpen}
                className="w-full min-h-[34px] px-2 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold text-[#18181B] dark:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A] cursor-pointer transition-colors duration-150 text-left"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0 transition-transform duration-150 ${
                    isPinnedOpen ? 'rotate-90' : ''
                  }`}
                />
                <Pin className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
                <span className="truncate flex-1">{t.pinnedSectionLabel}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-[#EFEFED] dark:bg-[#2C2C2C] text-[#52525B] dark:text-[#A1A1AA] text-[11px] font-medium tabular-nums shrink-0">
                  {sidebarPinnedDocs.length}
                </span>
              </button>

              {isPinnedOpen && (
                <div className="mt-0.5 pl-3 space-y-0.5">
                  {sidebarPinnedDocs.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-[#8E8D8A] dark:text-[#888783] italic">
                      {t.noPinnedDocsHint}
                    </p>
                  ) : (
                    sidebarPinnedDocs.map((doc) => renderSidebarDocItem(doc, 'pinned'))
                  )}
                </div>
              )}
            </div>

            {/* Collapsible All Documents Section */}
            <div>
              <button
                type="button"
                onClick={toggleAllDocsExpanded}
                aria-expanded={isAllDocsOpen}
                className="w-full min-h-[34px] px-2 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold text-[#18181B] dark:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A] cursor-pointer transition-colors duration-150 text-left"
              >
                <ChevronRight
                  className={`w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0 transition-transform duration-150 ${
                    isAllDocsOpen ? 'rotate-90' : ''
                  }`}
                />
                <FileText className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
                <span className="truncate flex-1">{t.allDocumentsSectionLabel}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-[#EFEFED] dark:bg-[#2C2C2C] text-[#52525B] dark:text-[#A1A1AA] text-[11px] font-medium tabular-nums shrink-0">
                  {sidebarFilteredDocs.length}
                </span>
              </button>

              {isAllDocsOpen && (
                <div className="mt-0.5 pl-3 space-y-0.5">
                  {sidebarFilteredDocs.length === 0 ? (
                    <p className="px-2 py-1.5 text-[12px] text-[#8E8D8A] dark:text-[#888783] italic">
                      {t.noDocsFound}
                    </p>
                  ) : (
                    sidebarFilteredDocs.map((doc) => renderSidebarDocItem(doc, 'all'))
                  )}
                </div>
              )}
            </div>

            {/* Collapsible Custom Folder Sections (matching exact expand/collapse style) */}
            {sidebarFilteredFolders.map((folder) => {
              const allFolderDocs = sidebarSortedDocs.filter((d) =>
                (d.folderIds || []).includes(folder.id)
              );
              const matchingFolderDocs = hasGlobalSearch
                ? allFolderDocs.filter((d) => doesDocMatchQuery(d, globalSearchQuery))
                : allFolderDocs;
              const visibleFolderDocs =
                hasGlobalSearch && matchingFolderDocs.length > 0
                  ? matchingFolderDocs
                  : allFolderDocs;
              const isFolderOpen =
                sidebarExpandedFolderIds.includes(folder.id) || hasGlobalSearch;

              return (
                <div key={folder.id}>
                  <button
                    type="button"
                    onClick={() => toggleSidebarFolder(folder.id)}
                    aria-expanded={isFolderOpen}
                    className="w-full min-h-[34px] px-2 rounded-lg flex items-center gap-1.5 text-[13px] font-semibold text-[#18181B] dark:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2A2A2A] cursor-pointer transition-colors duration-150 text-left"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0 transition-transform duration-150 ${
                        isFolderOpen ? 'rotate-90' : ''
                      }`}
                    />
                    {isFolderOpen ? (
                      <FolderOpen className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
                    )}
                    <span className="truncate flex-1">{folder.name}</span>
                    <span className="px-1.5 py-0.5 rounded-full bg-[#EFEFED] dark:bg-[#2C2C2C] text-[#52525B] dark:text-[#A1A1AA] text-[11px] font-medium tabular-nums shrink-0">
                      {visibleFolderDocs.length}
                    </span>
                  </button>

                  {isFolderOpen && (
                    <div className="mt-0.5 pl-3 space-y-0.5">
                      {visibleFolderDocs.length === 0 ? (
                        <p className="px-2 py-1.5 text-[12px] text-[#8E8D8A] dark:text-[#888783] italic">
                          {t.emptyFolderHint}
                        </p>
                      ) : (
                        visibleFolderDocs.map((doc) =>
                          renderSidebarDocItem(doc, `folder_${folder.id}`)
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* 3 & 4. Account Cloud Sync & Settings Controls (anchored at bottom when short, scrolls naturally when long) */}
        <div className="mt-auto pt-3 shrink-0">
          <CloudSyncWidget
            user={cloudUser}
            syncStatus={syncStatus}
            onOpenAuth={() => {
              setMobileDrawerOpen(false);
              setAuthModalOpen(true);
            }}
            onSyncNow={handleManualSyncNow}
            onSignOut={handleSignOut}
            t={t}
          />

          <div className="px-3 py-2.5 border-t border-[#E8E8E5] dark:border-[#2F2F2F] shrink-0 flex items-center justify-start">
            <button
              type="button"
              onClick={() => {
                setMobileDrawerOpen(false);
                setSettingsOpen(true);
              }}
              title={t.settingsButton}
              aria-label={t.settingsButton}
              aria-pressed={settingsOpen}
              className={`h-10 w-10 rounded-lg inline-flex items-center justify-center cursor-pointer transition-colors duration-150 ${
                settingsOpen
                  ? 'bg-[#EFF6FF] dark:bg-[#2563EB]/[0.16] text-[#2563EB] dark:text-[#60A5FA]'
                  : 'text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#E4E4E7] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C]'
              }`}
            >
              <Settings className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <PomodoroProvider
      selectedTask={selectedTask}
      completedSessionsExternal={pomodoroStats.completedSessions}
      onCompletedSessionsChange={handlePomodoroSessionsChange}
    >
      <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#191919] text-[15px] text-[#262624] dark:text-[#ECECEA]">
        {/* Mobile Top Bar (< 768px) */}
        <header className="md:hidden no-print shrink-0 h-13 px-3 py-1.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] flex items-center justify-between gap-2">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label={t.openMenu}
              className="touch-target inline-flex items-center justify-center rounded-lg text-[#555552] dark:text-[#C5C4C0] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={openSearchPopover}
              title={`${t.globalSearchPlaceholder} (${t.searchShortcutHint})`}
              aria-label={t.globalSearchPlaceholder}
              className="relative touch-target inline-flex items-center justify-center rounded-lg text-[#555552] dark:text-[#C5C4C0] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
            >
              <Search className="w-[18px] h-[18px]" />
              {hasGlobalSearch && (
                <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleNavigate('documents')}
            className="flex items-center gap-1.5 font-semibold text-[15px] text-[#18181B] dark:text-[#E4E4E7] cursor-pointer"
          >
            <BookMarked className="w-4 h-4 text-[#18181B] dark:text-[#E4E4E7]" />
            <span>{t.appTitle}</span>
          </button>

          <div className="flex items-center gap-1">
            {activeView !== 'pomodoro' && (
              <button
                type="button"
                onClick={() => handleNavigate('pomodoro')}
                aria-label={t.navPomodoro}
                className="cursor-pointer"
              >
                <LivePomodoroBadge compact />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label={t.settingsButton}
              className="touch-target inline-flex items-center justify-center rounded-lg text-[#555552] dark:text-[#C5C4C0] hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

      {/* Main Two-Column Layout (1/5 : 4/5 on Desktop >= 768px, expands to 100% when collapsed) */}
      <div className="flex-1 min-h-0 w-full flex overflow-hidden relative">
        {/* Left Sidebar (1/5 Width = 20%, Collapsible) */}
        <aside
          className={`hidden md:block no-print h-full min-h-0 shrink-0 overflow-hidden border-[#E8E8E5] dark:border-[#2F2F2F] transition-all duration-200 ease-out ${
            sidebarCollapsed ? 'w-0 border-r-0 opacity-0 pointer-events-none' : 'w-1/5 min-w-[230px] border-r opacity-100'
          }`}
        >
          {renderSidebarInner(false)}
        </aside>

        {/* Main Workspace Canvas (4/5 Width = 80%, or 100% when Sidebar Collapsed) */}
        <main className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#191919] relative">
          {/* Desktop Expand Sidebar Toggle + Compact Search Icon (shown cleanly when collapsed) */}
          {sidebarCollapsed && (
            <div className="hidden md:flex no-print items-center justify-between px-4 py-2 border-b border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA]/85 dark:bg-[#202020]/85 shrink-0 gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  title={t.expandSidebar}
                  aria-label={t.expandSidebar}
                  className="h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[13px] font-medium text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                  <span>{t.expandSidebar}</span>
                </button>
                <button
                  type="button"
                  onClick={openSearchPopover}
                  title={`${t.globalSearchPlaceholder} (${t.searchShortcutHint})`}
                  aria-label={t.globalSearchPlaceholder}
                  className="relative h-8 w-8 rounded-lg inline-flex items-center justify-center text-[#555552] dark:text-[#C5C4C0] hover:text-[#191919] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#2C2C2C] cursor-pointer transition-colors duration-150"
                >
                  <Search className="w-4 h-4" />
                  {hasGlobalSearch && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  )}
                </button>
              </div>
              {activeView !== 'pomodoro' && (
                <button
                  type="button"
                  onClick={() => handleNavigate('pomodoro')}
                  className="hover:opacity-85 cursor-pointer transition-opacity duration-150"
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
                  onTogglePin={handleTogglePinDocument}
                  onNotify={notify}
                  t={t}
                  lang={settings.language}
                />
              ) : (
                <DocumentList
                  documents={documents}
                  folders={folders}
                  selectedDocId={activeContextDocument?.id || null}
                  searchQuery={globalSearchQuery}
                  onSearchQueryChange={setGlobalSearchQuery}
                  searchInputRef={docListSearchInputRef}
                  allDocsExpanded={allDocsExpanded}
                  onToggleAllDocsExpanded={toggleAllDocsExpanded}
                  onOpenDocument={(id) => handleOpenDocument(id, false)}
                  onCreateDocument={handleCreateDocument}
                  onUpdateDocument={handleUpdateDocument}
                  onTogglePin={handleTogglePinDocument}
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
          <div className="hd-drawer-in w-[82vw] max-w-xs h-[100dvh] shadow-2xl border-r border-[#E8E8E5] dark:border-[#2F2F2F] overflow-hidden">
            {renderSidebarInner(true)}
          </div>
          <div
            className="hd-fade-in flex-1 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setMobileDrawerOpen(false)}
          />
        </div>
      )}

      {/* Notion-Style Command / Search Popover (triggered by Search icon or Ctrl+K / `/`) */}
      {searchPopoverOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t.globalSearchPlaceholder}
          onClick={closeSearchPopover}
          className="hd-fade-in no-print fixed inset-0 z-50 flex items-start justify-center pt-[10vh] sm:pt-[13vh] px-4 bg-black/35 backdrop-blur-[2px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="hd-modal-in w-full max-w-lg rounded-2xl bg-[#FFFFFF] dark:bg-[#242424] border border-[#E8E8E5] dark:border-[#343434] shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Search Input Header */}
            <div className="px-4 h-14 border-b border-[#E8E8E5] dark:border-[#323232] flex items-center gap-2.5">
              <Search className="w-4 h-4 text-[#6B6A66] dark:text-[#9B9A97] shrink-0" />
              <input
                ref={searchPopoverInputRef}
                type="text"
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearchPopover();
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchActiveIndex((prev) =>
                      sidebarFilteredDocs.length > 0
                        ? (prev + 1) % sidebarFilteredDocs.length
                        : 0
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchActiveIndex((prev) =>
                      sidebarFilteredDocs.length > 0
                        ? (prev - 1 + sidebarFilteredDocs.length) % sidebarFilteredDocs.length
                        : 0
                    );
                  } else if (e.key === 'Enter' && sidebarFilteredDocs.length > 0) {
                    e.preventDefault();
                    const picked =
                      sidebarFilteredDocs[searchActiveIndex] || sidebarFilteredDocs[0];
                    if (picked) {
                      handleOpenDocument(picked.id, false);
                      closeSearchPopover();
                    }
                  }
                }}
                placeholder={t.globalSearchPlaceholder}
                aria-label={t.globalSearchPlaceholder}
                className="flex-1 h-full bg-transparent text-[14.5px] text-[#262624] dark:text-[#ECECEA] placeholder:text-[#9B9A97] focus:outline-none"
              />
              {globalSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setGlobalSearchQuery('');
                    searchPopoverInputRef.current?.focus();
                  }}
                  title={t.clearSearch}
                  aria-label={t.clearSearch}
                  className="px-2 py-1 rounded-md text-[11.5px] font-medium text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors"
                >
                  {t.clearSearch}
                </button>
              )}
              <button
                type="button"
                onClick={closeSearchPopover}
                title={t.closeSearch}
                aria-label={t.closeSearch}
                className="p-1.5 rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-white hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Tag Filter Pills */}
            {allDocumentTags.length > 0 && (
              <div className="px-4 py-2.5 border-b border-[#E8E8E5] dark:border-[#323232] bg-[#FBFBFA] dark:bg-[#202020] flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8E8D8A] dark:text-[#888783] shrink-0 mr-0.5">
                  {t.quickTagsLabel}:
                </span>
                {allDocumentTags.slice(0, 12).map((tag) => {
                  const isTagActive =
                    normalizeSearchText(globalSearchQuery) === normalizeSearchText(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setGlobalSearchQuery(isTagActive ? '' : tag);
                        searchPopoverInputRef.current?.focus();
                      }}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11.5px] font-medium shrink-0 cursor-pointer transition-colors ${
                        isTagActive
                          ? 'bg-indigo-600 text-white'
                          : 'bg-[#EFEFED] dark:bg-[#2E2E2E] text-[#555552] dark:text-[#C5C4C0] hover:bg-[#E5E5E1] dark:hover:bg-[#3A3A3A]'
                      }`}
                    >
                      <Tag className="w-2.5 h-2.5" />
                      <span>{tag}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Filtered Document Results (by Title & Tags) */}
            <div className="max-h-[52vh] overflow-y-auto p-2 space-y-1">
              {sidebarFilteredDocs.length === 0 ? (
                <div className="py-10 px-4 text-center text-[13.5px] text-[#6B6A66] dark:text-[#9B9A97]">
                  {t.noDocsFound}
                </div>
              ) : (
                sidebarFilteredDocs.map((doc, idx) => {
                  const isHighlighted = idx === searchActiveIndex;
                  const docTags = (doc.tags || []).slice(0, 3);
                  const docFolders = folders.filter((f) => (doc.folderIds || []).includes(f.id));

                  return (
                    <button
                      key={doc.id}
                      type="button"
                      onMouseEnter={() => setSearchActiveIndex(idx)}
                      onClick={() => {
                        handleOpenDocument(doc.id, false);
                        closeSearchPopover();
                      }}
                      className={`w-full px-3 py-2.5 rounded-xl text-left flex items-start gap-2.5 cursor-pointer transition-colors duration-100 ${
                        isHighlighted
                          ? 'bg-[#F3F3F1] dark:bg-[#303030] text-[#191919] dark:text-white'
                          : 'text-[#262624] dark:text-[#ECECEA] hover:bg-[#F3F3F1]/70 dark:hover:bg-[#2C2C2C]'
                      }`}
                    >
                      <FileText
                        className={`w-4 h-4 mt-0.5 shrink-0 ${
                          doc.docType === 'pdf-embed'
                            ? 'text-rose-500 dark:text-rose-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-[14px] font-medium truncate leading-snug">
                          {doc.title}
                        </p>
                        {(docTags.length > 0 || docFolders.length > 0) && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {docTags.map((tag) => {
                              const isMatch =
                                hasGlobalSearch && doesTagMatchQuery(tag, globalSearchQuery);
                              return (
                                <span
                                  key={tag}
                                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] leading-none font-medium ${
                                    isMatch
                                      ? 'bg-amber-200/85 dark:bg-amber-500/30 text-amber-950 dark:text-amber-200 ring-1 ring-amber-400/70 dark:ring-amber-400/50 font-semibold'
                                      : 'bg-[#EFEFED] dark:bg-[#2A2A2A] text-[#6B6A66] dark:text-[#9B9A97]'
                                  }`}
                                >
                                  <Tag
                                    className={`w-2.5 h-2.5 ${
                                      isMatch ? 'text-amber-700 dark:text-amber-300' : 'text-[#8E8D8A]'
                                    }`}
                                  />
                                  <span>{tag}</span>
                                </span>
                              );
                            })}
                            {docFolders.slice(0, 2).map((folder) => (
                              <span
                                key={folder.id}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] leading-none text-[#6B6A66] dark:text-[#9B9A97] bg-[#F5F5F3] dark:bg-[#2A2A2A]"
                              >
                                <Folder className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                <span className="truncate max-w-[110px]">{folder.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer Hints */}
            <div className="px-4 py-2 border-t border-[#E8E8E5] dark:border-[#323232] bg-[#FBFBFA] dark:bg-[#202020] flex items-center justify-between text-[11.5px] text-[#6B6A66] dark:text-[#9B9A97]">
              <span>{t.searchResultsCount(sidebarFilteredDocs.length)}</span>
              <div className="flex items-center gap-3">
                {hasGlobalSearch && activeView !== 'documents' && (
                  <button
                    type="button"
                    onClick={() => {
                      handleNavigate('documents');
                      closeSearchPopover();
                    }}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer"
                  >
                    {t.navDocuments}
                  </button>
                )}
                <span className="hidden sm:inline-flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded border border-[#E4E4E0] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#262626] text-[10px]">
                    Esc
                  </kbd>
                  <span>{t.closeSearch}</span>
                </span>
              </div>
            </div>
          </div>
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

      {/* Auth Modal (Google OAuth + Email/Password) */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        t={t}
      />

      {/* Toast Notification Banner */}
      {toast && (
        <div
          role="status"
          className={`hd-modal-in no-print fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92vw] sm:w-auto px-4 py-2.5 rounded-xl shadow-xl border flex items-center gap-2.5 text-[14px] font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : toast.type === 'warning'
                  ? 'bg-amber-500 text-white border-amber-400'
                  : 'bg-[#262626] text-[#ECECEA] border-[#363636]'
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
            className="p-1 rounded-lg hover:bg-black/15 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      </div>
    </PomodoroProvider>
  );
}

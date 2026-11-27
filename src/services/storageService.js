/**
 * Modular Storage & Persistence Service
 * Uses IndexedDB for scalable structured/document persistence + localStorage for instant
 * settings & lightweight fallback, cleanly abstracted for future Firebase/cloud sync migration.
 */

const DB_NAME = 'HyperDocsStudyHubDB';
const DB_VERSION = 1;
const STORE_NAME = 'collections';

const LOCAL_PREFIX = 'hyperdocs_v1_';
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const SYSTEM_TAGS = ['Notes', 'PDF'];

export const KEYS = {
  TASKS: 'tasks',
  DOCUMENTS: 'documents',
  FOLDERS: 'folders',
  CUSTOM_TAGS: 'custom_tags',
  FLASHCARDS: 'flashcards',
  QUIZZES: 'quizzes',
  SETTINGS: 'settings',
  SRS_STATS: 'srs_stats',
  POMODORO_STATS: 'pomodoro_stats',
};

export function isSystemTag(tag) {
  const clean = String(tag || '').trim().toLowerCase();
  return SYSTEM_TAGS.some((st) => st.toLowerCase() === clean);
}

/**
 * Normalize the master tag registry (`customTags: string[]`), guaranteeing system tags
 * (`Notes`, `PDF`) are always preserved and removing duplicates case-insensitively.
 */
export function normalizeTagRegistry(rawTags, fallbackDocs = [], fallbackFolders = []) {
  const seen = new Set();
  const result = [];

  const pushTag = (raw) => {
    const clean = String(raw || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(clean);
  };

  // Always preserve system tags first
  SYSTEM_TAGS.forEach(pushTag);

  if (Array.isArray(rawTags)) {
    rawTags.forEach(pushTag);
  } else {
    // First-time migration from existing workspace: harvest existing document & folder tags
    (Array.isArray(fallbackDocs) ? fallbackDocs : []).forEach((doc) => {
      (doc?.tags || []).forEach(pushTag);
    });
    (Array.isArray(fallbackFolders) ? fallbackFolders : []).forEach((folder) => {
      (folder?.tags || []).forEach(pushTag);
    });
  }

  return result;
}

const DEFAULT_SETTINGS = {
  theme: 'light', // 'light' | 'dark'
  language: 'en', // 'en' | 'vi'
  density: 'comfortable', // 'comfortable' | 'compact'
};

export function getStarterFolders() {
  const now = Date.now();
  return [
    {
      id: 'folder_stem_core',
      name: 'STEM Core Finals',
      tags: ['Exam Prep', 'Semester 1'],
      createdAt: now - 3 * 24 * 60 * 60 * 1000,
    },
    {
      id: 'folder_formula_sheets',
      name: 'Formula Reference Sheets',
      tags: ['Math', 'Chemistry'],
      createdAt: now - 2 * 24 * 60 * 60 * 1000,
    },
  ];
}

export function getStarterDocuments() {
  const now = Date.now();
  return [
    {
      id: 'doc_sample_calculus',
      title: 'Calculus II — Integration & Euler’s Identity',
      tags: ['Calculus', 'Math', 'Exam Prep'],
      folderIds: ['folder_stem_core', 'folder_formula_sheets'],
      createdAt: now - 2 * 24 * 60 * 60 * 1000,
      updatedAt: now - 1 * 24 * 60 * 60 * 1000,
      content: `# Calculus II — Integration & Euler’s Identity

## 1. Fundamental Theorem of Calculus
If $f$ is continuous on $[a, b]$ and $F'(x) = f(x)$, then:

$$\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)$$

### Integration by Parts
When integrating a product of two functions $u(x)$ and $v'(x)$:

$$\\int u\\,dv = uv - \\int v\\,du$$

> **LIATE Priority Rule:** Logarithmic, Inverse trigonometric, Algebraic, Trigonometric, Exponential.

## 2. Taylor Series & Euler’s Formula
The Maclaurin series expansions for $e^x$, $\\sin x$, and $\\cos x$ are:

$$e^x = \\sum_{n=0}^{\\infty} \\frac{x^n}{n!}, \\quad \\cos x = \\sum_{n=0}^{\\infty} \\frac{(-1)^n x^{2n}}{(2n)!}, \\quad \\sin x = \\sum_{n=0}^{\\infty} \\frac{(-1)^n x^{2n+1}}{(2n+1)!}$$

Substituting $x = i\\theta$ yields **Euler’s Formula**:

$$e^{i\\theta} = \\cos\\theta + i\\sin\\theta$$

Setting $\\theta = \\pi$ produces **Euler’s Identity**:

$$e^{i\\pi} + 1 = 0$$

## 3. Gaussian Integral Reference
A cornerstone integral in probability theory and quantum mechanics:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$
`,
    },
    {
      id: 'doc_sample_chemistry',
      title: 'Chemical Thermodynamics & Acid-Base Equilibrium',
      tags: ['Chemistry', 'Thermodynamics'],
      folderIds: ['folder_stem_core'],
      createdAt: now - 1 * 24 * 60 * 60 * 1000,
      updatedAt: now - 6 * 60 * 60 * 1000,
      content: `# Chemical Thermodynamics & Acid-Base Equilibrium

## 1. Gibbs Free Energy
Spontaneity of a chemical reaction at constant temperature $T$ and pressure $P$ is governed by:

$$\\Delta G = \\Delta H - T\\Delta S$$

| Condition | Spontaneity |
| :--- | :--- |
| $\\Delta G < 0$ | Spontaneous (exergonic) |
| $\\Delta G = 0$ | System at dynamic equilibrium |
| $\\Delta G > 0$ | Non-spontaneous (endergonic) |

The relationship between standard Gibbs free energy change and equilibrium constant $K$ is:

$$\\Delta G^{\\circ} = -RT \\ln K$$

## 2. Esterification Equilibrium
Carboxylic acid reacting with an alcohol in acid catalyst forms an ester and water:

$$\\text{CH}_3\\text{COOH} + \\text{C}_2\\text{H}_5\\text{OH} \\xrightleftharpoons{\\text{H}_2\\text{SO}_4} \\text{CH}_3\\text{COOC}_2\\text{H}_5 + \\text{H}_2\\text{O}$$

## 3. Henderson–Hasselbalch Equation
For a weak acid buffer solution consisting of $\\text{HA}$ and its conjugate base $\\text{A}^-$:

$$\\text{pH} = \\text{p}K_a + \\log_{10}\\left(\\frac{[\\text{A}^-]}{[\\text{HA}]}\\right)$$
`,
    },
  ];
}

export function getStarterTasks() {
  const now = Date.now();
  return [
    {
      id: 'task_sample_1',
      title: 'Review Integration by Parts & Euler’s Identity',
      duration: 45,
      dueDate: new Date(now + 26 * 60 * 60 * 1000).toISOString(), // within 72h -> triggers '!' warning
      completed: false,
      completedAt: null,
      createdAt: now - 3600 * 1000,
    },
    {
      id: 'task_sample_2',
      title: 'Practice Gibbs Free Energy & Buffer Calculations',
      duration: 30,
      dueDate: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
      completed: false,
      completedAt: null,
      createdAt: now - 1800 * 1000,
    },
  ];
}

export function getStarterFlashcards() {
  const now = Date.now();
  return [
    {
      id: 'fc_sample_1',
      front: 'Write **Euler’s Identity** connecting $e$, $i$, $\\pi$, $1$, and $0$.',
      back: '$$e^{i\\pi} + 1 = 0$$\n\nDerived from $e^{i\\theta} = \\cos\\theta + i\\sin\\theta$ at $\\theta = \\pi$.',
      documentId: 'doc_sample_calculus',
      sourceTitle: 'Calculus II — Integration & Euler’s Identity',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      lapses: 0,
      createdAt: now - 3600 * 1000,
      lastReviewedAt: null,
      nextReviewAt: now - 1000,
    },
    {
      id: 'fc_sample_2',
      front: 'What is the **Gibbs Free Energy** equation and when is a reaction spontaneous?',
      back: '$$\\Delta G = \\Delta H - T\\Delta S$$\n\nA reaction is spontaneous at constant $T, P$ when **$\\Delta G < 0$**.',
      documentId: 'doc_sample_chemistry',
      sourceTitle: 'Chemical Thermodynamics & Acid-Base Equilibrium',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      lapses: 0,
      createdAt: now - 3500 * 1000,
      lastReviewedAt: null,
      nextReviewAt: now - 500,
    },
  ];
}

// ---------- IndexedDB Adapter ----------
let dbPromise = null;

function openDB() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ---------- LocalStorage Mirror Helpers ----------
function lsGet(key) {
  try {
    const raw = localStorage.getItem(`${LOCAL_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(`${LOCAL_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Ignore quota errors if large documents live in IndexedDB
  }
}

// ---------- 7-Day Task Auto-Purge Logic ----------
/**
 * Permanently removes completed tasks whose completedAt timestamp is older than 7 days.
 */
export function purgeExpiredCompletedTasks(tasks, now = Date.now()) {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((task) => {
    if (!task.completed) return true;
    const completedAt = task.completedAt || task.createdAt || now;
    return now - completedAt <= SEVEN_DAYS_MS;
  });
}

// ---------- Public Repository API ----------
export const storageService = {
  async loadCollection(key, fallbackFactory) {
    const fromIdb = await idbGet(key);
    if (fromIdb !== undefined) {
      return fromIdb;
    }
    const fromLs = lsGet(key);
    if (fromLs !== undefined) {
      await idbSet(key, fromLs);
      return fromLs;
    }
    const initial = typeof fallbackFactory === 'function' ? fallbackFactory() : fallbackFactory;
    await this.saveCollection(key, initial);
    return initial;
  },

  async saveCollection(key, value) {
    lsSet(key, value);
    await idbSet(key, value);
  },

  loadSettingsSync() {
    const saved = lsGet(KEYS.SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(saved || {}) };
  },

  async saveSettings(settings) {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    lsSet(KEYS.SETTINGS, merged);
    await idbSet(KEYS.SETTINGS, merged);
    return merged;
  },

  async loadAllData() {
    const [
      rawTasks,
      rawDocuments,
      folders,
      rawCustomTags,
      flashcards,
      quizzes,
      settings,
      srsStats,
      pomodoroStats,
    ] = await Promise.all([
      this.loadCollection(KEYS.TASKS, getStarterTasks),
      this.loadCollection(KEYS.DOCUMENTS, getStarterDocuments),
      this.loadCollection(KEYS.FOLDERS, getStarterFolders),
      idbGet(KEYS.CUSTOM_TAGS).then((val) => (val !== undefined ? val : lsGet(KEYS.CUSTOM_TAGS))),
      this.loadCollection(KEYS.FLASHCARDS, getStarterFlashcards),
      this.loadCollection(KEYS.QUIZZES, []),
      this.loadCollection(KEYS.SETTINGS, () => ({ ...DEFAULT_SETTINGS })),
      this.loadCollection(KEYS.SRS_STATS, () => ({ lastSession: null, totalReviewedAllTime: 0 })),
      this.loadCollection(KEYS.POMODORO_STATS, () => ({ completedSessions: 0, updatedAt: 0 })),
    ]);

    const cleanedTasks = purgeExpiredCompletedTasks(rawTasks);
    if (cleanedTasks.length !== rawTasks.length) {
      await this.saveCollection(KEYS.TASKS, cleanedTasks);
    }

    const documents = (Array.isArray(rawDocuments) ? rawDocuments : []).map((doc) => ({
      ...doc,
      folderIds: Array.isArray(doc.folderIds) ? doc.folderIds : [],
    }));
    const safeFolders = Array.isArray(folders) ? folders : [];

    const customTags = normalizeTagRegistry(rawCustomTags, documents, safeFolders);
    if (!Array.isArray(rawCustomTags) || rawCustomTags.length !== customTags.length) {
      await this.saveCollection(KEYS.CUSTOM_TAGS, customTags);
    }

    return {
      tasks: cleanedTasks,
      documents,
      folders: safeFolders,
      customTags,
      flashcards,
      quizzes,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      srsStats,
      pomodoroStats: pomodoroStats || { completedSessions: 0, updatedAt: 0 },
    };
  },

  async exportBackup() {
    const data = await this.loadAllData();
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      app: 'HyperDocs Study Hub',
      data,
    };
  },

  async importBackup(payload) {
    const source = payload?.data || payload;
    if (!source || typeof source !== 'object') {
      throw new Error('Invalid backup structure');
    }

    const tasks = purgeExpiredCompletedTasks(Array.isArray(source.tasks) ? source.tasks : []);
    const documents = (Array.isArray(source.documents) ? source.documents : []).map((doc) => ({
      ...doc,
      folderIds: Array.isArray(doc.folderIds) ? doc.folderIds : [],
    }));
    const folders = Array.isArray(source.folders) ? source.folders : [];
    const customTags = normalizeTagRegistry(
      Array.isArray(source.customTags) ? source.customTags : undefined,
      documents,
      folders
    );
    const flashcards = Array.isArray(source.flashcards) ? source.flashcards : [];
    const quizzes = Array.isArray(source.quizzes) ? source.quizzes : [];
    const srsStats = source.srsStats || { lastSession: null, totalReviewedAllTime: 0 };
    const pomodoroStats = source.pomodoroStats || { completedSessions: 0, updatedAt: 0 };
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(source.settings || {}),
    };

    await Promise.all([
      this.saveCollection(KEYS.TASKS, tasks),
      this.saveCollection(KEYS.DOCUMENTS, documents),
      this.saveCollection(KEYS.FOLDERS, folders),
      this.saveCollection(KEYS.CUSTOM_TAGS, customTags),
      this.saveCollection(KEYS.FLASHCARDS, flashcards),
      this.saveCollection(KEYS.QUIZZES, quizzes),
      this.saveCollection(KEYS.SRS_STATS, srsStats),
      this.saveCollection(KEYS.POMODORO_STATS, pomodoroStats),
      this.saveSettings(settings),
    ]);

    return {
      tasks,
      documents,
      folders,
      customTags,
      flashcards,
      quizzes,
      settings,
      srsStats,
      pomodoroStats,
    };
  },
};

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { purgeExpiredCompletedTasks } from '../services/storageService';

/**
 * Automatic Bidirectional Cloud Sync with Supabase (`public.user_workspaces`)
 *
 * Schema expected:
 *   public.user_workspaces (
 *     user_id uuid primary key references auth.users(id),
 *     workspace_data jsonb not null default '{}'::jsonb,
 *     updated_at timestamptz not null default now()
 *   )
 */

const WORKSPACE_TABLE = 'user_workspaces';

// Unique per-tab client ID to ignore self-echoes on Realtime updates
const CLIENT_INSTANCE_ID = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function getItemTimestamp(item) {
  if (!item || typeof item !== 'object') return 0;
  return Number(
    item.updatedAt || item.lastReviewedAt || item.completedAt || item.createdAt || 0
  );
}

/**
 * Merge two arrays of entities by `id`, keeping the newest `updatedAt` version
 * so no local or cloud edits are ever lost.
 */
export function mergeCollectionById(localItems = [], cloudItems = []) {
  const map = new Map();

  for (const item of Array.isArray(cloudItems) ? cloudItems : []) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }

  for (const item of Array.isArray(localItems) ? localItems : []) {
    if (!item || !item.id) continue;
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      const localTs = getItemTimestamp(item);
      const cloudTs = getItemTimestamp(existing);
      if (localTs >= cloudTs) {
        map.set(item.id, item);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Normalize & merge local and cloud workspace snapshots intelligently.
 */
export function mergeWorkspaces(localSnapshot, cloudSnapshot) {
  const local = localSnapshot || {};
  const cloud = cloudSnapshot || {};

  const documents = mergeCollectionById(local.documents, cloud.documents).map((doc) => ({
    ...doc,
    folderIds: Array.isArray(doc.folderIds) ? doc.folderIds : [],
  }));

  const folders = mergeCollectionById(local.folders, cloud.folders);
  const tasks = purgeExpiredCompletedTasks(mergeCollectionById(local.tasks, cloud.tasks));
  const flashcards = mergeCollectionById(local.flashcards, cloud.flashcards);
  const quizzes = mergeCollectionById(local.quizzes, cloud.quizzes);

  const localSrs = local.srsStats || { lastSession: null, totalReviewedAllTime: 0 };
  const cloudSrs = cloud.srsStats || { lastSession: null, totalReviewedAllTime: 0 };
  const localSessionTs = Number(localSrs.lastSession?.completedAt || 0);
  const cloudSessionTs = Number(cloudSrs.lastSession?.completedAt || 0);
  const srsStats = {
    totalReviewedAllTime: Math.max(
      Number(localSrs.totalReviewedAllTime || 0),
      Number(cloudSrs.totalReviewedAllTime || 0)
    ),
    lastSession: localSessionTs >= cloudSessionTs ? localSrs.lastSession : cloudSrs.lastSession,
  };

  const localPomo = local.pomodoroStats || { completedSessions: 0, updatedAt: 0 };
  const cloudPomo = cloud.pomodoroStats || { completedSessions: 0, updatedAt: 0 };
  const pomodoroStats = {
    completedSessions: Math.max(
      Number(localPomo.completedSessions || 0),
      Number(cloudPomo.completedSessions || 0)
    ),
    updatedAt: Math.max(Number(localPomo.updatedAt || 0), Number(cloudPomo.updatedAt || 0)),
  };

  return {
    schemaVersion: 2,
    documents,
    folders,
    tasks,
    flashcards,
    quizzes,
    srsStats,
    pomodoroStats,
    updatedAt: Date.now(),
  };
}

function isEmptyWorkspaceData(data) {
  if (!data || typeof data !== 'object') return true;
  const hasDocs = Array.isArray(data.documents) && data.documents.length > 0;
  const hasFolders = Array.isArray(data.folders) && data.folders.length > 0;
  const hasTasks = Array.isArray(data.tasks) && data.tasks.length > 0;
  const hasCards = Array.isArray(data.flashcards) && data.flashcards.length > 0;
  const hasQuizzes = Array.isArray(data.quizzes) && data.quizzes.length > 0;
  return !hasDocs && !hasFolders && !hasTasks && !hasCards && !hasQuizzes;
}

/**
 * Fetch the authenticated user's cloud workspace row from `public.user_workspaces`.
 */
export async function fetchCloudWorkspace(userId) {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from(WORKSPACE_TABLE)
    .select('workspace_data, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data?.workspace_data || null,
    updatedAt: data?.updated_at || null,
    error: null,
  };
}

/**
 * Upsert the user's workspace snapshot into `public.user_workspaces`.
 */
export async function upsertCloudWorkspace(userId, snapshot) {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return { error: new Error('Supabase is not configured.') };
  }

  const payload = {
    ...snapshot,
    schemaVersion: 2,
    clientInstanceId: CLIENT_INSTANCE_ID,
    updatedAt: Date.now(),
  };

  const { error } = await supabase.from(WORKSPACE_TABLE).upsert(
    {
      user_id: userId,
      workspace_data: payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  return { error: error || null };
}

/**
 * First sign-in / manual bidirectional sync:
 *  - If cloud is empty and local has data -> uploads local snapshot to cloud.
 *  - If both exist -> merges by `id` keeping newest `updatedAt`, uploads merged snapshot,
 *    and returns the merged workspace so local state + IndexedDB/localStorage stay in sync.
 */
export async function syncWorkspaceBidirectional(userId, localSnapshot) {
  const { data: cloudData, error: fetchError } = await fetchCloudWorkspace(userId);
  if (fetchError) {
    return { merged: null, error: fetchError };
  }

  const cloudEmpty = isEmptyWorkspaceData(cloudData);
  const localEmpty = isEmptyWorkspaceData(localSnapshot);

  let merged;
  if (cloudEmpty && !localEmpty) {
    merged = {
      ...localSnapshot,
      schemaVersion: 2,
      updatedAt: Date.now(),
    };
  } else if (!cloudEmpty && localEmpty) {
    merged = mergeWorkspaces({}, cloudData);
  } else if (cloudEmpty && localEmpty) {
    merged = {
      ...localSnapshot,
      schemaVersion: 2,
      updatedAt: Date.now(),
    };
  } else {
    merged = mergeWorkspaces(localSnapshot, cloudData);
  }

  const { error: upsertError } = await upsertCloudWorkspace(userId, merged);
  if (upsertError) {
    return { merged, error: upsertError };
  }

  return { merged, error: null };
}

/**
 * Subscribe to real-time updates on `public.user_workspaces` for cross-device sync.
 * Ignores echo events written by this same browser tab.
 */
export function subscribeToCloudWorkspace(userId, onRemoteWorkspace) {
  if (!isSupabaseConfigured || !supabase || !userId) {
    return () => {};
  }

  const channel = supabase
    .channel(`workspace_sync_${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: WORKSPACE_TABLE,
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const remote = payload?.new?.workspace_data;
        if (!remote || typeof remote !== 'object') return;
        if (remote.clientInstanceId === CLIENT_INSTANCE_ID) return;
        onRemoteWorkspace(remote);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

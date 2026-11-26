import React from 'react';
import { Cloud, CloudOff, Loader2, RefreshCw, LogOut } from 'lucide-react';

export default function CloudSyncWidget({
  user,
  syncStatus, // 'idle' | 'synced' | 'syncing' | 'offline' | 'error'
  onOpenAuth,
  onSyncNow,
  onSignOut,
  t,
}) {
  if (!user) {
    return (
      <div className="px-2.5 pb-2 shrink-0">
        <button
          type="button"
          onClick={onOpenAuth}
          className="w-full min-h-[38px] px-2.5 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#262626] hover:bg-[#F3F3F1] dark:hover:bg-[#2F2F2F] text-[#18181B] dark:text-[#E4E4E7] text-[13px] font-medium flex items-center gap-2 transition-colors duration-150 cursor-pointer"
        >
          <Cloud className="w-4 h-4 text-[#52525B] dark:text-[#A1A1AA] shrink-0" />
          <span className="truncate">{t.signInCloudSync}</span>
        </button>
      </div>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
  const displayName = user.user_metadata?.full_name || user.email || 'Account';
  const initials = (user.email || displayName).slice(0, 2).toUpperCase();

  const statusConfig = {
    synced: {
      dot: 'bg-emerald-500',
      text: t.syncStatusSynced,
      textCls: 'text-emerald-700 dark:text-emerald-400',
    },
    syncing: {
      dot: null,
      text: t.syncStatusSyncing,
      textCls: 'text-[#2563EB] dark:text-[#60A5FA]',
    },
    offline: {
      dot: 'bg-amber-500',
      text: t.syncStatusOffline,
      textCls: 'text-amber-600 dark:text-amber-400',
    },
    error: {
      dot: 'bg-rose-500',
      text: t.syncStatusOffline,
      textCls: 'text-rose-600 dark:text-rose-400',
    },
    idle: {
      dot: 'bg-[#9B9A97]',
      text: t.syncStatusSynced,
      textCls: 'text-[#787774] dark:text-[#9B9A97]',
    },
  }[syncStatus || 'synced'];

  return (
    <div className="px-2.5 pb-2 shrink-0">
      <div className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#262626] p-2.5 space-y-2">
        {/* User Row */}
        <div className="flex items-center gap-2 min-w-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-full object-cover shrink-0 border border-[#E8E8E5] dark:border-[#3A3A3A]"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#E4E4E7] dark:bg-[#323232] text-[#18181B] dark:text-[#E4E4E7] text-[11px] font-bold flex items-center justify-center shrink-0">
              {initials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[#262624] dark:text-[#ECECEA] truncate leading-tight">
              {user.email || displayName}
            </p>
            <div className={`flex items-center gap-1.5 text-[11px] font-medium mt-0.5 ${statusConfig.textCls}`}>
              {syncStatus === 'syncing' ? (
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              ) : syncStatus === 'offline' ? (
                <CloudOff className="w-3 h-3 shrink-0" />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusConfig.dot}`} />
              )}
              <span className="truncate">{statusConfig.text}</span>
            </div>
          </div>
        </div>

        {/* Manual Sync Now + Sign Out Actions */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-[#E8E8E5] dark:border-[#2F2F2F]">
          <button
            type="button"
            disabled={syncStatus === 'syncing'}
            onClick={onSyncNow}
            title={t.syncNow}
            className="flex-1 min-h-[30px] px-2 rounded-lg bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] disabled:opacity-50 text-[12px] font-medium text-[#4F4E4B] dark:text-[#C5C4C0] inline-flex items-center justify-center gap-1 transition-colors duration-150 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            <span className="truncate">{t.syncNow}</span>
          </button>

          <button
            type="button"
            onClick={onSignOut}
            title={t.signOut}
            aria-label={t.signOut}
            className="min-h-[30px] px-2 rounded-lg hover:bg-rose-500/10 text-[#6B6A66] dark:text-[#9B9A97] hover:text-rose-600 dark:hover:text-rose-400 inline-flex items-center justify-center gap-1 text-[12px] font-medium transition-colors duration-150 shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

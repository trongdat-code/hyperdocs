import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  Coffee,
  Brain,
  CheckCircle2,
  Bell,
  BellOff,
  Repeat,
} from 'lucide-react';
import { formatMMSS, usePomodoro } from '../../context/PomodoroContext';

export default function FocusMode({
  activeTasks,
  selectedTask,
  onSelectTask,
  t,
}) {
  const {
    mode,
    timeLeft,
    totalPhaseSeconds,
    isRunning,
    completedSessions,
    studyMinutes,
    shortBreakMinutes,
    taskCapMinutes,
    soundMuted,
    autoTransition,
    lastCompletedType,
    toggleStartPause,
    resetTimer,
    switchMode,
    updateStudyMinutes,
    updateShortBreakMinutes,
    toggleSoundMuted,
    toggleAutoTransition,
  } = usePomodoro();

  const [isDimFullscreen, setIsDimFullscreen] = useState(false);

  useEffect(() => {
    if (!isDimFullscreen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsDimFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDimFullscreen]);

  const progress =
    totalPhaseSeconds > 0 ? (totalPhaseSeconds - timeLeft) / totalPhaseSeconds : 0;

  const radius = 142;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  const isBreakMode = mode === 'shortBreak' || mode === 'longBreak';
  const ringColor = mode === 'focus' ? '#6366F1' : mode === 'longBreak' ? '#0EA5E9' : '#10B981';

  const noticeText =
    lastCompletedType === 'longBreakReady'
      ? t.sessionCompleteLongBreak
      : lastCompletedType === 'focus'
        ? t.sessionCompleteStudy
        : lastCompletedType === 'break'
          ? t.sessionCompleteBreak
          : '';

  const cycleProgress = completedSessions % 4;

  const renderTimerBody = (fullscreenMode) => (
    <div
      className={`flex flex-col items-center justify-between h-full w-full overflow-y-auto px-6 py-6 sm:py-8 ${
        fullscreenMode
          ? 'bg-[#191919] text-[#E8E8E6]'
          : 'bg-[#FFFFFF] dark:bg-[#191919] text-[#2F2F2F] dark:text-[#E8E8E6]'
      }`}
    >
      {/* Top Bar: Active Task + Sound Bell Toggle + Fullscreen Toggle */}
      <div className="w-full max-w-3xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              fullscreenMode
                ? 'bg-[#262626] text-indigo-400'
                : 'bg-[#F7F7F5] dark:bg-[#262626] text-indigo-600 dark:text-indigo-400 border border-[#E5E5E3] dark:border-[#2F2F2F]'
            }`}
          >
            {isBreakMode ? <Coffee className="w-5 h-5" /> : <Brain className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-[12px] uppercase tracking-wider font-semibold text-[#787774] dark:text-[#9B9A97]">
              {t.activeTaskLabel}
            </p>
            <h1 className="text-[17px] sm:text-[19px] font-semibold truncate">
              {selectedTask ? selectedTask.title : t.noTaskSelected}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mute / Unmute Bell Chime Toggle */}
          <button
            type="button"
            onClick={toggleSoundMuted}
            title={soundMuted ? t.soundMuted : t.soundOn}
            aria-label={soundMuted ? t.soundMuted : t.soundOn}
            className={`min-h-[40px] px-3 rounded-xl text-[13px] font-medium inline-flex items-center gap-1.5 border transition ${
              soundMuted
                ? fullscreenMode
                  ? 'border-[#3A3A3A] bg-[#202020] text-[#9B9A97]'
                  : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] text-[#787774] dark:text-[#9B9A97]'
                : fullscreenMode
                  ? 'border-[#3A3A3A] bg-[#262626] hover:bg-[#323232] text-[#E8E8E6]'
                  : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]'
            }`}
          >
            {soundMuted ? (
              <BellOff className="w-4 h-4 text-rose-500" />
            ) : (
              <Bell className="w-4 h-4 text-indigo-500" />
            )}
            <span className="hidden sm:inline">{soundMuted ? t.soundMuted : t.soundOn}</span>
          </button>

          {/* Dim & Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsDimFullscreen((prev) => !prev)}
            className={`min-h-[40px] px-3.5 rounded-xl text-[13px] font-medium inline-flex items-center gap-2 border transition ${
              fullscreenMode
                ? 'border-[#3A3A3A] bg-[#262626] hover:bg-[#323232] text-[#E8E8E6]'
                : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]'
            }`}
          >
            {fullscreenMode ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">
              {fullscreenMode ? t.exitFullscreenFocus : t.fullscreenFocus}
            </span>
          </button>
        </div>
      </div>

      {/* Centered Giant High-Contrast Pomodoro Countdown Clock */}
      <div className="flex flex-col items-center justify-center my-5">
        {/* 3-Mode Phase Pills: Focus / Short Break / Long Break */}
        <div
          className={`inline-flex items-center gap-1 p-1 rounded-full mb-5 ${
            fullscreenMode ? 'bg-[#262626]' : 'bg-[#F1F1EF] dark:bg-[#262626]'
          }`}
        >
          <button
            type="button"
            onClick={() => switchMode('focus')}
            className={`min-h-[36px] px-4 rounded-full text-[13px] sm:text-[14px] font-medium transition ${
              mode === 'focus'
                ? 'bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] shadow-sm'
                : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
            }`}
          >
            {t.studyPhase}
          </button>
          <button
            type="button"
            onClick={() => switchMode('shortBreak')}
            className={`min-h-[36px] px-4 rounded-full text-[13px] sm:text-[14px] font-medium transition ${
              mode === 'shortBreak'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
            }`}
          >
            {t.breakPhase}
          </button>
          <button
            type="button"
            onClick={() => switchMode('longBreak')}
            className={`min-h-[36px] px-4 rounded-full text-[13px] sm:text-[14px] font-medium transition ${
              mode === 'longBreak'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
            }`}
          >
            {t.longBreakPhase}
          </button>
        </div>

        {/* Circular Progress + Giant Clock */}
        <div className="relative flex items-center justify-center w-[280px] h-[280px] sm:w-[330px] sm:h-[330px]">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 320 320">
            <circle
              cx="160"
              cy="160"
              r={radius}
              fill="none"
              stroke={fullscreenMode ? '#2F2F2F' : 'currentColor'}
              className={fullscreenMode ? '' : 'text-[#EBEBE8] dark:text-[#2A2A2A]'}
              strokeWidth="10"
            />
            <circle
              cx="160"
              cy="160"
              r={radius}
              fill="none"
              stroke={ringColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-300 ease-linear"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <span className="text-6xl sm:text-7xl font-extrabold tracking-tight tabular-nums">
              {formatMMSS(timeLeft)}
            </span>
            <span className="mt-2 text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
              {mode === 'focus' ? t.maxCappedAt(taskCapMinutes) : mode === 'longBreak' ? t.longBreakPhase : t.breakPhase}
            </span>

            {/* Completed Focus Sessions Indicator (4-session cycle) */}
            <div className="mt-3 flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2, 3].map((dotIdx) => {
                  const filled =
                    completedSessions > 0 &&
                    (cycleProgress === 0 ? true : dotIdx < cycleProgress);
                  return (
                    <span
                      key={dotIdx}
                      className={`w-2 h-2 rounded-full transition ${
                        filled
                          ? 'bg-indigo-500'
                          : fullscreenMode
                            ? 'bg-[#3A3A3A]'
                            : 'bg-[#D3D3CF] dark:bg-[#3A3A3A]'
                      }`}
                    />
                  );
                })}
              </div>
              <span className="text-[12px] font-medium text-[#787774] dark:text-[#9B9A97]">
                {t.completedSessionsLabel}: {completedSessions}
              </span>
            </div>
          </div>
        </div>

        {noticeText && (
          <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[13px] font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{noticeText}</span>
          </div>
        )}

        {/* Primary Playback Controls */}
        <div className="flex items-center gap-3 mt-6">
          <button
            type="button"
            onClick={toggleStartPause}
            className="min-h-[48px] px-8 rounded-xl bg-[#2F2F2F] hover:bg-[#191919] dark:bg-[#E8E8E6] dark:hover:bg-white text-white dark:text-[#191919] font-semibold text-[15px] inline-flex items-center gap-2 shadow-sm transition active:scale-[0.98]"
          >
            {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isRunning ? t.pauseTimer : t.startTimer}</span>
          </button>

          <button
            type="button"
            onClick={resetTimer}
            title={t.resetTimer}
            className={`min-h-[48px] px-4 rounded-xl border font-medium text-[14px] inline-flex items-center gap-2 transition ${
              fullscreenMode
                ? 'border-[#3A3A3A] bg-[#262626] hover:bg-[#323232] text-[#E8E8E6]'
                : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">{t.resetTimer}</span>
          </button>
        </div>
      </div>

      {/* Bottom Controls: Task Picker + Custom Capped Intervals + Auto-Transition Switch */}
      <div
        className={`w-full max-w-2xl rounded-2xl border p-4 space-y-4 ${
          fullscreenMode
            ? 'border-[#2F2F2F] bg-[#202020]'
            : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020]'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-[#787774] dark:text-[#9B9A97] mb-1.5">
              {t.activeTaskLabel}
            </label>
            <select
              value={selectedTask?.id || ''}
              onChange={(e) => onSelectTask(e.target.value)}
              className={`w-full h-[40px] px-3 rounded-lg border text-[13px] truncate focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                fullscreenMode
                  ? 'bg-[#191919] border-[#3A3A3A] text-[#E8E8E6]'
                  : 'bg-[#FFFFFF] dark:bg-[#191919] border-[#E5E5E3] dark:border-[#3A3A3A] text-[#2F2F2F] dark:text-[#E8E8E6]'
              }`}
            >
              {activeTasks.length === 0 ? (
                <option value="">{t.noTaskSelected}</option>
              ) : (
                activeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} ({task.duration}m)
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-[12px] font-semibold text-[#787774] dark:text-[#9B9A97] mb-1.5">
              <span>{t.studyDuration}</span>
              <span className="text-indigo-600 dark:text-indigo-400">
                {studyMinutes} / {taskCapMinutes}m
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={taskCapMinutes}
              step={5}
              value={studyMinutes}
              onChange={(e) => updateStudyMinutes(e.target.value)}
              className="w-full accent-indigo-500 mt-2 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-[12px] font-semibold text-[#787774] dark:text-[#9B9A97] mb-1.5">
              <span>{t.breakDuration}</span>
              <span className="text-emerald-600 dark:text-emerald-400">{shortBreakMinutes}m</span>
            </div>
            <input
              type="range"
              min={1}
              max={Math.min(15, Math.floor(taskCapMinutes / 3))}
              step={1}
              value={shortBreakMinutes}
              onChange={(e) => updateShortBreakMinutes(e.target.value)}
              className="w-full accent-emerald-500 mt-2 cursor-pointer"
            />
          </div>
        </div>

        {/* Auto-start Breaks & Focus Toggle Switch */}
        <div
          className={`pt-3 border-t flex items-center justify-between gap-3 ${
            fullscreenMode ? 'border-[#2F2F2F]' : 'border-[#E5E5E3] dark:border-[#2F2F2F]'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Repeat className="w-4 h-4 text-indigo-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate">{t.autoTransitionLabel}</p>
              <p className="text-[12px] text-[#787774] dark:text-[#9B9A97] truncate">
                {t.autoTransitionHint}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={autoTransition}
            onClick={toggleAutoTransition}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
              autoTransition
                ? 'bg-indigo-600'
                : fullscreenMode
                  ? 'bg-[#3A3A3A]'
                  : 'bg-[#D3D3CF] dark:bg-[#3A3A3A]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition duration-200 ${
                autoTransition ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="h-full min-h-0 w-full">{renderTimerBody(false)}</div>
      {isDimFullscreen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 no-print" role="dialog" aria-modal="true">
            {renderTimerBody(true)}
          </div>,
          document.body
        )}
    </>
  );
}

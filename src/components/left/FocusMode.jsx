import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Flame,
  Play,
  Pause,
  RotateCcw,
  Maximize2,
  Minimize2,
  Coffee,
  Brain,
  CheckCircle2,
} from 'lucide-react';

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.16 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.16 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.42);
    });
  } catch {
    // Ignore audio context restrictions
  }
}

function formatMMSS(totalSeconds) {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function FocusMode({
  activeTasks,
  selectedTask,
  onSelectTask,
  isFocusMode,
  onEnterFocusMode,
  onExitFocusMode,
  t,
  density,
}) {
  // Max study duration strictly capped by selected task's allocated duration (30-60 mins)
  const taskCapMinutes = selectedTask
    ? Math.min(60, Math.max(30, Number(selectedTask.duration) || 45))
    : 45;

  const [studyMinutes, setStudyMinutes] = useState(Math.min(25, taskCapMinutes));
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [phase, setPhase] = useState('study'); // 'study' | 'break'
  const [secondsLeft, setSecondsLeft] = useState(Math.min(25, taskCapMinutes) * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');

  const prevTaskIdRef = useRef(selectedTask?.id);

  // Sync timer cap when selected task changes
  useEffect(() => {
    if (selectedTask?.id !== prevTaskIdRef.current) {
      prevTaskIdRef.current = selectedTask?.id;
      const newCap = selectedTask ? Math.min(60, Math.max(30, selectedTask.duration)) : 45;
      setStudyMinutes((prev) => {
        const clamped = Math.min(prev, newCap);
        if (!isRunning && phase === 'study') {
          setSecondsLeft(clamped * 60);
        }
        return clamped;
      });
    } else if (studyMinutes > taskCapMinutes) {
      setStudyMinutes(taskCapMinutes);
      if (!isRunning && phase === 'study') {
        setSecondsLeft(taskCapMinutes * 60);
      }
    }
  }, [selectedTask, taskCapMinutes, isRunning, phase, studyMinutes]);

  // Countdown tick
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          playCompletionChime();
          setSessionNotice(phase === 'study' ? t.sessionCompleteStudy : t.sessionCompleteBreak);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, phase, t.sessionCompleteStudy, t.sessionCompleteBreak]);

  // Allow ESC key to exit Focus Mode
  useEffect(() => {
    if (!isFocusMode) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onExitFocusMode();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isFocusMode, onExitFocusMode]);

  const totalPhaseSeconds = (phase === 'study' ? studyMinutes : breakMinutes) * 60;
  const progress = totalPhaseSeconds > 0 ? (totalPhaseSeconds - secondsLeft) / totalPhaseSeconds : 0;

  const handleStudyMinutesChange = (val) => {
    const clamped = Math.min(taskCapMinutes, Math.max(5, Number(val) || 5));
    setStudyMinutes(clamped);
    if (phase === 'study') {
      setIsRunning(false);
      setSecondsLeft(clamped * 60);
      setSessionNotice('');
    }
  };

  const handleBreakMinutesChange = (val) => {
    const maxBreak = Math.min(15, Math.floor(taskCapMinutes / 3));
    const clamped = Math.min(maxBreak, Math.max(1, Number(val) || 5));
    setBreakMinutes(clamped);
    if (phase === 'break') {
      setIsRunning(false);
      setSecondsLeft(clamped * 60);
      setSessionNotice('');
    }
  };

  const handleReset = () => {
    setIsRunning(false);
    setSessionNotice('');
    setSecondsLeft((phase === 'study' ? studyMinutes : breakMinutes) * 60);
  };

  const handleSwitchPhase = (nextPhase) => {
    const target = nextPhase || (phase === 'study' ? 'break' : 'study');
    setPhase(target);
    setIsRunning(false);
    setSessionNotice('');
    setSecondsLeft((target === 'study' ? studyMinutes : breakMinutes) * 60);
  };

  const pad = density === 'compact' ? 'p-2.5' : 'p-3.5';

  // SVG progress circle math
  const radius = 148;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <>
      {/* Sidebar Middle 1/3 Widget */}
      <section
        className={`flex flex-col h-full min-h-0 ${pad} bg-gradient-to-b from-slate-50/70 to-white dark:from-slate-900/60 dark:to-[#0F172A]`}
      >
        <div className="flex items-center justify-between gap-1.5 mb-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Flame className="w-4 h-4 text-orange-500 shrink-0" />
            <h2 className="font-semibold text-[17px] leading-tight truncate text-slate-900 dark:text-slate-100">
              {t.focusTitle}
            </h2>
          </div>
          <span
            title={phase === 'study' ? t.studyPhase : t.breakPhase}
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isRunning
                ? 'bg-emerald-500 animate-pulse'
                : phase === 'study'
                  ? 'bg-indigo-400'
                  : 'bg-emerald-400'
            }`}
          />
        </div>

        {/* Focus Preview Card (no nested interactive elements) */}
        <div className="flex-1 min-h-0 flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#09090B] hover:border-indigo-400 dark:hover:border-indigo-500 p-2.5 transition shadow-sm">
          <div className="shrink-0">
            <select
              value={selectedTask?.id || ''}
              onChange={(e) => onSelectTask(e.target.value)}
              className="w-full min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 truncate"
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

          {/* Clickable Clock Preview */}
          <button
            type="button"
            onClick={onEnterFocusMode}
            className="text-center my-1 py-1 rounded-xl hover:bg-indigo-50/70 dark:hover:bg-indigo-950/30 transition group"
          >
            <div className="text-3xl xl:text-4xl font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
              {formatMMSS(secondsLeft)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate px-1">
              {t.maxCappedAt(taskCapMinutes)}
            </p>
          </button>

          {/* Enter Focus Mode CTA */}
          <button
            type="button"
            onClick={onEnterFocusMode}
            className="w-full min-h-[38px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-xs font-semibold transition shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>{t.enterFocusMode}</span>
          </button>
        </div>
      </section>

      {/* Distraction-Free Full-Screen Focus Mode Overlay (Portaled to document.body) */}
      {isFocusMode &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#09090B]/95 backdrop-blur-xl text-white p-6 overflow-y-auto no-print"
            role="dialog"
            aria-modal="true"
            aria-label={t.focusTitle}
          >
          {/* Top Bar: Active Task & Exit Button */}
          <div className="w-full max-w-3xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-300 shrink-0">
                {phase === 'study' ? <Brain className="w-5 h-5" /> : <Coffee className="w-5 h-5" />}
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                  {t.activeTaskLabel}
                </p>
                <h2 className="text-[17px] sm:text-xl font-bold text-white truncate">
                  {selectedTask ? selectedTask.title : t.noTaskSelected}
                </h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onExitFocusMode}
              className="touch-target inline-flex items-center gap-2 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-slate-100 text-sm font-semibold transition shrink-0"
            >
              <Minimize2 className="w-4 h-4" />
              <span>{t.exitFocusMode}</span>
            </button>
          </div>

          {/* Center Giant High-Contrast Pomodoro Countdown Clock */}
          <div className="flex flex-col items-center justify-center my-6">
            {/* Phase Switcher Pills */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/10 mb-6">
              <button
                type="button"
                onClick={() => handleSwitchPhase('study')}
                className={`min-h-[40px] px-5 rounded-full text-sm font-semibold transition ${
                  phase === 'study'
                    ? 'bg-indigo-500 text-white shadow-lg'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {t.studyPhase}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchPhase('break')}
                className={`min-h-[40px] px-5 rounded-full text-sm font-semibold transition ${
                  phase === 'break'
                    ? 'bg-emerald-500 text-white shadow-lg'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {t.breakPhase}
              </button>
            </div>

            {/* Giant Circular Timer */}
            <div className="relative flex items-center justify-center w-[310px] h-[310px] sm:w-[350px] sm:h-[350px]">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 340 340">
                <circle
                  cx="170"
                  cy="170"
                  r={radius}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="12"
                />
                <circle
                  cx="170"
                  cy="170"
                  r={radius}
                  fill="none"
                  stroke={phase === 'study' ? '#818CF8' : '#34D399'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-700 ease-linear"
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
                <span className="text-6xl sm:text-7xl font-black tracking-tight tabular-nums text-white drop-shadow">
                  {formatMMSS(secondsLeft)}
                </span>
                <span className="mt-2 text-sm font-medium text-slate-400">
                  {t.maxCappedAt(taskCapMinutes)}
                </span>
              </div>
            </div>

            {/* Completion Notice */}
            {sessionNotice && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{sessionNotice}</span>
              </div>
            )}

            {/* Primary Playback Controls */}
            <div className="flex items-center gap-4 mt-7">
              <button
                type="button"
                onClick={() => {
                  setSessionNotice('');
                  setIsRunning((prev) => !prev);
                }}
                className="min-h-[52px] px-8 rounded-2xl bg-white text-slate-950 hover:bg-indigo-100 font-bold text-[17px] inline-flex items-center gap-2.5 shadow-xl transition active:scale-[0.98]"
              >
                {isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
                <span>{isRunning ? t.pauseTimer : t.startTimer}</span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="touch-target min-h-[52px] px-5 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold inline-flex items-center gap-2 transition"
                title={t.resetTimer}
              >
                <RotateCcw className="w-5 h-5" />
                <span className="hidden sm:inline">{t.resetTimer}</span>
              </button>
            </div>
          </div>

          {/* Bottom Controls: Task Switcher + Custom Intervals strictly capped by task duration */}
          <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white/5 border border-white/10 rounded-2xl p-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                {t.activeTaskLabel}
              </label>
              <select
                value={selectedTask?.id || ''}
                onChange={(e) => onSelectTask(e.target.value)}
                className="w-full h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white truncate focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
                <span>{t.studyDuration}</span>
                <span className="text-indigo-300">
                  {studyMinutes} / {taskCapMinutes}m
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={taskCapMinutes}
                step={5}
                value={studyMinutes}
                onChange={(e) => handleStudyMinutesChange(e.target.value)}
                className="w-full accent-indigo-400 mt-2 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-1">
                <span>{t.breakDuration}</span>
                <span className="text-emerald-300">{breakMinutes}m</span>
              </div>
              <input
                type="range"
                min={1}
                max={Math.min(15, Math.floor(taskCapMinutes / 3))}
                step={1}
                value={breakMinutes}
                onChange={(e) => handleBreakMinutesChange(e.target.value)}
                className="w-full accent-emerald-400 mt-2 cursor-pointer"
              />
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
}

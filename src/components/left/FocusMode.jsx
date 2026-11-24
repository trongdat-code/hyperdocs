import React, { useEffect, useRef, useState } from 'react';
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
  t,
}) {
  const taskCapMinutes = selectedTask
    ? Math.min(60, Math.max(30, Number(selectedTask.duration) || 45))
    : 45;

  const [studyMinutes, setStudyMinutes] = useState(Math.min(25, taskCapMinutes));
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [phase, setPhase] = useState('study'); // 'study' | 'break'
  const [secondsLeft, setSecondsLeft] = useState(Math.min(25, taskCapMinutes) * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isDimFullscreen, setIsDimFullscreen] = useState(false);
  const [sessionNotice, setSessionNotice] = useState('');

  const prevTaskIdRef = useRef(selectedTask?.id);

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

  useEffect(() => {
    if (!isDimFullscreen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setIsDimFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDimFullscreen]);

  const totalPhaseSeconds = (phase === 'study' ? studyMinutes : breakMinutes) * 60;
  const progress =
    totalPhaseSeconds > 0 ? (totalPhaseSeconds - secondsLeft) / totalPhaseSeconds : 0;

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

  const handleSwitchPhase = (target) => {
    setPhase(target);
    setIsRunning(false);
    setSessionNotice('');
    setSecondsLeft((target === 'study' ? studyMinutes : breakMinutes) * 60);
  };

  const radius = 142;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  const renderTimerBody = (fullscreenMode) => (
    <div
      className={`flex flex-col items-center justify-between h-full w-full overflow-y-auto px-6 py-6 sm:py-8 ${
        fullscreenMode
          ? 'bg-[#191919] text-[#E8E8E6]'
          : 'bg-[#FFFFFF] dark:bg-[#191919] text-[#2F2F2F] dark:text-[#E8E8E6]'
      }`}
    >
      {/* Top Bar: Active Task + Fullscreen Toggle */}
      <div className="w-full max-w-3xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              fullscreenMode
                ? 'bg-[#262626] text-indigo-400'
                : 'bg-[#F7F7F5] dark:bg-[#262626] text-indigo-600 dark:text-indigo-400 border border-[#E5E5E3] dark:border-[#2F2F2F]'
            }`}
          >
            {phase === 'study' ? <Brain className="w-5 h-5" /> : <Coffee className="w-5 h-5" />}
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

        <button
          type="button"
          onClick={() => setIsDimFullscreen((prev) => !prev)}
          className={`min-h-[40px] px-3.5 rounded-xl text-[13px] font-medium inline-flex items-center gap-2 border transition shrink-0 ${
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
          <span>{fullscreenMode ? t.exitFullscreenFocus : t.fullscreenFocus}</span>
        </button>
      </div>

      {/* Centered Giant High-Contrast Pomodoro Countdown Clock */}
      <div className="flex flex-col items-center justify-center my-6">
        {/* Phase Pills */}
        <div
          className={`inline-flex items-center gap-1 p-1 rounded-full mb-6 ${
            fullscreenMode ? 'bg-[#262626]' : 'bg-[#F1F1EF] dark:bg-[#262626]'
          }`}
        >
          <button
            type="button"
            onClick={() => handleSwitchPhase('study')}
            className={`min-h-[38px] px-5 rounded-full text-[14px] font-medium transition ${
              phase === 'study'
                ? 'bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] shadow-sm'
                : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
            }`}
          >
            {t.studyPhase}
          </button>
          <button
            type="button"
            onClick={() => handleSwitchPhase('break')}
            className={`min-h-[38px] px-5 rounded-full text-[14px] font-medium transition ${
              phase === 'break'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-[#787774] dark:text-[#9B9A97] hover:text-[#2F2F2F] dark:hover:text-white'
            }`}
          >
            {t.breakPhase}
          </button>
        </div>

        {/* Circular Progress + Giant Clock */}
        <div className="relative flex items-center justify-center w-[290px] h-[290px] sm:w-[340px] sm:h-[340px]">
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
              stroke={phase === 'study' ? '#6366F1' : '#10B981'}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-700 ease-linear"
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <span className="text-6xl sm:text-7xl font-extrabold tracking-tight tabular-nums">
              {formatMMSS(secondsLeft)}
            </span>
            <span className="mt-2 text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
              {t.maxCappedAt(taskCapMinutes)}
            </span>
          </div>
        </div>

        {sessionNotice && (
          <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[14px] font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{sessionNotice}</span>
          </div>
        )}

        {/* Primary Playback Controls */}
        <div className="flex items-center gap-3 mt-7">
          <button
            type="button"
            onClick={() => {
              setSessionNotice('');
              setIsRunning((prev) => !prev);
            }}
            className="min-h-[48px] px-8 rounded-xl bg-[#2F2F2F] hover:bg-[#191919] dark:bg-[#E8E8E6] dark:hover:bg-white text-white dark:text-[#191919] font-semibold text-[15px] inline-flex items-center gap-2 shadow-sm transition active:scale-[0.98]"
          >
            {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isRunning ? t.pauseTimer : t.startTimer}</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
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

      {/* Bottom Controls: Task Picker + Custom Capped Intervals */}
      <div
        className={`w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-2xl border p-4 ${
          fullscreenMode
            ? 'border-[#2F2F2F] bg-[#202020]'
            : 'border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020]'
        }`}
      >
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
            onChange={(e) => handleStudyMinutesChange(e.target.value)}
            className="w-full accent-indigo-500 mt-2 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-[12px] font-semibold text-[#787774] dark:text-[#9B9A97] mb-1.5">
            <span>{t.breakDuration}</span>
            <span className="text-emerald-600 dark:text-emerald-400">{breakMinutes}m</span>
          </div>
          <input
            type="range"
            min={1}
            max={Math.min(15, Math.floor(taskCapMinutes / 3))}
            step={1}
            value={breakMinutes}
            onChange={(e) => handleBreakMinutesChange(e.target.value)}
            className="w-full accent-emerald-500 mt-2 cursor-pointer"
          />
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

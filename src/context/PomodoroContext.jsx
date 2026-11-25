import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { playPomodoroChime } from '../utils/soundEffects';

const PREFS_STORAGE_KEY = 'hyperdocs_v1_pomodoro_prefs';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { soundMuted: false, autoTransition: false };
    const parsed = JSON.parse(raw);
    return {
      soundMuted: Boolean(parsed?.soundMuted),
      autoTransition: Boolean(parsed?.autoTransition),
    };
  } catch {
    return { soundMuted: false, autoTransition: false };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

export function formatMMSS(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const PomodoroContext = createContext(null);

export function PomodoroProvider({
  selectedTask,
  completedSessionsExternal = 0,
  onCompletedSessionsChange,
  children,
}) {
  // Max focus duration strictly capped by selected task's allocated duration (30-60 mins)
  const taskCapMinutes = selectedTask
    ? Math.min(60, Math.max(30, Number(selectedTask.duration) || 45))
    : 45;

  const initialPrefs = useRef(loadPrefs()).current;

  const [mode, setMode] = useState('focus'); // 'focus' | 'shortBreak' | 'longBreak'
  const [studyMinutes, setStudyMinutes] = useState(Math.min(25, taskCapMinutes));
  const [shortBreakMinutes, setShortBreakMinutes] = useState(5);
  const [longBreakMinutes] = useState(15);

  const [timeLeft, setTimeLeft] = useState(Math.min(25, taskCapMinutes) * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [targetEndTime, setTargetEndTime] = useState(null);
  const [completedSessions, setCompletedSessions] = useState(completedSessionsExternal);

  useEffect(() => {
    setCompletedSessions((prev) =>
      Math.max(prev, Number(completedSessionsExternal || 0))
    );
  }, [completedSessionsExternal]);

  const [soundMuted, setSoundMuted] = useState(initialPrefs.soundMuted);
  const [autoTransition, setAutoTransition] = useState(initialPrefs.autoTransition);
  const [lastCompletedType, setLastCompletedType] = useState(null); // null | 'focus' | 'shortBreak' | 'longBreak'

  const prevTaskIdRef = useRef(selectedTask?.id);
  const completingRef = useRef(false);

  const getDurationSecondsForMode = useCallback(
    (targetMode, customStudy = studyMinutes, customShort = shortBreakMinutes) => {
      if (targetMode === 'shortBreak') return customShort * 60;
      if (targetMode === 'longBreak') return longBreakMinutes * 60;
      return customStudy * 60;
    },
    [studyMinutes, shortBreakMinutes, longBreakMinutes]
  );

  // Persist sound & auto-transition preferences in localStorage
  useEffect(() => {
    savePrefs({ soundMuted, autoTransition });
  }, [soundMuted, autoTransition]);

  // Clamp focus duration when selected task changes (never interrupts an actively running timer unless cap shrinks below)
  useEffect(() => {
    if (selectedTask?.id !== prevTaskIdRef.current) {
      prevTaskIdRef.current = selectedTask?.id;
      const newCap = selectedTask ? Math.min(60, Math.max(30, selectedTask.duration)) : 45;
      setStudyMinutes((prev) => {
        const clamped = Math.min(prev, newCap);
        if (!isRunning && mode === 'focus' && clamped !== prev) {
          setTimeLeft(clamped * 60);
        }
        return clamped;
      });
    } else if (studyMinutes > taskCapMinutes) {
      setStudyMinutes(taskCapMinutes);
      if (!isRunning && mode === 'focus') {
        setTimeLeft(taskCapMinutes * 60);
      }
    }
  }, [selectedTask, taskCapMinutes, isRunning, mode, studyMinutes]);

  // Handle session reaching 00:00 (chime + mode transition + optional auto-start)
  const handleSessionComplete = useCallback(() => {
    if (completingRef.current) return;
    completingRef.current = true;

    if (!soundMuted) {
      playPomodoroChime();
    }

    if (mode === 'focus') {
      const nextCompleted = completedSessions + 1;
      const nextMode = nextCompleted % 4 === 0 ? 'longBreak' : 'shortBreak';
      const nextSeconds = getDurationSecondsForMode(nextMode);

      setCompletedSessions(nextCompleted);
      onCompletedSessionsChange?.(nextCompleted);
      setLastCompletedType(nextMode === 'longBreak' ? 'longBreakReady' : 'focus');
      setMode(nextMode);
      setTimeLeft(nextSeconds);

      if (autoTransition) {
        setTargetEndTime(Date.now() + nextSeconds * 1000);
        setIsRunning(true);
      } else {
        setTargetEndTime(null);
        setIsRunning(false);
      }
    } else {
      const nextSeconds = getDurationSecondsForMode('focus');
      setLastCompletedType('break');
      setMode('focus');
      setTimeLeft(nextSeconds);

      if (autoTransition) {
        setTargetEndTime(Date.now() + nextSeconds * 1000);
        setIsRunning(true);
      } else {
        setTargetEndTime(null);
        setIsRunning(false);
      }
    }

    // Release guard after state flush
    setTimeout(() => {
      completingRef.current = false;
    }, 100);
  }, [soundMuted, mode, completedSessions, autoTransition, getDurationSecondsForMode, onCompletedSessionsChange]);

  // Timestamp-based countdown tick (100% accurate across tab switches & background throttling)
  useEffect(() => {
    if (!isRunning || !targetEndTime) return;

    const syncRemaining = () => {
      const remaining = Math.max(0, Math.ceil((targetEndTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        handleSessionComplete();
      }
    };

    syncRemaining();
    const interval = setInterval(syncRemaining, 250);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncRemaining();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isRunning, targetEndTime, handleSessionComplete]);

  // Sync browser tab title while running
  useEffect(() => {
    if (isRunning) {
      document.title = `${formatMMSS(timeLeft)} · HyperDocs`;
    } else {
      document.title = 'HyperDocs — All-in-One Study Hub';
    }
    return () => {
      document.title = 'HyperDocs — All-in-One Study Hub';
    };
  }, [isRunning, timeLeft]);

  const startTimer = useCallback(() => {
    setLastCompletedType(null);
    const baseSeconds = timeLeft > 0 ? timeLeft : getDurationSecondsForMode(mode);
    setTimeLeft(baseSeconds);
    setTargetEndTime(Date.now() + baseSeconds * 1000);
    setIsRunning(true);
  }, [timeLeft, mode, getDurationSecondsForMode]);

  const pauseTimer = useCallback(() => {
    if (targetEndTime) {
      const remaining = Math.max(0, Math.ceil((targetEndTime - Date.now()) / 1000));
      setTimeLeft(remaining);
    }
    setTargetEndTime(null);
    setIsRunning(false);
  }, [targetEndTime]);

  const toggleStartPause = useCallback(() => {
    if (isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }, [isRunning, pauseTimer, startTimer]);

  const resetTimer = useCallback(() => {
    setIsRunning(false);
    setTargetEndTime(null);
    setLastCompletedType(null);
    setTimeLeft(getDurationSecondsForMode(mode));
  }, [mode, getDurationSecondsForMode]);

  const switchMode = useCallback(
    (nextMode) => {
      setMode(nextMode);
      setIsRunning(false);
      setTargetEndTime(null);
      setLastCompletedType(null);
      setTimeLeft(getDurationSecondsForMode(nextMode));
    },
    [getDurationSecondsForMode]
  );

  const updateStudyMinutes = useCallback(
    (val) => {
      const clamped = Math.min(taskCapMinutes, Math.max(5, Number(val) || 5));
      setStudyMinutes(clamped);
      if (mode === 'focus') {
        setIsRunning(false);
        setTargetEndTime(null);
        setLastCompletedType(null);
        setTimeLeft(clamped * 60);
      }
    },
    [taskCapMinutes, mode]
  );

  const updateShortBreakMinutes = useCallback(
    (val) => {
      const maxBreak = Math.min(15, Math.floor(taskCapMinutes / 3));
      const clamped = Math.min(maxBreak, Math.max(1, Number(val) || 5));
      setShortBreakMinutes(clamped);
      if (mode === 'shortBreak') {
        setIsRunning(false);
        setTargetEndTime(null);
        setLastCompletedType(null);
        setTimeLeft(clamped * 60);
      }
    },
    [taskCapMinutes, mode]
  );

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((prev) => !prev);
  }, []);

  const toggleAutoTransition = useCallback(() => {
    setAutoTransition((prev) => !prev);
  }, []);

  const totalPhaseSeconds = getDurationSecondsForMode(mode);

  const value = {
    mode,
    timeLeft,
    totalPhaseSeconds,
    isRunning,
    targetEndTime,
    completedSessions,
    studyMinutes,
    shortBreakMinutes,
    longBreakMinutes,
    taskCapMinutes,
    soundMuted,
    autoTransition,
    lastCompletedType,
    startTimer,
    pauseTimer,
    toggleStartPause,
    resetTimer,
    switchMode,
    updateStudyMinutes,
    updateShortBreakMinutes,
    toggleSoundMuted,
    toggleAutoTransition,
  };

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}

export function usePomodoro() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) {
    throw new Error('usePomodoro must be used inside a PomodoroProvider');
  }
  return ctx;
}

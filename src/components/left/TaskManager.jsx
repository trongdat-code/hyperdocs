import React, { useMemo, useState } from 'react';
import {
  Plus,
  Check,
  Clock,
  Calendar,
  Trash2,
  Target,
  X,
  History,
  ListTodo,
} from 'lucide-react';
import { SEVEN_DAYS_MS } from '../../services/storageService';

const THREE_DAYS_MS = 72 * 60 * 60 * 1000;

function getDefaultDueDateInput() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export default function TaskManager({
  tasks,
  selectedTaskId,
  onSelectTask,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  t,
  lang,
  density,
}) {
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(45);
  const [dueDate, setDueDate] = useState(getDefaultDueDateInput);

  const now = Date.now();

  // Auto-prioritize active tasks by nearest deadline ascending
  const activeTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.completed)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks]);

  // Completed history (sorted most recently completed first)
  const completedTasks = useMemo(() => {
    return tasks
      .filter((task) => task.completed)
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }, [tasks]);

  const handleOpenAdd = () => {
    setTitle('');
    setDuration(45);
    setDueDate(getDefaultDueDateInput());
    setShowAddModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // Strictly clamp duration between 30 and 60 minutes
    const clampedDuration = Math.min(60, Math.max(30, Number(duration) || 30));
    const parsedDue = dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 86400000).toISOString();

    onAddTask({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: trimmed,
      duration: clampedDuration,
      dueDate: parsedDue,
      completed: false,
      completedAt: null,
      createdAt: Date.now(),
    });
    setShowAddModal(false);
  };

  const formatDeadlineMeta = (iso) => {
    const target = new Date(iso).getTime();
    const diffMs = target - now;
    const isUrgent = diffMs <= THREE_DAYS_MS;

    if (diffMs < 0) {
      return { text: t.overdueLabel, isUrgent: true, isOverdue: true };
    }
    const hours = Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
    if (hours < 72) {
      return { text: t.dueInHours(hours), isUrgent: true, isOverdue: false };
    }
    const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    return { text: t.dueInDays(days), isUrgent, isOverdue: false };
  };

  const pad = density === 'compact' ? 'p-2.5' : 'p-3.5';

  return (
    <section className={`flex flex-col h-full min-h-0 ${pad} bg-white dark:bg-[#0F172A]`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <ListTodo className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <h2 className="font-semibold text-[17px] leading-tight truncate text-slate-900 dark:text-slate-100">
            {t.tasksTitle}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-1 px-2.5 min-h-[34px] rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white text-xs font-semibold transition shadow-sm shrink-0"
          title={t.addTask}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden 2xl:inline">{t.addTask}</span>
        </button>
      </div>

      {/* Tabs: Active vs Completed History */}
      <div className="grid grid-cols-2 gap-1 p-0.5 mb-2 rounded-lg bg-slate-100 dark:bg-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold transition ${
            activeTab === 'active'
              ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <span>{t.activeTasks}</span>
          <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[11px]">
            {activeTasks.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-xs font-semibold transition ${
            activeTab === 'completed'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>{t.completedHistory}</span>
          <span className="px-1.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px]">
            {completedTasks.length}
          </span>
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5 min-h-0">
        {activeTab === 'active' ? (
          activeTasks.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6 px-2">
              {t.noActiveTasks}
            </p>
          ) : (
            activeTasks.map((task) => {
              const meta = formatDeadlineMeta(task.dueDate);
              const isSelected = task.id === selectedTaskId;
              return (
                <div
                  key={task.id}
                  className={`group rounded-xl border p-2 transition ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30 dark:border-indigo-500/70'
                      : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Checkbox */}
                    <button
                      type="button"
                      onClick={() => onToggleTask(task.id)}
                      aria-label={`${t.completeTaskAria}: ${task.title}`}
                      className="mt-0.5 w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 flex items-center justify-center shrink-0 transition"
                    />

                    {/* Title & Meta */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <div className="flex items-start gap-1.5">
                        {/* Prominent '!' exclamation mark warning icon when within 72h */}
                        {meta.isUrgent && (
                          <span
                            title={t.urgentDueTooltip}
                            aria-label={t.urgentDueTooltip}
                            className={`inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full font-extrabold text-xs shrink-0 shadow-sm ${
                              meta.isOverdue
                                ? 'bg-rose-600 text-white animate-pulse'
                                : 'bg-amber-500 text-white'
                            }`}
                          >
                            !
                          </span>
                        )}
                        <p className="text-[17px] leading-snug font-medium text-slate-800 dark:text-slate-100 break-words line-clamp-2">
                          {task.title}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
                          <Clock className="w-3 h-3" />
                          {t.minutesShort(task.duration)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            meta.isOverdue
                              ? 'text-rose-600 dark:text-rose-400'
                              : meta.isUrgent
                                ? 'text-amber-600 dark:text-amber-400'
                                : ''
                          }`}
                        >
                          <Calendar className="w-3 h-3" />
                          {meta.text}
                        </span>
                      </div>
                    </div>

                    {/* Select for Focus + Delete */}
                    <div className="flex flex-col items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectTask(task.id)}
                        title={isSelected ? t.selectedForFocus : t.selectForFocus}
                        className={`p-1 rounded-md transition ${
                          isSelected
                            ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900/50'
                            : 'text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                        }`}
                      >
                        <Target className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        title={t.deleteTask}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-500 opacity-70 group-hover:opacity-100 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : completedTasks.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6 px-2">
            {t.noCompletedTasks}
          </p>
        ) : (
          <>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 px-1 pb-1">
              {t.autoPurgeNotice}
            </p>
            {completedTasks.map((task) => {
              const elapsed = now - (task.completedAt || now);
              const daysLeft = Math.max(1, Math.ceil((SEVEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000)));
              return (
                <div
                  key={task.id}
                  className="group rounded-xl border border-slate-200/60 dark:border-slate-800/70 p-2 bg-slate-50/40 dark:bg-slate-900/30"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleTask(task.id)}
                      aria-label={`${t.restoreTaskAria}: ${task.title}`}
                      className="mt-0.5 w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center shrink-0"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[17px] leading-snug line-through text-gray-400 dark:text-gray-500 break-words">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                        <span>{t.minutesShort(task.duration)}</span>
                        <span>•</span>
                        <span>{t.daysLeftBeforePurge(daysLeft)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteTask(task.id)}
                      title={t.deleteTask}
                      className="p-1 rounded-md text-slate-400 hover:text-rose-500 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[19px] text-slate-900 dark:text-slate-100">
                {t.addTask}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.taskTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t.taskTitlePlaceholder}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {t.durationLabel}
                  </label>
                  <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                    {duration} min
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={60}
                  step={5}
                  value={duration}
                  onChange={(e) => setDuration(Math.min(60, Math.max(30, Number(e.target.value))))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <div className="grid grid-cols-5 gap-1.5 mt-2">
                  {[30, 40, 45, 50, 60].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDuration(val)}
                      className={`min-h-[38px] rounded-lg text-sm font-semibold border transition ${
                        duration === val
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {val}m
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                  {t.durationHint}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.dueDateLabel}
                </label>
                <input
                  type="datetime-local"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-sm"
                >
                  {t.saveTask}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

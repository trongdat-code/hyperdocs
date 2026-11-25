import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  density,
}) {
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed'
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(45);
  const [dueDate, setDueDate] = useState(getDefaultDueDateInput);

  const now = Date.now();

  const activeTasks = useMemo(() => {
    return tasks
      .filter((task) => !task.completed)
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [tasks]);

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
    const clampedDuration = Math.min(60, Math.max(30, Number(duration) || 30));
    const parsedDue = dueDate
      ? new Date(dueDate).toISOString()
      : new Date(Date.now() + 86400000).toISOString();

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

  const itemPad = density === 'compact' ? 'px-2 py-1.5' : 'px-2.5 py-2';

  return (
    <section className="flex flex-col max-h-[50dvh] min-h-0 px-2.5 py-2.5 border-b border-[#E8E8E5] dark:border-[#2F2F2F]">
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 mb-2 px-1 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <ListTodo className="w-4 h-4 text-[#6B6A66] dark:text-[#9B9A97] shrink-0" />
          <h2 className="font-semibold text-[12px] uppercase tracking-wider truncate text-[#6B6A66] dark:text-[#9B9A97]">
            {t.tasksTitle}
          </h2>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-1 px-2 h-7 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[12px] font-medium cursor-pointer transition-colors duration-150 shrink-0"
          title={t.addTask}
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">{t.addTask}</span>
        </button>
      </div>

      {/* Tabs: Active vs Done */}
      <div className="grid grid-cols-2 gap-1 p-0.5 mb-2 rounded-lg bg-[#F3F3F1] dark:bg-[#262626] shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150 ${
            activeTab === 'active'
              ? 'bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] shadow-xs'
              : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
          }`}
        >
          <span>{t.activeTasks}</span>
          <span className="text-[11px] tabular-nums opacity-75">{activeTasks.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`flex items-center justify-center gap-1.5 py-1 px-2 rounded-md text-[12px] font-medium cursor-pointer transition-colors duration-150 ${
            activeTab === 'completed'
              ? 'bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] shadow-xs'
              : 'text-[#6B6A66] dark:text-[#9B9A97] hover:text-[#262624] dark:hover:text-[#ECECEA]'
          }`}
        >
          <History className="w-3 h-3" />
          <span>{t.completedHistory}</span>
          <span className="text-[11px] tabular-nums opacity-75">{completedTasks.length}</span>
        </button>
      </div>

      {/* Dynamically expanding task list (scrolls cleanly when > 50% viewport height) */}
      <div className="overflow-y-auto space-y-1 pr-0.5 min-h-0">
        {activeTab === 'active' ? (
          activeTasks.length === 0 ? (
            <p className="text-[13px] text-[#6B6A66] dark:text-[#8E8D8A] text-center py-3 px-2">
              {t.noActiveTasks}
            </p>
          ) : (
            activeTasks.map((task) => {
              const meta = formatDeadlineMeta(task.dueDate);
              const isSelected = task.id === selectedTaskId;
              return (
                <div
                  key={task.id}
                  className={`group rounded-lg ${itemPad} transition-colors duration-150 border ${
                    isSelected
                      ? 'bg-[#FFFFFF] dark:bg-[#262626] border-[#DCDCD8] dark:border-[#363636] shadow-xs'
                      : 'border-transparent hover:bg-[#F3F3F1] dark:hover:bg-[#262626]'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleTask(task.id)}
                      aria-label={`${t.completeTaskAria}: ${task.title}`}
                      className="mt-0.5 w-4 h-4 rounded-[4px] border border-[#C6C5C0] dark:border-[#555553] hover:border-indigo-500 flex items-center justify-center shrink-0 cursor-pointer transition-colors duration-150"
                    />

                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => onSelectTask(task.id)}
                    >
                      <div className="flex items-start gap-1.5">
                        {meta.isUrgent && (
                          <span
                            title={t.urgentDueTooltip}
                            aria-label={t.urgentDueTooltip}
                            className={`inline-flex items-center justify-center w-4 h-4 mt-0.5 rounded-full font-bold text-[11px] shrink-0 ${
                              meta.isOverdue
                                ? 'bg-rose-600 text-white'
                                : 'bg-amber-500 text-white'
                            }`}
                          >
                            !
                          </span>
                        )}
                        <p className="text-[13.5px] leading-snug font-medium text-[#262624] dark:text-[#ECECEA] break-words line-clamp-2">
                          {task.title}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Clock className="w-3 h-3" />
                          {t.minutesShort(task.duration)}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 ${
                            meta.isOverdue
                              ? 'text-rose-600 dark:text-rose-400 font-medium'
                              : meta.isUrgent
                                ? 'text-amber-600 dark:text-amber-400 font-medium'
                                : ''
                          }`}
                        >
                          <Calendar className="w-3 h-3" />
                          {meta.text}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectTask(task.id)}
                        title={isSelected ? t.selectedForFocus : t.selectForFocus}
                        className={`p-1 rounded cursor-pointer transition-colors duration-150 ${
                          isSelected
                            ? 'text-indigo-600 dark:text-indigo-400 opacity-100'
                            : 'text-[#6B6A66] hover:text-[#262624] dark:hover:text-white'
                        }`}
                      >
                        <Target className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTask(task.id)}
                        title={t.deleteTask}
                        className="p-1 rounded text-[#6B6A66] hover:text-rose-600 cursor-pointer transition-colors duration-150"
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
          <p className="text-[13px] text-[#6B6A66] dark:text-[#8E8D8A] text-center py-3 px-2">
            {t.noCompletedTasks}
          </p>
        ) : (
          <>
            <p className="text-[12px] text-[#6B6A66] dark:text-[#8E8D8A] px-1 pb-0.5">
              {t.autoPurgeNotice}
            </p>
            {completedTasks.map((task) => {
              const elapsed = now - (task.completedAt || now);
              const daysLeft = Math.max(
                1,
                Math.ceil((SEVEN_DAYS_MS - elapsed) / (24 * 60 * 60 * 1000))
              );
              return (
                <div
                  key={task.id}
                  className={`group rounded-lg ${itemPad} hover:bg-[#F3F3F1] dark:hover:bg-[#262626] transition-colors duration-150`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleTask(task.id)}
                      aria-label={`${t.restoreTaskAria}: ${task.title}`}
                      className="mt-0.5 w-4 h-4 rounded-[4px] bg-emerald-600 text-white flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] leading-snug line-through text-gray-400 dark:text-gray-500 break-words">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-[#9B9A97]">
                        <span>{t.minutesShort(task.duration)}</span>
                        <span>•</span>
                        <span>{t.daysLeftBeforePurge(daysLeft)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteTask(task.id)}
                      title={t.deleteTask}
                      className="p-1 rounded text-[#6B6A66] hover:text-rose-600 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity duration-150"
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

      {/* Add Task Modal (Portaled to body) */}
      {showAddModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="hd-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4"
            onClick={() => setShowAddModal(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="hd-modal-in w-full max-w-md rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#2F2F2F] shadow-2xl p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px] text-[#262624] dark:text-[#ECECEA]">
                  {t.addTask}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#6B6A66] dark:text-[#9B9A97] hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.taskTitleLabel}
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t.taskTitlePlaceholder}
                    className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] text-[#262624] dark:text-[#ECECEA] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                      {t.durationLabel}
                    </label>
                    <span className="text-[13px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-400">
                      {duration} min
                    </span>
                  </div>
                  <input
                    type="range"
                    min={30}
                    max={60}
                    step={5}
                    value={duration}
                    onChange={(e) =>
                      setDuration(Math.min(60, Math.max(30, Number(e.target.value))))
                    }
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                  <div className="grid grid-cols-5 gap-1.5 mt-2">
                    {[30, 40, 45, 50, 60].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setDuration(val)}
                        className={`min-h-[36px] rounded-lg text-[13px] font-medium border cursor-pointer transition-colors duration-150 ${
                          duration === val
                            ? 'bg-[#262624] dark:bg-[#ECECEA] text-white dark:text-[#191919] border-transparent'
                            : 'border-[#E8E8E5] dark:border-[#363636] text-[#555552] dark:text-[#C5C4C0] hover:bg-[#F3F3F1] dark:hover:bg-[#323232]'
                        }`}
                      >
                        {val}m
                      </button>
                    ))}
                  </div>
                  <p className="text-[12px] text-[#6B6A66] dark:text-[#8E8D8A] mt-1.5">
                    {t.durationHint}
                  </p>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97] mb-1.5">
                    {t.dueDateLabel}
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[14px] text-[#262624] dark:text-[#ECECEA] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] text-[#555552] dark:text-[#C5C4C0] text-[14px] font-medium hover:bg-[#F3F3F1] dark:hover:bg-[#323232] cursor-pointer transition-colors duration-150"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-lg bg-[#262624] hover:bg-[#191919] dark:bg-[#ECECEA] dark:hover:bg-white text-white dark:text-[#191919] text-[14px] font-semibold cursor-pointer transition-colors duration-150"
                  >
                    {t.saveTask}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}

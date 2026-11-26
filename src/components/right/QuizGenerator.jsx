import React, { useEffect, useState } from 'react';
import {
  FileQuestion,
  Sparkles,
  ShieldCheck,
  Tag,
  Play,
  Trash2,
  X,
  CheckCircle2,
  XCircle,
  Loader2,
  RotateCcw,
  ArrowLeft,
} from 'lucide-react';
import { generateDocumentQuiz } from '../../services/geminiService';
import MathText from '../MathText';

const MAX_TAGS = 3;

export default function QuizGenerator({
  documents,
  selectedDocument,
  quizzes,
  onAddQuiz,
  onUpdateQuiz,
  onDeleteQuiz,
  onNotify,
  t,
  lang,
}) {
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [questionCount, setQuestionCount] = useState(5);
  const [quizTags, setQuizTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Active quiz state rendered inline in the workspace
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    if (selectedDocument?.id) {
      setSelectedDocIds((prev) => (prev.length === 0 ? [selectedDocument.id] : prev));
    } else if (documents.length > 0 && selectedDocIds.length === 0) {
      setSelectedDocIds([documents[0].id]);
    }
  }, [selectedDocument?.id, documents, selectedDocIds.length]);

  const toggleSourceDoc = (id) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleAddTag = () => {
    const clean = tagDraft.trim();
    if (!clean) return;
    if (quizTags.length >= MAX_TAGS) {
      onNotify(t.maxTagsReached, 'warning');
      return;
    }
    if (!quizTags.includes(clean)) {
      setQuizTags([...quizTags, clean]);
    }
    setTagDraft('');
  };

  const handleGenerate = async () => {
    const chosenDocs = documents.filter((d) => selectedDocIds.includes(d.id));
    if (chosenDocs.length === 0) {
      onNotify(t.noSourceDocsSelected, 'warning');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generateDocumentQuiz({
        documents: chosenDocs,
        questionCount,
        language: lang,
      });

      const autoTags =
        quizTags.length > 0
          ? quizTags.slice(0, MAX_TAGS)
          : Array.from(new Set(chosenDocs.flatMap((d) => d.tags || []))).slice(0, MAX_TAGS);

      const newQuiz = {
        id: `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: result.title,
        tags: autoTags,
        sourceDocIds: chosenDocs.map((d) => d.id),
        sourceDocTitles: chosenDocs.map((d) => d.title),
        questions: result.questions,
        lastScore: null,
        createdAt: Date.now(),
      };

      onAddQuiz(newQuiz);
      setQuizTags([]);
      setTagDraft('');
      openQuizRunner(newQuiz);
    } catch (err) {
      if (err.code === 'MISSING_API_KEY') {
        onNotify(t.missingApiKeyError, 'error');
      } else {
        onNotify(`${t.aiErrorPrefix}${err.message}`, 'error');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const openQuizRunner = (quiz) => {
    setActiveQuiz(quiz);
    setAnswers({});
    setIsSubmitted(false);
  };

  const handleSubmitQuiz = () => {
    if (!activeQuiz) return;
    const total = activeQuiz.questions.length;
    const correct = activeQuiz.questions.reduce(
      (acc, q, idx) => acc + (answers[idx] === q.correctIndex ? 1 : 0),
      0
    );
    setIsSubmitted(true);
    onUpdateQuiz({
      ...activeQuiz,
      lastScore: { correct, total, pct: total > 0 ? Math.round((correct / total) * 100) : 0 },
    });
  };

  const incorrectItems =
    activeQuiz && isSubmitted
      ? activeQuiz.questions
          .map((q, idx) => ({ ...q, idx, userChoice: answers[idx] }))
          .filter((item) => item.userChoice !== item.correctIndex)
      : [];

  const correctCount =
    activeQuiz && isSubmitted ? activeQuiz.questions.length - incorrectItems.length : 0;

  const scorePct =
    activeQuiz && activeQuiz.questions.length > 0
      ? Math.round((correctCount / activeQuiz.questions.length) * 100)
      : 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919]">
      {/* Workspace Header */}
      <div className="px-5 sm:px-8 pt-5 pb-4 border-b border-[#E8E8E5] dark:border-[#2F2F2F] shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
              <FileQuestion className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[#262624] dark:text-[#ECECEA]">
                  {t.quizTitle}
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[12px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t.strictGroundingBadge}
                </span>
              </div>
              <p className="text-[13px] text-[#6B6A66] dark:text-[#9B9A97] mt-0.5">
                {t.quizSubtitle}
              </p>
            </div>
          </div>

          {activeQuiz && (
            <button
              type="button"
              onClick={() => setActiveQuiz(null)}
              className="min-h-[38px] px-3.5 rounded-lg border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#262624] dark:text-[#ECECEA] text-[13px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.savedQuizzes}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-6 min-h-0">
        <div className="max-w-5xl mx-auto">
          {activeQuiz ? (
            /* Full-Workspace Quiz Runner & Grading Review */
            <div className="max-w-3xl mx-auto space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E8E8E5] dark:border-[#2F2F2F]">
                <div>
                  <h2 className="text-lg font-bold text-[#262624] dark:text-[#ECECEA]">
                    <MathText inline text={activeQuiz.title} />
                  </h2>
                  {activeQuiz.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {activeQuiz.tags.slice(0, MAX_TAGS).map((tag) => (
                        <span
                          key={tag}
                          className="text-[12px] px-2 py-0.5 rounded-md bg-[#F3F3F1] dark:bg-[#262626] text-[#6B6A66] dark:text-[#9B9A97]"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {isSubmitted ? (
                <div className="space-y-5">
                  {/* Refined Notion Tonal Score Card */}
                  <div className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97]">
                          {t.quizScoreTitle}
                        </p>
                        <p className="text-4xl font-extrabold tracking-tight tabular-nums text-[#262624] dark:text-[#ECECEA] mt-1">
                          {scorePct}%
                        </p>
                        <p className="text-[14px] text-[#6B6A66] dark:text-[#9B9A97] mt-0.5">
                          {t.scoreSummary(correctCount, activeQuiz.questions.length)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-center min-w-[84px]">
                          <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                            {correctCount}
                          </p>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400">
                            {t.correctAnswer}
                          </p>
                        </div>
                        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 text-center min-w-[84px]">
                          <p className="text-xl font-bold tabular-nums text-rose-700 dark:text-rose-300">
                            {incorrectItems.length}
                          </p>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700/80 dark:text-rose-400">
                            {t.reviewIncorrect}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="h-2 w-full rounded-full bg-[#E8E8E5] dark:bg-[#2F2F2F] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          scorePct >= 80
                            ? 'bg-emerald-500'
                            : scorePct >= 50
                              ? 'bg-indigo-500'
                              : 'bg-rose-500'
                        }`}
                        style={{ width: `${scorePct}%` }}
                      />
                    </div>
                  </div>

                  {incorrectItems.length === 0 ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-emerald-700 dark:text-emerald-300 font-medium flex flex-col items-center gap-2">
                      <CheckCircle2 className="w-7 h-7" />
                      <p>{t.allCorrectMsg}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-[14px] text-rose-700 dark:text-rose-400 flex items-center gap-2">
                        <XCircle className="w-4 h-4" />
                        <span>
                          {t.reviewIncorrect} ({incorrectItems.length})
                        </span>
                      </h3>
                      {incorrectItems.map((item) => (
                        <div
                          key={item.idx}
                          className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] border-l-[3px] border-l-rose-500 bg-[#FFFFFF] dark:bg-[#202020] p-4 space-y-2.5 text-[14px]"
                        >
                          <div className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] leading-relaxed">
                            <span>{item.idx + 1}. </span>
                            <MathText inline text={item.question} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="rounded-lg bg-rose-500/8 border border-rose-500/20 px-3 py-2 text-rose-700 dark:text-rose-300 text-[13px]">
                              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80 mb-0.5">
                                {t.yourAnswer}
                              </span>
                              {item.userChoice !== undefined ? (
                                <MathText inline text={item.options[item.userChoice]} />
                              ) : (
                                '—'
                              )}
                            </div>
                            <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2 text-emerald-700 dark:text-emerald-300 text-[13px]">
                              <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80 mb-0.5">
                                {t.correctAnswer}
                              </span>
                              <MathText inline text={item.options[item.correctIndex]} />
                            </div>
                          </div>
                          {item.explanation && (
                            <div className="text-[#555552] dark:text-[#C5C4C0] text-[13px] pt-2 border-t border-[#E8E8E5] dark:border-[#2F2F2F] leading-relaxed">
                              <strong className="text-[#262624] dark:text-[#ECECEA]">
                                {t.sourceExplanation}:
                              </strong>{' '}
                              <MathText inline text={item.explanation} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAnswers({});
                        setIsSubmitted(false);
                      }}
                      className="min-h-[40px] px-4 rounded-lg border border-[#E8E8E5] dark:border-[#363636] hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#262624] dark:text-[#ECECEA] text-[14px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>{t.retakeQuiz}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveQuiz(null)}
                      className="min-h-[40px] px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-semibold cursor-pointer transition-colors duration-150"
                    >
                      {t.doneReviewing}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeQuiz.questions.map((q, qIdx) => (
                    <div
                      key={qIdx}
                      className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] p-4 sm:p-5 space-y-3"
                    >
                      <p className="text-[12px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                        {t.questionProgress(qIdx + 1, activeQuiz.questions.length)}
                      </p>
                      <div className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] leading-relaxed">
                        <MathText inline text={q.question} />
                      </div>
                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => {
                          const selected = answers[qIdx] === optIdx;
                          const letter = String.fromCharCode(65 + optIdx);
                          return (
                            <button
                              key={optIdx}
                              type="button"
                              onClick={() => setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))}
                              className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-lg border text-[14px] flex items-center gap-2.5 cursor-pointer transition-colors duration-150 ${
                                selected
                                  ? 'border-violet-600 bg-violet-500/10 text-violet-900 dark:text-violet-100 font-medium'
                                  : 'border-[#E8E8E5] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#262626] hover:border-violet-400/70 hover:bg-[#FBFBFA] dark:hover:bg-[#2B2B2B] text-[#262624] dark:text-[#ECECEA]'
                              }`}
                            >
                              <span
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${
                                  selected
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-[#F3F3F1] dark:bg-[#191919] text-[#6B6A66] dark:text-[#9B9A97]'
                                }`}
                              >
                                {letter}
                              </span>
                              <span className="flex-1 min-w-0 leading-relaxed">
                                <MathText inline text={opt} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      disabled={Object.keys(answers).length < activeQuiz.questions.length}
                      onClick={handleSubmitQuiz}
                      className="min-h-[44px] px-6 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[14px] font-semibold cursor-pointer transition-colors duration-150"
                    >
                      {t.submitQuiz}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Two-Pane Builder + Saved Quizzes Dashboard */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Builder Panel */}
              <div className="lg:col-span-5 rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA] dark:bg-[#202020] p-5 space-y-4 h-fit">
                <div>
                  <h2 className="text-[14px] font-semibold text-[#262624] dark:text-[#ECECEA] mb-2">
                    {t.selectQuizDocs} ({selectedDocIds.length})
                  </h2>
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                    {documents.map((doc) => {
                      const checked = selectedDocIds.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border text-[14px] cursor-pointer transition-colors duration-150 ${
                            checked
                              ? 'border-violet-500/50 bg-[#FFFFFF] dark:bg-[#262626] text-[#262624] dark:text-[#ECECEA]'
                              : 'border-transparent hover:bg-[#F3F3F1] dark:hover:bg-[#262626] text-[#262624] dark:text-[#ECECEA]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSourceDoc(doc.id)}
                            className="rounded border-[#BDBCB8] text-violet-600 focus:ring-violet-500 shrink-0 cursor-pointer"
                          />
                          <span className="truncate">{doc.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#E8E8E5] dark:border-[#2F2F2F]">
                  <span className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                    {t.questionCountLabel}
                  </span>
                  <div className="inline-flex gap-1.5">
                    {[3, 5, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuestionCount(n)}
                        className={`w-9 h-8 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors duration-150 ${
                          questionCount === n
                            ? 'bg-violet-600 text-white'
                            : 'bg-[#FFFFFF] dark:bg-[#262626] border border-[#E8E8E5] dark:border-[#363636] text-[#262624] dark:text-[#ECECEA] hover:bg-[#F3F3F1] dark:hover:bg-[#303030]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Max-3 Tags */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#6B6A66] dark:text-[#9B9A97]">
                    {t.quizTagsLabel} ({quizTags.length}/{MAX_TAGS})
                  </label>
                  {quizTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {quizTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/12 text-violet-700 dark:text-violet-300 text-[12px] font-medium"
                        >
                          {tag}
                          <button
                            type="button"
                            onClick={() => setQuizTags(quizTags.filter((x) => x !== tag))}
                            className="cursor-pointer hover:text-rose-500"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {quizTags.length < MAX_TAGS && (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        placeholder={t.addTagPlaceholder}
                        className="flex-1 min-w-0 h-[38px] px-3 rounded-lg border border-[#E8E8E5] dark:border-[#363636] bg-[#FFFFFF] dark:bg-[#191919] text-[#262624] dark:text-[#ECECEA] text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={handleAddTag}
                        disabled={!tagDraft.trim()}
                        className="px-3 rounded-lg bg-[#F3F3F1] dark:bg-[#2F2F2F] hover:bg-[#E8E8E5] dark:hover:bg-[#3A3A3A] text-[#262624] dark:text-[#ECECEA] text-[14px] font-semibold disabled:opacity-40 cursor-pointer transition-colors duration-150"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isGenerating || selectedDocIds.length === 0}
                  onClick={handleGenerate}
                  className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[14px] font-semibold cursor-pointer transition-colors duration-150"
                >
                  {isGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{isGenerating ? t.generatingQuiz : t.generateQuiz}</span>
                </button>
              </div>

              {/* Saved Quizzes Grid */}
              <div className="lg:col-span-7 space-y-3">
                <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[#6B6A66] dark:text-[#9B9A97]">
                  {t.savedQuizzes} ({quizzes.length})
                </h2>

                {quizzes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FBFBFA]/50 dark:bg-[#202020]/50 p-10 text-center text-[#6B6A66] dark:text-[#9B9A97] text-[14px]">
                    {t.noQuizzesYet}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {quizzes.map((quiz) => (
                      <div
                        key={quiz.id}
                        className="rounded-xl border border-[#E8E8E5] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#FBFBFA] dark:hover:bg-[#262626] p-4 transition-colors duration-150 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <h3 className="font-semibold text-[15px] text-[#262624] dark:text-[#ECECEA] truncate">
                            <MathText inline text={quiz.title} />
                          </h3>
                          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#6B6A66] dark:text-[#9B9A97]">
                            <span className="tabular-nums">
                              {quiz.lastScore
                                ? `${quiz.lastScore.correct}/${quiz.lastScore.total} (${quiz.lastScore.pct}%)`
                                : `${quiz.questions.length} Q`}
                            </span>
                            {(quiz.tags || []).slice(0, MAX_TAGS).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium"
                              >
                                <Tag className="w-3 h-3" />
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openQuizRunner(quiz)}
                            className="min-h-[36px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{quiz.lastScore ? t.retakeQuiz : t.takeQuiz}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteQuiz(quiz.id)}
                            aria-label="Delete quiz"
                            className="p-2 rounded-lg text-[#6B6A66] hover:text-rose-600 hover:bg-rose-500/10 cursor-pointer transition-colors duration-150"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
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
} from 'lucide-react';
import { generateDocumentQuiz } from '../../services/geminiService';

const MAX_TAGS = 3;

function InlineMath({ text }) {
  return (
    <span className="inline-block max-w-full overflow-x-auto align-middle [&>p]:m-0">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text || ''}
      </ReactMarkdown>
    </span>
  );
}

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
  density,
}) {
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [questionCount, setQuestionCount] = useState(5);
  const [quizTags, setQuizTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Active quiz modal state
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Sync default selected document when user opens one
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

  const pad = density === 'compact' ? 'p-2.5' : 'p-3.5';

  const incorrectItems =
    activeQuiz && isSubmitted
      ? activeQuiz.questions
          .map((q, idx) => ({ ...q, idx, userChoice: answers[idx] }))
          .filter((item) => item.userChoice !== item.correctIndex)
      : [];

  const correctCount =
    activeQuiz && isSubmitted
      ? activeQuiz.questions.length - incorrectItems.length
      : 0;

  return (
    <section className={`flex flex-col h-full min-h-0 ${pad} bg-white dark:bg-[#0F172A]`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 mb-1.5 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileQuestion className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
          <h2 className="font-semibold text-[17px] leading-tight truncate text-slate-900 dark:text-slate-100">
            {t.quizTitle}
          </h2>
        </div>
        <span
          title={t.strictGroundingBadge}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-[10px] font-bold shrink-0"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="hidden 2xl:inline">{t.strictGroundingBadge}</span>
        </span>
      </div>

      {/* Scrollable Body: Generator Controls + Saved Quizzes */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5 min-h-0">
        {/* Source Document Selector */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5 space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {t.selectQuizDocs} ({selectedDocIds.length})
          </p>

          <div className="max-h-24 overflow-y-auto space-y-1">
            {documents.map((doc) => {
              const checked = selectedDocIds.includes(doc.id);
              return (
                <label
                  key={doc.id}
                  className="flex items-center gap-2 text-xs cursor-pointer py-0.5 text-slate-700 dark:text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSourceDoc(doc.id)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 shrink-0"
                  />
                  <span className="truncate">{doc.title}</span>
                </label>
              );
            })}
          </div>

          {/* Question count + Max-3 tags */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t.questionCountLabel}</span>
            <div className="inline-flex gap-1">
              {[3, 5, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuestionCount(n)}
                  className={`px-2 py-0.5 rounded-md text-xs font-bold transition ${
                    questionCount === n
                      ? 'bg-violet-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Quiz Tags (max 3) */}
          <div>
            <div className="flex flex-wrap gap-1 mb-1">
              {quizTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-[11px] font-semibold"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setQuizTags(quizTags.filter((x) => x !== tag))}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            {quizTags.length < MAX_TAGS && (
              <div className="flex gap-1">
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
                  placeholder={`${t.quizTagsLabel} (${quizTags.length}/${MAX_TAGS})`}
                  className="flex-1 min-w-0 min-h-[34px] px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  disabled={!tagDraft.trim()}
                  className="px-2.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-xs font-bold disabled:opacity-40"
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
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold shadow-sm transition"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isGenerating ? t.generatingQuiz : t.generateQuiz}</span>
          </button>
        </div>

        {/* Saved Quizzes History */}
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 px-0.5">
            {t.savedQuizzes} ({quizzes.length})
          </p>
          {quizzes.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 px-0.5 leading-relaxed">
              {t.noQuizzesYet}
            </p>
          ) : (
            quizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 p-2.5 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 line-clamp-2">
                    {quiz.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => onDeleteQuiz(quiz.id)}
                    className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {quiz.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {quiz.tags.slice(0, MAX_TAGS).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 text-[10px] font-semibold"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {quiz.lastScore
                      ? `${quiz.lastScore.correct}/${quiz.lastScore.total} (${quiz.lastScore.pct}%)`
                      : `${quiz.questions.length} Q`}
                  </span>
                  <button
                    type="button"
                    onClick={() => openQuizRunner(quiz)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{quiz.lastScore ? t.retakeQuiz : t.takeQuiz}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Interactive Quiz Runner & Grading Modal */}
      {activeQuiz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-[19px] text-slate-900 dark:text-white truncate">
                    {activeQuiz.title}
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-[11px] font-bold shrink-0">
                    <ShieldCheck className="w-3 h-3" />
                    {t.strictGroundingBadge}
                  </span>
                </div>
                {activeQuiz.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {activeQuiz.tags.slice(0, MAX_TAGS).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveQuiz(null)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {isSubmitted ? (
                <div className="space-y-5">
                  {/* Score Banner */}
                  <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-5 text-center shadow-lg">
                    <p className="text-xs font-bold uppercase tracking-wider opacity-80">
                      {t.quizScoreTitle}
                    </p>
                    <p className="text-4xl font-extrabold mt-1">
                      {Math.round((correctCount / activeQuiz.questions.length) * 100)}%
                    </p>
                    <p className="text-sm font-medium mt-1 opacity-90">
                      {t.scoreSummary(correctCount, activeQuiz.questions.length)}
                    </p>
                  </div>

                  {/* Incorrect Answers Review */}
                  {incorrectItems.length === 0 ? (
                    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-5 text-center text-emerald-700 dark:text-emerald-300 font-semibold flex flex-col items-center gap-2">
                      <CheckCircle2 className="w-8 h-8" />
                      <p className="text-[17px]">{t.allCorrectMsg}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <h4 className="font-bold text-[17px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
                        <XCircle className="w-5 h-5" />
                        <span>
                          {t.reviewIncorrect} ({incorrectItems.length})
                        </span>
                      </h4>
                      {incorrectItems.map((item) => (
                        <div
                          key={item.idx}
                          className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 p-4 space-y-2"
                        >
                          <p className="font-semibold text-[17px] text-slate-900 dark:text-white">
                            {item.idx + 1}. <InlineMath text={item.question} />
                          </p>
                          <p className="text-sm text-rose-700 dark:text-rose-300">
                            <strong>{t.yourAnswer}:</strong>{' '}
                            {item.userChoice !== undefined ? (
                              <InlineMath text={item.options[item.userChoice]} />
                            ) : (
                              '—'
                            )}
                          </p>
                          <p className="text-sm text-emerald-700 dark:text-emerald-300">
                            <strong>{t.correctAnswer}:</strong>{' '}
                            <InlineMath text={item.options[item.correctIndex]} />
                          </p>
                          {item.explanation && (
                            <p className="text-sm text-slate-600 dark:text-slate-300 pt-1 border-t border-rose-200/60 dark:border-rose-900/50">
                              <strong>{t.sourceExplanation}:</strong>{' '}
                              <InlineMath text={item.explanation} />
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Active Questions List */
                activeQuiz.questions.map((q, qIdx) => (
                  <div
                    key={qIdx}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 p-4 space-y-3"
                  >
                    <p className="text-xs font-bold uppercase text-violet-600 dark:text-violet-400">
                      {t.questionProgress(qIdx + 1, activeQuiz.questions.length)}
                    </p>
                    <div className="font-semibold text-[17px] text-slate-900 dark:text-white">
                      <InlineMath text={q.question} />
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
                            className={`w-full min-h-[44px] text-left px-3.5 py-2.5 rounded-xl border text-[16px] flex items-start gap-2.5 transition ${
                              selected
                                ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/60 text-violet-900 dark:text-violet-100 font-semibold'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-violet-400'
                            }`}
                          >
                            <span
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                                selected
                                  ? 'bg-violet-600 text-white'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {letter}
                            </span>
                            <span className="flex-1 min-w-0">
                              <InlineMath text={opt} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 shrink-0 bg-slate-50 dark:bg-slate-900/40">
              {isSubmitted ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setAnswers({});
                      setIsSubmitted(false);
                    }}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-semibold inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>{t.retakeQuiz}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveQuiz(null)}
                    className="min-h-[44px] px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
                  >
                    {t.doneReviewing}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={Object.keys(answers).length < activeQuiz.questions.length}
                  onClick={handleSubmitQuiz}
                  className="min-h-[44px] px-6 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold shadow-sm"
                >
                  {t.submitQuiz}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

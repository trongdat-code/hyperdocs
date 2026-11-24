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
  ArrowLeft,
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919]">
      {/* Workspace Header */}
      <div className="px-6 sm:px-10 pt-6 pb-4 border-b border-[#E5E5E3] dark:border-[#2F2F2F] shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
              <FileQuestion className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-[#2F2F2F] dark:text-[#E8E8E6]">
                  {t.quizTitle}
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[12px] font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {t.strictGroundingBadge}
                </span>
              </div>
              <p className="text-[13px] text-[#787774] dark:text-[#9B9A97] mt-0.5">
                {t.quizSubtitle}
              </p>
            </div>
          </div>

          {activeQuiz && (
            <button
              type="button"
              onClick={() => setActiveQuiz(null)}
              className="min-h-[38px] px-3.5 rounded-lg border border-[#E5E5E3] dark:border-[#2F2F2F] hover:bg-[#F1F1EF] dark:hover:bg-[#262626] text-[14px] font-medium inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t.savedQuizzes}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-6 min-h-0">
        <div className="max-w-5xl mx-auto">
          {activeQuiz ? (
            /* Full-Workspace Quiz Runner & Grading Review */
            <div className="max-w-3xl mx-auto space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E5E3] dark:border-[#2F2F2F]">
                <div>
                  <h2 className="text-lg font-bold">{activeQuiz.title}</h2>
                  {activeQuiz.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {activeQuiz.tags.slice(0, MAX_TAGS).map((tag) => (
                        <span
                          key={tag}
                          className="text-[12px] px-2 py-0.5 rounded bg-[#F1F1EF] dark:bg-[#262626] text-[#787774] dark:text-[#9B9A97]"
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
                  <div className="rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white p-6 text-center shadow-sm">
                    <p className="text-[12px] font-semibold uppercase tracking-wider opacity-85">
                      {t.quizScoreTitle}
                    </p>
                    <p className="text-4xl font-extrabold mt-1">
                      {Math.round((correctCount / activeQuiz.questions.length) * 100)}%
                    </p>
                    <p className="text-[14px] font-medium mt-1 opacity-90">
                      {t.scoreSummary(correctCount, activeQuiz.questions.length)}
                    </p>
                  </div>

                  {incorrectItems.length === 0 ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center text-emerald-700 dark:text-emerald-300 font-medium flex flex-col items-center gap-2">
                      <CheckCircle2 className="w-7 h-7" />
                      <p>{t.allCorrectMsg}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-[15px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
                        <XCircle className="w-4 h-4" />
                        <span>
                          {t.reviewIncorrect} ({incorrectItems.length})
                        </span>
                      </h3>
                      {incorrectItems.map((item) => (
                        <div
                          key={item.idx}
                          className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4 space-y-2 text-[14px]"
                        >
                          <p className="font-semibold text-[15px]">
                            {item.idx + 1}. <InlineMath text={item.question} />
                          </p>
                          <p className="text-rose-700 dark:text-rose-300">
                            <strong>{t.yourAnswer}:</strong>{' '}
                            {item.userChoice !== undefined ? (
                              <InlineMath text={item.options[item.userChoice]} />
                            ) : (
                              '—'
                            )}
                          </p>
                          <p className="text-emerald-700 dark:text-emerald-300">
                            <strong>{t.correctAnswer}:</strong>{' '}
                            <InlineMath text={item.options[item.correctIndex]} />
                          </p>
                          {item.explanation && (
                            <p className="text-[#555552] dark:text-[#C5C4C0] pt-1.5 border-t border-rose-500/15">
                              <strong>{t.sourceExplanation}:</strong>{' '}
                              <InlineMath text={item.explanation} />
                            </p>
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
                      className="min-h-[40px] px-4 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>{t.retakeQuiz}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveQuiz(null)}
                      className="min-h-[40px] px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[14px] font-semibold"
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
                      className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-4 space-y-3"
                    >
                      <p className="text-[12px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                        {t.questionProgress(qIdx + 1, activeQuiz.questions.length)}
                      </p>
                      <div className="font-semibold text-[15px]">
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
                              className={`w-full min-h-[42px] text-left px-3.5 py-2 rounded-xl border text-[14px] flex items-start gap-2.5 transition ${
                                selected
                                  ? 'border-violet-600 bg-violet-500/10 text-violet-900 dark:text-violet-100 font-medium'
                                  : 'border-[#E5E5E3] dark:border-[#343434] bg-[#FFFFFF] dark:bg-[#262626] hover:border-violet-400'
                              }`}
                            >
                              <span
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 ${
                                  selected
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-[#F1F1EF] dark:bg-[#191919] text-[#787774]'
                                }`}
                              >
                                {letter}
                              </span>
                              <span className="flex-1 min-w-0 pt-0.5">
                                <InlineMath text={opt} />
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
                      className="min-h-[44px] px-6 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-[14px] font-semibold shadow-xs"
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
              <div className="lg:col-span-5 rounded-2xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-5 space-y-4 h-fit">
                <div>
                  <h2 className="text-[14px] font-semibold mb-2">
                    {t.selectQuizDocs} ({selectedDocIds.length})
                  </h2>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {documents.map((doc) => {
                      const checked = selectedDocIds.includes(doc.id);
                      return (
                        <label
                          key={doc.id}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border text-[14px] cursor-pointer transition ${
                            checked
                              ? 'border-violet-500/60 bg-[#FFFFFF] dark:bg-[#262626]'
                              : 'border-transparent hover:bg-[#F1F1EF] dark:hover:bg-[#262626]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSourceDoc(doc.id)}
                            className="rounded border-[#BDBCB8] text-violet-600 focus:ring-violet-500 shrink-0"
                          />
                          <span className="truncate">{doc.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#E5E5E3] dark:border-[#2F2F2F]">
                  <span className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                    {t.questionCountLabel}
                  </span>
                  <div className="inline-flex gap-1.5">
                    {[3, 5, 8].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuestionCount(n)}
                        className={`w-9 h-8 rounded-lg text-[13px] font-semibold transition ${
                          questionCount === n
                            ? 'bg-violet-600 text-white'
                            : 'bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#3A3A3A]'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Max-3 Tags */}
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                    {t.quizTagsLabel} ({quizTags.length}/{MAX_TAGS})
                  </label>
                  {quizTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {quizTags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[12px] font-medium"
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
                        className="flex-1 min-w-0 h-[38px] px-3 rounded-lg border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={handleAddTag}
                        disabled={!tagDraft.trim()}
                        className="px-3 rounded-lg bg-[#E5E5E3] dark:bg-[#2F2F2F] text-[14px] font-semibold disabled:opacity-40"
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
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[14px] font-semibold shadow-xs transition"
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
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97]">
                  {t.savedQuizzes} ({quizzes.length})
                </h2>

                {quizzes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#E5E5E3] dark:border-[#2F2F2F] p-10 text-center text-[#787774] dark:text-[#9B9A97] text-[14px]">
                    {t.noQuizzesYet}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {quizzes.map((quiz) => (
                      <div
                        key={quiz.id}
                        className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] p-4 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <h3 className="font-semibold text-[15px] truncate">{quiz.title}</h3>
                          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#787774] dark:text-[#9B9A97]">
                            <span>
                              {quiz.lastScore
                                ? `${quiz.lastScore.correct}/${quiz.lastScore.total} (${quiz.lastScore.pct}%)`
                                : `${quiz.questions.length} Q`}
                            </span>
                            {(quiz.tags || []).slice(0, MAX_TAGS).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium"
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
                            className="min-h-[36px] px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold inline-flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>{quiz.lastScore ? t.retakeQuiz : t.takeQuiz}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteQuiz(quiz.id)}
                            className="p-2 rounded-lg text-[#787774] hover:text-rose-600 hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
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

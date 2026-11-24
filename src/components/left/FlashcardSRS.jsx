import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import {
  Layers,
  Plus,
  Sparkles,
  Play,
  Clock,
  X,
  Trash2,
  BarChart3,
  RotateCw,
  Loader2,
  BookOpen,
} from 'lucide-react';
import {
  RATING,
  createFlashcard,
  calculateNextReview,
  previewIntervalLabel,
  getDueCards,
  getNextScheduledReviewTime,
  formatScheduledTime,
} from '../../services/srsAlgorithm';
import { extractFlashcardsFromDocument } from '../../services/geminiService';

function MathText({ content }) {
  return (
    <div className="study-markdown text-[17px] overflow-x-auto max-w-full">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

export default function FlashcardSRS({
  flashcards,
  onAddFlashcards,
  onUpdateFlashcard,
  onDeleteFlashcard,
  srsStats,
  onSaveSrsStats,
  selectedDocument,
  onNotify,
  t,
  lang,
  density,
}) {
  const [showManualModal, setShowManualModal] = useState(false);
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Manual creation fields
  const [frontInput, setFrontInput] = useState('');
  const [backInput, setBackInput] = useState('');

  // AI extraction state
  const [isExtracting, setIsExtracting] = useState(false);

  // Review session state
  const [reviewQueue, setReviewQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionRatings, setSessionRatings] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [showSummary, setShowSummary] = useState(false);

  const now = Date.now();
  const dueCards = useMemo(() => getDueCards(flashcards, now), [flashcards, now]);
  const nextReviewTs = useMemo(() => getNextScheduledReviewTime(flashcards), [flashcards]);

  // Spacebar to flip & 1-4 to rate during review
  useEffect(() => {
    if (!showReviewModal || showSummary) return;
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setIsFlipped((f) => !f);
      } else if (isFlipped && ['1', '2', '3', '4'].includes(e.key)) {
        const map = { '1': RATING.AGAIN, '2': RATING.HARD, '3': RATING.GOOD, '4': RATING.EASY };
        handleRateCard(map[e.key]);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const handleStartReview = () => {
    const queue = dueCards.length > 0 ? dueCards : [...flashcards];
    if (queue.length === 0) return;
    setReviewQueue(queue);
    setCurrentIdx(0);
    setIsFlipped(false);
    setSessionRatings({ again: 0, hard: 0, good: 0, easy: 0 });
    setShowSummary(false);
    setShowReviewModal(true);
  };

  const handleRateCard = (quality) => {
    const currentCard = reviewQueue[currentIdx];
    if (!currentCard) return;

    const updated = calculateNextReview(currentCard, quality);
    onUpdateFlashcard(updated);

    const nextRatings = {
      ...sessionRatings,
      again: sessionRatings.again + (quality === RATING.AGAIN ? 1 : 0),
      hard: sessionRatings.hard + (quality === RATING.HARD ? 1 : 0),
      good: sessionRatings.good + (quality === RATING.GOOD ? 1 : 0),
      easy: sessionRatings.easy + (quality === RATING.EASY ? 1 : 0),
    };
    setSessionRatings(nextRatings);

    if (currentIdx + 1 >= reviewQueue.length) {
      const reviewed = nextRatings.again + nextRatings.hard + nextRatings.good + nextRatings.easy;
      const recalled = nextRatings.hard + nextRatings.good + nextRatings.easy;
      const accuracy = reviewed > 0 ? Math.round((recalled / reviewed) * 100) : 0;

      onSaveSrsStats({
        totalReviewedAllTime: (srsStats?.totalReviewedAllTime || 0) + reviewed,
        lastSession: {
          completedAt: Date.now(),
          reviewed,
          accuracy,
          ratings: nextRatings,
        },
      });
      setShowSummary(true);
    } else {
      setCurrentIdx((i) => i + 1);
      setIsFlipped(false);
    }
  };

  const handleAddManual = (e) => {
    e.preventDefault();
    if (!frontInput.trim() || !backInput.trim()) return;
    const card = createFlashcard({
      front: frontInput,
      back: backInput,
      documentId: selectedDocument?.id || null,
      sourceTitle: selectedDocument?.title || '',
    });
    onAddFlashcards([card]);
    setFrontInput('');
    setBackInput('');
    setShowManualModal(false);
  };

  const handleAIExtract = async () => {
    if (!selectedDocument) {
      onNotify(t.selectDocFirstForAI, 'warning');
      return;
    }
    setIsExtracting(true);
    try {
      const extracted = await extractFlashcardsFromDocument({
        document: selectedDocument,
        count: 5,
        language: lang,
      });
      if (extracted.length > 0) {
        const newCards = extracted.map((c) =>
          createFlashcard({
            front: c.front,
            back: c.back,
            documentId: selectedDocument.id,
            sourceTitle: selectedDocument.title,
          })
        );
        onAddFlashcards(newCards);
        onNotify(t.aiExtractedCount(newCards.length), 'success');
      }
    } catch (err) {
      if (err.code === 'MISSING_API_KEY') {
        onNotify(t.missingApiKeyError, 'error');
      } else {
        onNotify(`${t.aiErrorPrefix}${err.message}`, 'error');
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const currentCard = reviewQueue[currentIdx];
  const pad = density === 'compact' ? 'p-2.5' : 'p-3.5';

  const totalReviewed =
    sessionRatings.again + sessionRatings.hard + sessionRatings.good + sessionRatings.easy;
  const accuracyPct =
    totalReviewed > 0
      ? Math.round(
          ((sessionRatings.hard + sessionRatings.good + sessionRatings.easy) / totalReviewed) * 100
        )
      : 0;

  return (
    <section className={`flex flex-col h-full min-h-0 ${pad} bg-white dark:bg-[#0F172A]`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-1.5 mb-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <h2 className="font-semibold text-[17px] leading-tight truncate text-slate-900 dark:text-slate-100">
            {t.flashcardsTitle}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setShowDeckModal(true)}
          className="text-xs font-semibold px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
        >
          {t.totalCards(flashcards.length)}
        </button>
      </div>

      {/* Status & Next Review Reminder Card */}
      <div className="flex-1 min-h-0 flex flex-col justify-between gap-2 overflow-y-auto">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                dueCards.length > 0
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {dueCards.length > 0 ? t.dueNow(dueCards.length) : t.allCaughtUp}
            </span>
            {srsStats?.lastSession && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                <BarChart3 className="w-3.5 h-3.5" />
                {srsStats.lastSession.accuracy}%
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="truncate">
              {t.nextReviewAt}:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {formatScheduledTime(nextReviewTs, lang)}
              </strong>
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-1.5 shrink-0">
          <button
            type="button"
            disabled={flashcards.length === 0}
            onClick={handleStartReview}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-semibold shadow-sm transition"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {t.reviewNow} {dueCards.length > 0 ? `(${dueCards.length})` : ''}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="min-h-[38px] inline-flex items-center justify-center gap-1 px-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="truncate">{t.newCard}</span>
            </button>

            <button
              type="button"
              disabled={isExtracting}
              onClick={handleAIExtract}
              className="min-h-[38px] inline-flex items-center justify-center gap-1 px-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-xs font-semibold transition disabled:opacity-60"
            >
              {isExtracting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span className="truncate">{isExtracting ? t.extracting : t.aiExtract}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Manual Flashcard Creation Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[19px] text-slate-900 dark:text-slate-100">
                {t.addCard}
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddManual} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.frontLabel}
                </label>
                <textarea
                  rows={3}
                  required
                  value={frontInput}
                  onChange={(e) => setFrontInput(e.target.value)}
                  placeholder={t.frontPlaceholder}
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  {t.backLabel}
                </label>
                <textarea
                  rows={3}
                  required
                  value={backInput}
                  onChange={(e) => setBackInput(e.target.value)}
                  placeholder={t.backPlaceholder}
                  className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[17px] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {(frontInput.trim() || backInput.trim()) && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {t.livePreview}
                  </p>
                  {frontInput.trim() && (
                    <div className="pb-2 border-b border-slate-200 dark:border-slate-800">
                      <MathText content={frontInput} />
                    </div>
                  )}
                  {backInput.trim() && <MathText content={backInput} />}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                >
                  {t.addCard}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deck Manager Modal */}
      {showDeckModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-bold text-[19px] text-slate-900 dark:text-slate-100">
                {t.flashcardsTitle} ({flashcards.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowDeckModal(false)}
                className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {flashcards.length === 0 ? (
                <p className="text-center text-slate-400 py-8">{t.noCardsYet}</p>
              ) : (
                flashcards.map((card) => (
                  <div
                    key={card.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/70 dark:bg-slate-900/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          <MathText content={card.front} />
                        </div>
                        <div className="text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-800 pt-1.5">
                          <MathText content={card.back} />
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1">
                          <span>EF: {card.easeFactor}</span>
                          <span>Reps: {card.repetitions}</span>
                          <span>
                            {t.nextReviewAt}: {formatScheduledTime(card.nextReviewAt, lang)}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteFlashcard(card.id)}
                        title={t.deleteCard}
                        className="touch-target inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive SRS Review & Session Summary Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-[19px] text-slate-900 dark:text-slate-100">
                  {showSummary ? t.sessionSummaryTitle : t.flashcardsTitle}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                {!showSummary && (
                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    {currentIdx + 1} / {reviewQueue.length}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowReviewModal(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {showSummary ? (
              /* Post-Review Statistics Dashboard */
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-slate-400">
                      {t.cardsReviewed}
                    </p>
                    <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-1">
                      {totalReviewed}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                      {t.accuracyRate}
                    </p>
                    <p className="text-3xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1">
                      {accuracyPct}%
                    </p>
                  </div>
                  <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 p-4 text-center">
                    <p className="text-xs font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                      {t.nextScheduledReview}
                    </p>
                    <p className="text-sm font-bold text-indigo-800 dark:text-indigo-200 mt-2">
                      {formatScheduledTime(getNextScheduledReviewTime(flashcards), lang)}
                    </p>
                  </div>
                </div>

                {/* Retention Breakdown */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {t.retentionBreakdown}
                  </h4>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-2.5">
                      <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                        {t.rateAgain}
                      </p>
                      <p className="text-xl font-bold text-rose-700 dark:text-rose-300">
                        {sessionRatings.again}
                      </p>
                    </div>
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-2.5">
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {t.rateHard}
                      </p>
                      <p className="text-xl font-bold text-amber-700 dark:text-amber-300">
                        {sessionRatings.hard}
                      </p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-2.5">
                      <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        {t.rateGood}
                      </p>
                      <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                        {sessionRatings.good}
                      </p>
                    </div>
                    <div className="rounded-xl bg-sky-50 dark:bg-sky-950/40 p-2.5">
                      <p className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                        {t.rateEasy}
                      </p>
                      <p className="text-xl font-bold text-sky-700 dark:text-sky-300">
                        {sessionRatings.easy}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowReviewModal(false)}
                    className="min-h-[44px] px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
                  >
                    {t.doneReviewing}
                  </button>
                </div>
              </div>
            ) : currentCard ? (
              /* Active Flashcard Review */
              <div className="space-y-5">
                {/* Progress bar */}
                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${((currentIdx + 1) / reviewQueue.length) * 100}%` }}
                  />
                </div>

                {/* Flip Card Surface */}
                <div
                  onClick={() => setIsFlipped((f) => !f)}
                  className="min-h-[240px] rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#09090B] p-6 flex flex-col justify-between cursor-pointer select-none hover:border-indigo-400 dark:hover:border-indigo-500 transition"
                >
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                    <span>{isFlipped ? 'Back' : 'Front'}</span>
                    {currentCard.sourceTitle && (
                      <span className="truncate max-w-[65%]">{currentCard.sourceTitle}</span>
                    )}
                  </div>

                  <div className="my-auto py-3 text-slate-900 dark:text-slate-100">
                    <MathText content={isFlipped ? currentCard.back : currentCard.front} />
                  </div>

                  <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 mt-3 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>{t.tapToFlip}</span>
                  </div>
                </div>

                {/* Reveal or SM-2 Rating Buttons */}
                {!isFlipped ? (
                  <button
                    type="button"
                    onClick={() => setIsFlipped(true)}
                    className="w-full min-h-[48px] rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[17px] transition"
                  >
                    {t.showAnswer}
                  </button>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      {
                        label: t.rateAgain,
                        q: RATING.AGAIN,
                        cls: 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300',
                      },
                      {
                        label: t.rateHard,
                        q: RATING.HARD,
                        cls: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
                      },
                      {
                        label: t.rateGood,
                        q: RATING.GOOD,
                        cls: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
                      },
                      {
                        label: t.rateEasy,
                        q: RATING.EASY,
                        cls: 'bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/50 dark:hover:bg-sky-900/60 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300',
                      },
                    ].map((btn) => (
                      <button
                        key={btn.q}
                        type="button"
                        onClick={() => handleRateCard(btn.q)}
                        className={`min-h-[54px] rounded-xl border flex flex-col items-center justify-center font-semibold transition ${btn.cls}`}
                      >
                        <span className="text-[15px]">{btn.label}</span>
                        <span className="text-xs opacity-75">
                          {previewIntervalLabel(currentCard, btn.q, lang)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

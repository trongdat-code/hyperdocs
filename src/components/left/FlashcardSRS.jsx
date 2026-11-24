import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
    <div className="study-markdown text-[15px] overflow-x-auto max-w-full">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}

export default function FlashcardSRS({
  flashcards,
  documents,
  selectedDocument,
  onAddFlashcards,
  onUpdateFlashcard,
  onDeleteFlashcard,
  srsStats,
  onSaveSrsStats,
  onNotify,
  t,
  lang,
}) {
  const [showManualModal, setShowManualModal] = useState(false);
  const [extractDocId, setExtractDocId] = useState(
    selectedDocument?.id || documents?.[0]?.id || ''
  );

  // Manual creation fields
  const [frontInput, setFrontInput] = useState('');
  const [backInput, setBackInput] = useState('');

  // AI extraction state
  const [isExtracting, setIsExtracting] = useState(false);

  // Review session state (rendered inline in workspace)
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionRatings, setSessionRatings] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    if (!extractDocId && documents?.length > 0) {
      setExtractDocId(selectedDocument?.id || documents[0].id);
    }
  }, [documents, selectedDocument?.id, extractDocId]);

  const now = Date.now();
  const dueCards = useMemo(() => getDueCards(flashcards, now), [flashcards, now]);
  const nextReviewTs = useMemo(() => getNextScheduledReviewTime(flashcards), [flashcards]);

  useEffect(() => {
    if (!isReviewing || showSummary) return;
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
    setIsReviewing(true);
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
    const targetDoc = documents.find((d) => d.id === extractDocId) || selectedDocument || null;
    const card = createFlashcard({
      front: frontInput,
      back: backInput,
      documentId: targetDoc?.id || null,
      sourceTitle: targetDoc?.title || '',
    });
    onAddFlashcards([card]);
    setFrontInput('');
    setBackInput('');
    setShowManualModal(false);
  };

  const handleAIExtract = async () => {
    const targetDoc = documents.find((d) => d.id === extractDocId) || selectedDocument;
    if (!targetDoc) {
      onNotify(t.selectDocFirstForAI, 'warning');
      return;
    }
    setIsExtracting(true);
    try {
      const extracted = await extractFlashcardsFromDocument({
        document: targetDoc,
        count: 5,
        language: lang,
      });
      if (extracted.length > 0) {
        const newCards = extracted.map((c) =>
          createFlashcard({
            front: c.front,
            back: c.back,
            documentId: targetDoc.id,
            sourceTitle: targetDoc.title,
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
  const totalReviewed =
    sessionRatings.again + sessionRatings.hard + sessionRatings.good + sessionRatings.easy;
  const accuracyPct =
    totalReviewed > 0
      ? Math.round(
          ((sessionRatings.hard + sessionRatings.good + sessionRatings.easy) / totalReviewed) * 100
        )
      : 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#FFFFFF] dark:bg-[#191919]">
      {/* Page Header */}
      <div className="px-6 sm:px-10 pt-6 pb-4 border-b border-[#E5E5E3] dark:border-[#2F2F2F] shrink-0">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-[#2F2F2F] dark:text-[#E8E8E6]">
                {t.flashcardsTitle}
              </h1>
              <p className="text-[13px] text-[#787774] dark:text-[#9B9A97]">
                {t.flashcardsSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="min-h-[40px] px-3.5 rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#262626] hover:bg-[#F1F1EF] dark:hover:bg-[#323232] text-[#2F2F2F] dark:text-[#E8E8E6] text-[14px] font-medium inline-flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>{t.newCard}</span>
            </button>

            <button
              type="button"
              disabled={flashcards.length === 0}
              onClick={handleStartReview}
              className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[14px] font-semibold inline-flex items-center gap-2 shadow-xs transition"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>
                {t.reviewNow} {dueCards.length > 0 ? `(${dueCards.length})` : ''}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-6 min-h-0">
        <div className="max-w-5xl mx-auto space-y-6">
          {isReviewing ? (
            /* Active Review or Session Summary inside Workspace */
            <div className="max-w-2xl mx-auto rounded-2xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-500" />
                  <h2 className="font-semibold text-[16px] text-[#2F2F2F] dark:text-[#E8E8E6]">
                    {showSummary ? t.sessionSummaryTitle : t.flashcardsTitle}
                  </h2>
                </div>
                <div className="flex items-center gap-3">
                  {!showSummary && (
                    <span className="text-[13px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {currentIdx + 1} / {reviewQueue.length}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsReviewing(false)}
                    className="p-1.5 rounded-lg text-[#787774] hover:bg-[#EBEBE8] dark:hover:bg-[#323232]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {showSummary ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] p-4 text-center">
                      <p className="text-[12px] font-medium uppercase text-[#787774]">
                        {t.cardsReviewed}
                      </p>
                      <p className="text-3xl font-bold mt-1">{totalReviewed}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-4 text-center">
                      <p className="text-[12px] font-medium uppercase text-emerald-600 dark:text-emerald-400">
                        {t.accuracyRate}
                      </p>
                      <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                        {accuracyPct}%
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] p-4 text-center">
                      <p className="text-[12px] font-medium uppercase text-[#787774]">
                        {t.nextScheduledReview}
                      </p>
                      <p className="text-[14px] font-semibold mt-2">
                        {formatScheduledTime(getNextScheduledReviewTime(flashcards), lang)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] p-4 space-y-2.5">
                    <h4 className="text-[13px] font-semibold text-[#787774] dark:text-[#9B9A97]">
                      {t.retentionBreakdown}
                    </h4>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="rounded-lg bg-rose-500/10 p-2.5">
                        <p className="text-[12px] font-medium text-rose-600 dark:text-rose-400">
                          {t.rateAgain}
                        </p>
                        <p className="text-xl font-bold text-rose-700 dark:text-rose-300">
                          {sessionRatings.again}
                        </p>
                      </div>
                      <div className="rounded-lg bg-amber-500/10 p-2.5">
                        <p className="text-[12px] font-medium text-amber-600 dark:text-amber-400">
                          {t.rateHard}
                        </p>
                        <p className="text-xl font-bold text-amber-700 dark:text-amber-300">
                          {sessionRatings.hard}
                        </p>
                      </div>
                      <div className="rounded-lg bg-emerald-500/10 p-2.5">
                        <p className="text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                          {t.rateGood}
                        </p>
                        <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                          {sessionRatings.good}
                        </p>
                      </div>
                      <div className="rounded-lg bg-sky-500/10 p-2.5">
                        <p className="text-[12px] font-medium text-sky-600 dark:text-sky-400">
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
                      onClick={() => setIsReviewing(false)}
                      className="min-h-[40px] px-5 rounded-xl bg-[#2F2F2F] dark:bg-[#E8E8E6] text-white dark:text-[#191919] text-[14px] font-semibold"
                    >
                      {t.doneReviewing}
                    </button>
                  </div>
                </div>
              ) : currentCard ? (
                <div className="space-y-4">
                  <div className="h-1.5 w-full rounded-full bg-[#E5E5E3] dark:bg-[#2F2F2F] overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${((currentIdx + 1) / reviewQueue.length) * 100}%` }}
                    />
                  </div>

                  <div
                    onClick={() => setIsFlipped((f) => !f)}
                    className="min-h-[240px] rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#262626] p-6 flex flex-col justify-between cursor-pointer select-none hover:border-indigo-400 transition"
                  >
                    <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97] mb-3">
                      <span>{isFlipped ? 'Back' : 'Front'}</span>
                      {currentCard.sourceTitle && (
                        <span className="truncate max-w-[65%]">{currentCard.sourceTitle}</span>
                      )}
                    </div>

                    <div className="my-auto py-3">
                      <MathText content={isFlipped ? currentCard.back : currentCard.front} />
                    </div>

                    <div className="flex items-center justify-center gap-1.5 text-[12px] text-[#787774] mt-3 pt-2 border-t border-[#E5E5E3] dark:border-[#2F2F2F]">
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>{t.tapToFlip}</span>
                    </div>
                  </div>

                  {!isFlipped ? (
                    <button
                      type="button"
                      onClick={() => setIsFlipped(true)}
                      className="w-full min-h-[44px] rounded-xl bg-[#2F2F2F] hover:bg-[#191919] dark:bg-[#E8E8E6] dark:hover:bg-white text-white dark:text-[#191919] font-semibold text-[15px] transition"
                    >
                      {t.showAnswer}
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        {
                          label: t.rateAgain,
                          q: RATING.AGAIN,
                          cls: 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/25 text-rose-700 dark:text-rose-300',
                        },
                        {
                          label: t.rateHard,
                          q: RATING.HARD,
                          cls: 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/25 text-amber-700 dark:text-amber-300',
                        },
                        {
                          label: t.rateGood,
                          q: RATING.GOOD,
                          cls: 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/25 text-emerald-700 dark:text-emerald-300',
                        },
                        {
                          label: t.rateEasy,
                          q: RATING.EASY,
                          cls: 'bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/25 text-sky-700 dark:text-sky-300',
                        },
                      ].map((btn) => (
                        <button
                          key={btn.q}
                          type="button"
                          onClick={() => handleRateCard(btn.q)}
                          className={`min-h-[52px] rounded-xl border flex flex-col items-center justify-center font-semibold transition ${btn.cls}`}
                        >
                          <span className="text-[14px]">{btn.label}</span>
                          <span className="text-[12px] opacity-75">
                            {previewIntervalLabel(currentCard, btn.q, lang)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {/* Top Stats & AI Extraction Bar */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {t.dueNow(dueCards.length)}
                    </p>
                    <p className="text-2xl font-bold mt-0.5">{t.totalCards(flashcards.length)}</p>
                  </div>
                  <div className="text-right text-[13px] text-[#787774] dark:text-[#9B9A97]">
                    <div className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{t.nextReviewAt}</span>
                    </div>
                    <p className="font-semibold text-[#2F2F2F] dark:text-[#E8E8E6]">
                      {formatScheduledTime(nextReviewTs, lang)}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-medium text-[#787774] dark:text-[#9B9A97]">
                      {t.lastSessionLabel}
                    </p>
                    <p className="text-2xl font-bold mt-0.5">
                      {srsStats?.lastSession ? `${srsStats.lastSession.accuracy}%` : '—'}
                    </p>
                  </div>
                  <BarChart3 className="w-7 h-7 text-indigo-500/70" />
                </div>

                {/* AI Extract from Document */}
                <div className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#202020] p-3.5 flex flex-col justify-between gap-2">
                  <label className="text-[12px] font-medium text-[#787774] dark:text-[#9B9A97]">
                    {t.selectExtractDocLabel}
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      value={extractDocId}
                      onChange={(e) => setExtractDocId(e.target.value)}
                      className="flex-1 min-w-0 h-[36px] px-2.5 rounded-lg border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[13px] truncate"
                    >
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={isExtracting || !extractDocId}
                      onClick={handleAIExtract}
                      className="h-[36px] px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold inline-flex items-center gap-1.5 shrink-0 transition"
                    >
                      {isExtracting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      <span>{isExtracting ? t.extracting : t.aiExtract}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Flashcard Deck Grid */}
              <div className="space-y-3">
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#787774] dark:text-[#9B9A97]">
                  {t.allCardsHeading} ({flashcards.length})
                </h2>

                {flashcards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#E5E5E3] dark:border-[#2F2F2F] p-10 text-center text-[#787774] dark:text-[#9B9A97] text-[15px]">
                    {t.noCardsYet}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {flashcards.map((card) => (
                      <div
                        key={card.id}
                        className="group rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#FFFFFF] dark:bg-[#202020] hover:bg-[#F7F7F5] dark:hover:bg-[#262626] p-4 transition flex flex-col justify-between gap-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0 font-medium">
                            <MathText content={card.front} />
                          </div>
                          <button
                            type="button"
                            onClick={() => onDeleteFlashcard(card.id)}
                            title={t.deleteCard}
                            className="p-1.5 rounded-lg text-[#787774] hover:text-rose-600 opacity-0 group-hover:opacity-100 transition shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="pt-2 border-t border-[#E5E5E3] dark:border-[#2F2F2F] text-[#555552] dark:text-[#C5C4C0]">
                          <MathText content={card.back} />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#787774] dark:text-[#9B9A97] pt-1">
                          <span>
                            EF {card.easeFactor} · Reps {card.repetitions}
                          </span>
                          <span>
                            {t.nextReviewAt}: {formatScheduledTime(card.nextReviewAt, lang)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Manual Flashcard Creation Modal */}
      {showManualModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4">
            <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-[#FFFFFF] dark:bg-[#262626] border border-[#E5E5E3] dark:border-[#2F2F2F] shadow-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[17px]">{t.addCard}</h3>
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="touch-target inline-flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#F1F1EF] dark:hover:bg-[#323232]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddManual} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                    {t.frontLabel}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={frontInput}
                    onChange={(e) => setFrontInput(e.target.value)}
                    placeholder={t.frontPlaceholder}
                    className="w-full p-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[#787774] dark:text-[#9B9A97] mb-1.5">
                    {t.backLabel}
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={backInput}
                    onChange={(e) => setBackInput(e.target.value)}
                    placeholder={t.backPlaceholder}
                    className="w-full p-3 rounded-xl border border-[#E5E5E3] dark:border-[#3A3A3A] bg-[#FFFFFF] dark:bg-[#191919] text-[15px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {(frontInput.trim() || backInput.trim()) && (
                  <div className="rounded-xl border border-[#E5E5E3] dark:border-[#2F2F2F] bg-[#F7F7F5] dark:bg-[#191919] p-3.5 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#787774]">
                      {t.livePreview}
                    </p>
                    {frontInput.trim() && (
                      <div className="pb-2 border-b border-[#E5E5E3] dark:border-[#2F2F2F]">
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
                    className="min-h-[40px] px-4 rounded-lg border border-[#E5E5E3] dark:border-[#3A3A3A] text-[14px] font-medium"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="min-h-[40px] px-5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[14px] font-semibold"
                  >
                    {t.addCard}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

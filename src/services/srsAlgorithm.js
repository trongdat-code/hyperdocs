/**
 * SM-2 Spaced Repetition Algorithm
 * Ratings:
 *  0 = Again (complete blackout / reset)
 *  3 = Hard  (recalled with difficulty)
 *  4 = Good  (recalled with reasonable effort)
 *  5 = Easy  (instant effortless recall)
 */

export const RATING = {
  AGAIN: 0,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Create a new flashcard with initial SM-2 parameters.
 */
export function createFlashcard({ front, back, documentId = null, sourceTitle = '' }) {
  const now = Date.now();
  return {
    id: `fc_${now}_${Math.random().toString(36).slice(2, 8)}`,
    front: front.trim(),
    back: back.trim(),
    documentId,
    sourceTitle,
    easeFactor: 2.5,
    interval: 0, // in days
    repetitions: 0,
    lapses: 0,
    createdAt: now,
    lastReviewedAt: null,
    nextReviewAt: now, // due immediately
  };
}

/**
 * Calculate the next SM-2 state for a card given a recall rating.
 * @param {object} card
 * @param {0|3|4|5} quality
 * @param {number} now
 */
export function calculateNextReview(card, quality, now = Date.now()) {
  let easeFactor = card.easeFactor ?? 2.5;
  let interval = card.interval ?? 0;
  let repetitions = card.repetitions ?? 0;
  let lapses = card.lapses ?? 0;

  let nextDelayMs;

  if (quality < 3) {
    // Again: reset repetition streak, schedule short re-learning step (10 minutes)
    repetitions = 0;
    interval = 0;
    lapses += 1;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    nextDelayMs = 10 * MINUTE_MS;
  } else {
    // Update ease factor using SM-2 formula: EF' = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))
    const diff = 5 - quality;
    easeFactor = easeFactor + (0.1 - diff * (0.08 + diff * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;
    easeFactor = Math.round(easeFactor * 100) / 100;

    if (repetitions === 0) {
      interval = quality === RATING.HARD ? 0.5 : quality === RATING.EASY ? 4 : 1;
    } else if (repetitions === 1) {
      interval = quality === RATING.HARD ? 3 : quality === RATING.EASY ? 8 : 6;
    } else {
      const multiplier = quality === RATING.HARD ? 0.85 : quality === RATING.EASY ? 1.3 : 1.0;
      interval = Math.max(1, Math.round(interval * easeFactor * multiplier));
    }

    repetitions += 1;
    nextDelayMs = Math.round(interval * DAY_MS);
  }

  return {
    ...card,
    easeFactor,
    interval,
    repetitions,
    lapses,
    lastReviewedAt: now,
    nextReviewAt: now + nextDelayMs,
  };
}

/**
 * Preview human-readable next interval for UI rating buttons.
 */
export function previewIntervalLabel(card, quality, lang = 'en') {
  const simulated = calculateNextReview(card, quality, 0);
  const ms = simulated.nextReviewAt;
  if (ms < 60 * MINUTE_MS) {
    const mins = Math.max(1, Math.round(ms / MINUTE_MS));
    return lang === 'vi' ? `${mins}p` : `${mins}m`;
  }
  if (ms < DAY_MS) {
    const hrs = Math.round(ms / (60 * MINUTE_MS));
    return lang === 'vi' ? `${hrs}g` : `${hrs}h`;
  }
  const days = Math.round(ms / DAY_MS);
  return lang === 'vi' ? `${days} ngày` : `${days}d`;
}

/**
 * Get cards currently due for review, sorted oldest-due first.
 */
export function getDueCards(cards, now = Date.now()) {
  return [...cards]
    .filter((card) => (card.nextReviewAt ?? 0) <= now)
    .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));
}

/**
 * Find the earliest upcoming scheduled review timestamp across all cards.
 */
export function getNextScheduledReviewTime(cards) {
  if (!cards || cards.length === 0) return null;
  let earliest = Infinity;
  for (const card of cards) {
    const ts = card.nextReviewAt ?? 0;
    if (ts < earliest) earliest = ts;
  }
  return earliest === Infinity ? null : earliest;
}

/**
 * Format exact scheduled time for reminder display.
 */
export function formatScheduledTime(timestamp, lang = 'en', now = Date.now()) {
  if (!timestamp) return '—';
  if (timestamp <= now) {
    return lang === 'vi' ? 'Ngay bây giờ' : 'Now';
  }
  const date = new Date(timestamp);
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  return date.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

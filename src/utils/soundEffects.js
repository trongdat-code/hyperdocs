/**
 * Synthesized Bell Chime via Browser Native Web Audio API
 * Zero external audio assets required.
 */

export function playPomodoroChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Gentle two-tone harmonic bell chime (C5 -> G5 with soft 2nd harmonic overtone)
    const tones = [
      { freq: 523.25, overtone: 1046.5, start: 0, duration: 0.75, peak: 0.14 },
      { freq: 783.99, overtone: 1567.98, start: 0.24, duration: 1.05, peak: 0.13 },
    ];

    tones.forEach(({ freq, overtone, start, duration, peak }) => {
      // Fundamental sine bell
      const oscMain = ctx.createOscillator();
      const gainMain = ctx.createGain();
      oscMain.type = 'sine';
      oscMain.frequency.setValueAtTime(freq, now + start);

      gainMain.gain.setValueAtTime(0.0001, now + start);
      gainMain.gain.exponentialRampToValueAtTime(peak, now + start + 0.025);
      gainMain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      oscMain.connect(gainMain);
      gainMain.connect(ctx.destination);
      oscMain.start(now + start);
      oscMain.stop(now + start + duration + 0.05);

      // Soft harmonic shimmer overtone
      const oscHarm = ctx.createOscillator();
      const gainHarm = ctx.createGain();
      oscHarm.type = 'sine';
      oscHarm.frequency.setValueAtTime(overtone, now + start);

      gainHarm.gain.setValueAtTime(0.0001, now + start);
      gainHarm.gain.exponentialRampToValueAtTime(peak * 0.28, now + start + 0.02);
      gainHarm.gain.exponentialRampToValueAtTime(0.0001, now + start + duration * 0.65);

      oscHarm.connect(gainHarm);
      gainHarm.connect(ctx.destination);
      oscHarm.start(now + start);
      oscHarm.stop(now + start + duration * 0.7);
    });

    // Cleanly release AudioContext after chime finishes
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1600);
  } catch {
    // Gracefully ignore browser autoplay / audio context restrictions
  }
}

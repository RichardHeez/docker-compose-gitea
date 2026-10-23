// Song timelines: an audio track plus the time (seconds) at which each slide comes up, like ProPresenter's timeline.
// timeline = { audio: '/media/track.mp3', audioName: 'track.mp3', cues: [0, 12.4, 25.1, …] }  — cues[i] = when slide i starts.

export function cleanTimeline(tl) {
  if (!tl || typeof tl !== 'object') return null;
  const audio = String(tl.audio || '').slice(0, 500);
  if (audio && !/^(https?:|\/)/i.test(audio)) return null;
  const cues = (Array.isArray(tl.cues) ? tl.cues : []).slice(0, 500).map((c) => (c === null || c === '' ? null : Number(c)))
    .map((c) => (c === null || !Number.isFinite(c) ? null : Math.max(0, Math.round(c * 100) / 100)));
  if (!audio && !cues.some((c) => c !== null)) return null;
  return { audio, audioName: String(tl.audioName || audio.split('/').pop() || '').slice(0, 200), cues, next: !!tl.next };
}

// Index of the slide that should be showing at time t (the last cue at or before t), or -1 before the first cue.
// Missing cues (null) are skipped, so a slide without a time is simply never jumped to.
export function cueIndexAt(cues, t) {
  let best = -1, bestT = -Infinity;
  (cues || []).forEach((c, i) => { if (c !== null && c !== undefined && c <= t + 1e-6 && c >= bestT) { best = i; bestT = c; } });
  return best;
}

export const shiftCues = (cues, by) => (cues || []).map((c) => (c === null || c === undefined ? c : Math.max(0, Math.round((c + by) * 100) / 100)));

export function formatTime(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '–:––';
  const s = Math.max(0, sec); const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function parseTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return Math.round(((Number(m[1] || 0) * 60) + Number(m[2])) * 100) / 100;
}

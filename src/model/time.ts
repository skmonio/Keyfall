import type { Song } from './song';

/** Convert song time (seconds) to a position in quarter notes, using the song's tempo map. */
export function secToQuarter(song: Pick<Song, 'tempos'>, t: number): number {
  const tempos = song.tempos.length ? song.tempos : [{ time: 0, bpm: 120 }];
  let q = 0;
  for (let i = 0; i < tempos.length; i++) {
    const seg = tempos[i];
    const next = tempos[i + 1]?.time ?? Infinity;
    if (t <= seg.time) break;
    const until = Math.min(t, next);
    q += ((until - seg.time) * seg.bpm) / 60;
    if (t <= next) break;
  }
  // Before the first tempo event, extrapolate at the first tempo.
  if (t < tempos[0].time) q -= ((tempos[0].time - t) * tempos[0].bpm) / 60;
  return q;
}

/**
 * Position in the *written* score (quarter notes) for a song time. Differs from secToQuarter
 * only for scores with repeats, where the music is played in a different order than written.
 */
export function writtenQuarter(song: Pick<Song, 'tempos' | 'measures'>, t: number): number {
  const q = secToQuarter(song, t);
  const ms = song.measures;
  if (!ms.length || ms[0].writtenQ === undefined) return q;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // A millisecond of slack: a note starting "at" a bar line belongs to the new bar.
    if (ms[mid].start <= t + 1e-3) lo = mid;
    else hi = mid - 1;
  }
  const m = ms[lo];
  return m.writtenQ! + Math.max(0, q - secToQuarter(song, m.start));
}

/** Inverse of secToQuarter. */
export function quarterToSec(song: Pick<Song, 'tempos'>, q: number): number {
  const tempos = song.tempos.length ? song.tempos : [{ time: 0, bpm: 120 }];
  let acc = 0;
  for (let i = 0; i < tempos.length; i++) {
    const seg = tempos[i];
    const next = tempos[i + 1];
    const segQ = next ? ((next.time - seg.time) * seg.bpm) / 60 : Infinity;
    if (q <= acc + segQ) return seg.time + ((q - acc) * 60) / seg.bpm;
    acc += segQ;
  }
  return 0;
}

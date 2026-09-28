/**
 * Fit a song onto a small keyboard (e.g. a 24-key LUMI).
 *
 * Finds the best keyboard position (an octave-aligned window, like the LUMI's octave
 * buttons give you) and, when the song is wider than the keyboard, shifts whole hands
 * by octaves and folds any remaining stray notes into range. The original pitch is kept
 * in `origPitch` so the backing track can still sound as written.
 */
import type { Hand, Note, Song } from './song';

export type KeyboardKind = 'auto' | 'lumi1' | 'lumi2' | 'keys25' | 'keys37' | 'keys49' | 'keys61' | 'keys88';

export interface KeyboardSpec {
  kind: Exclude<KeyboardKind, 'auto'>;
  keys: number;
  lumi: boolean;
  label: string;
}

export const KEYBOARDS: Record<Exclude<KeyboardKind, 'auto'>, KeyboardSpec> = {
  lumi1: { kind: 'lumi1', keys: 24, lumi: true, label: 'LUMI Keys (24 keys)' },
  lumi2: { kind: 'lumi2', keys: 48, lumi: true, label: '2 × LUMI chained (48 keys)' },
  keys25: { kind: 'keys25', keys: 25, lumi: false, label: '25 keys' },
  keys37: { kind: 'keys37', keys: 37, lumi: false, label: '37 keys' },
  keys49: { kind: 'keys49', keys: 49, lumi: false, label: '49 keys' },
  keys61: { kind: 'keys61', keys: 61, lumi: false, label: '61 keys' },
  keys88: { kind: 'keys88', keys: 88, lumi: false, label: 'Full 88 keys' },
};

export function resolveKeyboard(kind: KeyboardKind, lumiConnected: boolean): KeyboardSpec {
  if (kind === 'auto') return lumiConnected ? KEYBOARDS.lumi1 : KEYBOARDS.keys88;
  return KEYBOARDS[kind];
}

/** Lowest possible window starts. LUMI: C3 + 12 × octave, octave −4..+5. Others: any C. */
export function windowStarts(spec: KeyboardSpec): number[] {
  if (spec.keys >= 88) return [21];
  if (spec.lumi) return Array.from({ length: 10 }, (_, i) => 48 + 12 * (i - 4));
  const starts: number[] = [];
  for (let s = 12; s + spec.keys - 1 <= 127; s += 12) starts.push(s);
  return starts;
}

/**
 * Where must the keyboard be, given that it just sent `pitch`? A keyboard can only send
 * notes inside its own window, so the window contains `pitch`. Of the possible
 * positions, pick the one nearest to where we thought it was.
 */
export function detectPosition(pitch: number, spec: KeyboardSpec, currentLo: number): number | undefined {
  if (spec.keys >= 88) return undefined;
  if (pitch >= currentLo && pitch <= currentLo + spec.keys - 1) return undefined;
  const options = windowStarts(spec).filter((s) => pitch >= s && pitch <= s + spec.keys - 1);
  if (!options.length) return undefined;
  return options.sort((a, b) => Math.abs(a - currentLo) - Math.abs(b - currentLo))[0];
}

export function lumiOctaveFor(lo: number): number {
  return Math.round((lo - 48) / 12);
}

export interface FitPlan {
  /** Lowest and highest key of the keyboard position. */
  lo: number;
  hi: number;
  shift: Record<Hand, number>;
  /** Notes (of the practised hands) moved by an octave individually to fit. */
  folded: number;
  /** Places where both hands now need the same key at the same time (merged). */
  collisions: number;
  /** True when the practised part fits as written (no shifts, nothing folded). */
  fitsAsWritten: boolean;
  /** Whether each hand on its own would fit as written in some position. */
  handFits: Record<Hand, boolean>;
  songLo: number;
  songHi: number;
  /** LUMI octave-button setting for this position (LUMI keyboards only). */
  lumiOctave?: number;
  manual: boolean;
}

const SHIFTS = [0, 12, -12, 24, -24];

function fold(p: number, lo: number, hi: number): number {
  let q = p;
  while (q < lo) q += 12;
  while (q > hi) q -= 12;
  return q < lo ? lo : q;
}

function countCollisions(notes: { p: number; start: number; end: number; hand: Hand }[]): number {
  const byPitch = new Map<number, typeof notes>();
  for (const n of notes) {
    if (!byPitch.has(n.p)) byPitch.set(n.p, []);
    byPitch.get(n.p)!.push(n);
  }
  let c = 0;
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (a.hand !== b.hand && b.start < a.end - 0.02) c++;
    }
  }
  return c;
}

/**
 * @param hands  the hands being practised (only these must fit)
 * @param fixedLo  force this keyboard position (manual override)
 */
export function planFit(notes: Note[], hands: Set<Hand>, spec: KeyboardSpec, fixedLo?: number): FitPlan {
  const mine = notes.filter((n) => hands.has(n.hand) && !n.backing);
  const all = mine.length ? mine : notes;
  const songLo = Math.min(...all.map((n) => n.pitch));
  const songHi = Math.max(...all.map((n) => n.pitch));
  const handRange = (h: Hand) => {
    const ps = notes.filter((n) => n.hand === h && !n.backing).map((n) => n.pitch);
    return ps.length ? [Math.min(...ps), Math.max(...ps)] : null;
  };
  const starts = windowStarts(spec);
  const fitsSomewhere = (r: number[] | null) => !r || starts.some((s) => r[0] >= s && r[1] <= s + spec.keys - 1);
  const handFits = { L: fitsSomewhere(handRange('L')), R: fitsSomewhere(handRange('R')) };

  const candidates = fixedLo !== undefined ? [fixedLo] : starts;
  const handsList = [...hands];
  const center = (songLo + songHi) / 2;
  let best: (FitPlan & { cost: number }) | undefined;

  for (const lo of candidates) {
    const hi = lo + spec.keys - 1;
    for (const sL of hands.has('L') ? SHIFTS : [0]) {
      for (const sR of hands.has('R') ? SHIFTS : [0]) {
        const shift = { L: sL, R: sR };
        let folded = 0;
        const placed = mine.map((n) => {
          const p = n.pitch + shift[n.hand];
          const q = fold(p, lo, hi);
          if (q !== p) folded++;
          return { p: q, start: n.start, end: n.start + n.duration, hand: n.hand };
        });
        const collisions = handsList.length > 1 ? countCollisions(placed) : 0;
        const cost =
          folded * 3 +
          collisions * 4 +
          (Math.abs(sL) / 12) * 1 +
          (Math.abs(sR) / 12) * 1.5 + // prefer keeping the melody where it is
          Math.abs((lo + hi) / 2 - center) / 120; // tie-break: stay near the written pitch
        if (!best || cost < best.cost - 1e-9) {
          best = {
            cost,
            lo,
            hi,
            shift,
            folded,
            collisions,
            fitsAsWritten: folded === 0 && sL === 0 && sR === 0,
            handFits,
            songLo,
            songHi,
            lumiOctave: spec.lumi ? lumiOctaveFor(lo) : undefined,
            manual: fixedLo !== undefined,
          };
        }
      }
    }
  }
  const { cost: _ignored, ...plan } = best!;
  void _ignored;
  return plan;
}

/**
 * Return a copy of the song with the practised hands moved into the keyboard window.
 * Note ids are kept (so hand edits still map back to the original). Where both hands
 * land on the same key at the same time, the duplicate is dropped and overlapping holds
 * are shortened, because one key can't be pressed twice at once.
 */
export function applyFit(song: Song, plan: FitPlan, hands: Set<Hand>): Song {
  const notes: Note[] = song.notes.map((n) => {
    if (!hands.has(n.hand) || n.backing) return { ...n };
    const p = fold(n.pitch + plan.shift[n.hand], plan.lo, plan.hi);
    return p === n.pitch ? { ...n } : { ...n, pitch: p, origPitch: n.origPitch ?? n.pitch };
  });
  // Resolve same-key clashes among the practised notes.
  const byPitch = new Map<number, Note[]>();
  for (const n of notes) {
    if (!hands.has(n.hand) || n.backing) continue;
    if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
    byPitch.get(n.pitch)!.push(n);
  }
  const drop = new Set<number>();
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start || (a.hand === 'R' ? -1 : 1));
    let prev = list[0];
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (Math.abs(b.start - prev.start) < 0.03) {
        drop.add(b.id);
        continue;
      }
      if (b.start < prev.start + prev.duration) prev.duration = Math.max(0.05, b.start - prev.start - 0.01);
      prev = b;
    }
  }
  return { ...song, notes: notes.filter((n) => !drop.has(n.id)) };
}

import type { Hand, Note } from '../model/song';

export type Grade = 'perfect' | 'great' | 'good' | 'miss';

/** Timing windows in real milliseconds (either side of the note). */
export interface TimingWindows {
  perfect: number;
  great: number;
  good: number;
}

export const DEFAULT_WINDOWS: TimingWindows = { perfect: 40, great: 80, good: 120 };

export function gradeFor(deltaMs: number, w: TimingWindows): Exclude<Grade, 'miss'> | null {
  const d = Math.abs(deltaMs);
  if (d <= w.perfect) return 'perfect';
  if (d <= w.great) return 'great';
  if (d <= w.good) return 'good';
  return null;
}

export type NoteStatus = 'pending' | 'hit' | 'missed' | 'auto';

export interface NoteState {
  status: NoteStatus;
  grade?: Grade;
  deltaMs?: number;
}

export type PressResult =
  | { kind: 'hit'; note: Note; grade: Exclude<Grade, 'miss'>; deltaMs: number }
  | { kind: 'wrong'; pitch: number };

/**
 * Matches key presses against notes for Performance mode.
 * A press hits the closest pending note of the same pitch inside the Good window.
 * Notes whose Good window has fully passed become misses.
 */
export class Judge {
  readonly states = new Map<number, NoteState>();
  private cursor = 0;

  constructor(
    /** Notes the player is responsible for, sorted by start. */
    private notes: Note[],
    public windows: TimingWindows = DEFAULT_WINDOWS,
  ) {
    for (const n of notes) this.states.set(n.id, { status: 'pending' });
  }

  /** @param songTime song time of the press (latency-corrected), @param rate playback speed */
  press(pitch: number, songTime: number, rate: number): PressResult {
    const goodSong = (this.windows.good / 1000) * rate;
    let best: Note | undefined;
    let bestAbs = Infinity;
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start > songTime + goodSong) break;
      if (n.pitch !== pitch || this.states.get(n.id)!.status !== 'pending') continue;
      const abs = Math.abs(songTime - n.start);
      if (abs <= goodSong && abs < bestAbs) {
        best = n;
        bestAbs = abs;
      }
    }
    if (!best) return { kind: 'wrong', pitch };
    const deltaMs = ((songTime - best.start) / rate) * 1000;
    const grade = gradeFor(deltaMs, this.windows) ?? 'good';
    this.states.set(best.id, { status: 'hit', grade, deltaMs });
    this.advanceCursor();
    return { kind: 'hit', note: best, grade, deltaMs };
  }

  /** Mark notes that can no longer be hit as missed. Returns the newly missed notes. */
  update(songTime: number, rate: number): Note[] {
    const goodSong = (this.windows.good / 1000) * rate;
    const missed: Note[] = [];
    for (let i = this.cursor; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.start + goodSong >= songTime) break;
      const st = this.states.get(n.id)!;
      if (st.status === 'pending') {
        this.states.set(n.id, { status: 'missed', grade: 'miss' });
        missed.push(n);
      }
    }
    this.advanceCursor();
    return missed;
  }

  /** Set a note's state directly (Wait mode judges chords itself). */
  mark(id: number, state: NoteState) {
    this.states.set(id, state);
    this.advanceCursor();
  }

  /** Reset notes starting at or after `fromTime` (and before `toTime`) back to pending, e.g. for loops. */
  reset(fromTime = -Infinity, toTime = Infinity) {
    for (const n of this.notes) {
      if (n.start >= fromTime - 1e-6 && n.start < toTime) this.states.set(n.id, { status: 'pending' });
    }
    this.cursor = 0;
    this.advanceCursor();
  }

  private advanceCursor() {
    while (this.cursor < this.notes.length && this.states.get(this.notes[this.cursor].id)!.status !== 'pending') {
      this.cursor++;
    }
  }
}

// ---------------------------------------------------------------- scoring

export const POINTS: Record<Exclude<Grade, 'miss'>, number> = { perfect: 100, great: 70, good: 40 };
const WEIGHT: Record<Grade, number> = { perfect: 1, great: 0.8, good: 0.5, miss: 0 };

export function multiplierFor(combo: number): number {
  if (combo >= 30) return 4;
  if (combo >= 20) return 3;
  if (combo >= 10) return 2;
  return 1;
}

export function starsFor(accuracy: number): number {
  if (accuracy >= 0.95) return 5;
  if (accuracy >= 0.85) return 4;
  if (accuracy >= 0.7) return 3;
  if (accuracy >= 0.5) return 2;
  if (accuracy > 0) return 1;
  return 0;
}

export interface HandStats {
  perfect: number;
  great: number;
  good: number;
  miss: number;
  wrong: number;
}

const emptyStats = (): HandStats => ({ perfect: 0, great: 0, good: 0, miss: 0, wrong: 0 });

export class Scorer {
  score = 0;
  combo = 0;
  maxCombo = 0;
  readonly byHand: Record<Hand, HandStats> = { L: emptyStats(), R: emptyStats() };
  /** Misses + wrong notes per measure index. */
  readonly measureErrors = new Map<number, number>();

  get multiplier(): number {
    return multiplierFor(this.combo);
  }

  hit(grade: Exclude<Grade, 'miss'>, hand: Hand) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += POINTS[grade] * this.multiplier;
    this.byHand[hand][grade]++;
  }

  miss(hand: Hand, measure: number, breakCombo = true) {
    if (breakCombo) this.combo = 0;
    this.byHand[hand].miss++;
    this.addError(measure);
  }

  wrong(hand: Hand, measure: number, breakCombo = true) {
    if (breakCombo) this.combo = 0;
    this.byHand[hand].wrong++;
    this.addError(measure);
  }

  private addError(measure: number) {
    this.measureErrors.set(measure, (this.measureErrors.get(measure) ?? 0) + 1);
  }

  /**
   * Accuracy for one hand, or both. Wrong notes count against accuracy (half a note each),
   * so mashing keys can't give 100%.
   */
  accuracy(hand?: Hand): number {
    const hands: Hand[] = hand ? [hand] : ['L', 'R'];
    let num = 0;
    let den = 0;
    for (const h of hands) {
      const s = this.byHand[h];
      num += s.perfect * WEIGHT.perfect + s.great * WEIGHT.great + s.good * WEIGHT.good;
      den += s.perfect + s.great + s.good + s.miss + s.wrong * 0.5;
    }
    return den === 0 ? 0 : num / den;
  }

  judged(hand?: Hand): number {
    const hands: Hand[] = hand ? [hand] : ['L', 'R'];
    return hands.reduce((sum, h) => {
      const s = this.byHand[h];
      return sum + s.perfect + s.great + s.good + s.miss;
    }, 0);
  }

  stars(): number {
    return starsFor(this.accuracy());
  }

  worstMeasures(limit = 5): { measure: number; errors: number }[] {
    return [...this.measureErrors.entries()]
      .map(([measure, errors]) => ({ measure, errors }))
      .sort((a, b) => b.errors - a.errors || a.measure - b.measure)
      .slice(0, limit);
  }
}

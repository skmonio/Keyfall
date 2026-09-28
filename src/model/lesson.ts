/**
 * Guided practice: learn a song in small steps.
 *
 * The song is cut into sections of a few bars. For each section: each hand on its own in
 * Wait mode, then both hands in Wait mode, then both hands in time (Performance) at a
 * slower speed, then at full speed. Every two sections are joined up, and the lesson ends
 * with the whole song. A step is passed by reaching its accuracy goal.
 *
 * A one-hand lesson ("right" or "left") keeps to that hand throughout: slowly with the
 * notes waiting, then in time at 70% and at full speed, with the same joins and finale.
 */
import type { GameMode, HandsMode } from '../engine/settings';
import type { Song } from './song';

export interface LessonStep {
  id: string;
  /** Played bar indices (0-based, inclusive). */
  from: number;
  to: number;
  hands: HandsMode;
  mode: GameMode;
  speed: number;
  /** Accuracy needed to pass, 0..1 */
  goal: number;
  kind: 'hand' | 'together' | 'tempo' | 'join' | 'final';
  title: string;
  /** Which group of steps it belongs to (for display). */
  group: string;
}

export type LessonHands = 'both' | 'right' | 'left';

export interface LessonProgress {
  barsPerSection: number;
  /** Which hands the lesson is for. */
  hands?: LessonHands;
  done: string[];
  /** Best accuracy (0..1) reached on each step, passed or not. */
  best?: Record<string, number>;
}

const HAND_NAME: Record<HandsMode, string> = { left: 'Left hand', right: 'Right hand', both: 'Both hands' };

export function planLesson(song: Song, barsPerSection = 4, only: LessonHands = 'both'): LessonStep[] {
  const n = song.measures.length;
  if (!n) return [];
  const has = (from: number, to: number, hand: 'L' | 'R') => song.notes.some((x) => !x.backing && x.hand === hand && x.measure >= from && x.measure <= to);
  const label = (from: number, to: number) => {
    const a = song.measures[from];
    const b = song.measures[to];
    const pass = (m: typeof a) => ((m?.pass ?? 1) > 1 ? `′` : '');
    // Bar 0 is a pickup (an incomplete first bar).
    if (a.number === 0) return from === to ? 'Pickup' : `Pickup–bar ${b.number}${pass(b)}`;
    return from === to ? `Bar ${a.number}${pass(a)}` : `Bars ${a.number}${pass(a)}–${b.number}${pass(b)}`;
  };
  const steps: LessonStep[] = [];
  const sections: [number, number][] = [];
  for (let from = 0; from < n; from += barsPerSection) sections.push([from, Math.min(n - 1, from + barsPerSection - 1)]);
  const wantL = only !== 'right';
  const wantR = only !== 'left';
  // Skip sections with nothing to play (e.g. empty pickup/rest bars, or bars without this hand).
  const playable = sections.filter(([a, b]) => (wantL && has(a, b, 'L')) || (wantR && has(a, b, 'R')));
  const lessonHands: HandsMode = only;

  playable.forEach(([from, to], si) => {
    const group = label(from, to);
    const hasL = wantL && has(from, to, 'L');
    const hasR = wantR && has(from, to, 'R');
    const add = (s: Omit<LessonStep, 'id' | 'from' | 'to' | 'group'>) => steps.push({ ...s, from, to, group, id: `${from}-${to}-${s.kind}-${s.hands}-${s.mode}-${s.speed}` });
    if (hasR) add({ hands: 'right', mode: 'wait', speed: 0.7, goal: 0.9, kind: 'hand', title: `${HAND_NAME.right}, notes wait for you` });
    if (hasL) add({ hands: 'left', mode: 'wait', speed: 0.7, goal: 0.9, kind: 'hand', title: `${HAND_NAME.left}, notes wait for you` });
    // In a two-hand lesson a section with only one hand's notes is played with that hand.
    const hands: HandsMode = only !== 'both' ? only : hasL && hasR ? 'both' : hasR ? 'right' : 'left';
    if (hasL && hasR) add({ hands, mode: 'wait', speed: 0.8, goal: 0.9, kind: 'together', title: 'Both hands together, notes wait for you' });
    add({ hands, mode: 'performance', speed: 0.7, goal: 0.85, kind: 'tempo', title: `${HAND_NAME[hands]} in time, at 70% speed` });
    add({ hands, mode: 'performance', speed: 1, goal: 0.85, kind: 'tempo', title: `${HAND_NAME[hands]} in time, full speed` });
    // Join every pair of sections.
    if (si % 2 === 1) {
      const [pf] = playable[si - 1];
      steps.push({
        id: `${pf}-${to}-join-${lessonHands}`,
        from: pf,
        to,
        hands: lessonHands,
        mode: 'performance',
        speed: 0.85,
        goal: 0.85,
        kind: 'join',
        title: `Join ${label(pf, playable[si - 1][1])} and ${label(from, to)}`,
        group: `Join ${label(pf, to)}`,
      });
    }
  });
  if (playable.length > 1) {
    steps.push({
      id: `final-${lessonHands}`,
      from: 0,
      to: n - 1,
      hands: lessonHands,
      mode: 'performance',
      speed: 1,
      goal: 0.85,
      kind: 'final',
      title: `The whole song${only === 'both' ? '' : `, ${HAND_NAME[only].toLowerCase()}`}, in time, full speed`,
      group: 'Whole song',
    });
  }
  return steps;
}

export function nextStep(steps: LessonStep[], progress: LessonProgress): LessonStep | undefined {
  return steps.find((s) => !progress.done.includes(s.id));
}

export function passed(step: LessonStep, accuracy: number): boolean {
  return accuracy + 1e-9 >= step.goal;
}

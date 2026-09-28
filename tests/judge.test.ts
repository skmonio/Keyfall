import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOWS, gradeFor, Judge, multiplierFor, Scorer, starsFor } from '../src/engine/judge';
import type { Note } from '../src/model/song';

const note = (id: number, pitch: number, start: number, hand: 'L' | 'R' = 'R'): Note => ({
  id,
  pitch,
  start,
  duration: 0.5,
  hand,
  velocity: 80,
  measure: Math.floor(start / 2),
});

describe('gradeFor', () => {
  it('uses the default windows (±40 / ±80 / ±120 ms)', () => {
    expect(gradeFor(0, DEFAULT_WINDOWS)).toBe('perfect');
    expect(gradeFor(40, DEFAULT_WINDOWS)).toBe('perfect');
    expect(gradeFor(-41, DEFAULT_WINDOWS)).toBe('great');
    expect(gradeFor(80, DEFAULT_WINDOWS)).toBe('great');
    expect(gradeFor(-100, DEFAULT_WINDOWS)).toBe('good');
    expect(gradeFor(120, DEFAULT_WINDOWS)).toBe('good');
    expect(gradeFor(121, DEFAULT_WINDOWS)).toBeNull();
  });

  it('respects custom windows', () => {
    expect(gradeFor(50, { perfect: 60, great: 100, good: 200 })).toBe('perfect');
    expect(gradeFor(150, { perfect: 60, great: 100, good: 200 })).toBe('good');
  });
});

describe('Judge', () => {
  it('grades a press against the nearest note of the same pitch', () => {
    const j = new Judge([note(0, 60, 1), note(1, 62, 1.5)]);
    const r = j.press(60, 1.03, 1);
    expect(r.kind).toBe('hit');
    if (r.kind === 'hit') {
      expect(r.note.id).toBe(0);
      expect(r.grade).toBe('perfect');
      expect(r.deltaMs).toBeCloseTo(30);
    }
    expect(j.states.get(0)!.status).toBe('hit');
  });

  it('reports wrong pitch and presses outside the window', () => {
    const j = new Judge([note(0, 60, 1)]);
    expect(j.press(61, 1, 1).kind).toBe('wrong');
    expect(j.press(60, 1.2, 1).kind).toBe('wrong'); // 200ms late
    expect(j.states.get(0)!.status).toBe('pending');
  });

  it('does not hit the same note twice', () => {
    const j = new Judge([note(0, 60, 1)]);
    expect(j.press(60, 1, 1).kind).toBe('hit');
    expect(j.press(60, 1.01, 1).kind).toBe('wrong');
  });

  it('picks the closer of two repeated notes', () => {
    const j = new Judge([note(0, 60, 1), note(1, 60, 1.2)]);
    const r = j.press(60, 1.15, 1);
    expect(r.kind === 'hit' && r.note.id).toBe(1);
  });

  it('marks notes as missed once the Good window has passed', () => {
    const j = new Judge([note(0, 60, 1), note(1, 62, 2)]);
    expect(j.update(1.1, 1)).toHaveLength(0);
    const missed = j.update(1.13, 1);
    expect(missed.map((n) => n.id)).toEqual([0]);
    expect(j.states.get(0)).toEqual({ status: 'missed', grade: 'miss' });
    expect(j.update(1.5, 1)).toHaveLength(0); // not reported twice
  });

  it('scales windows with playback speed (windows are in real time)', () => {
    // At 50% speed, 100ms of song time is 200ms of real time: outside Good.
    const j = new Judge([note(0, 60, 1)]);
    expect(j.press(60, 1.1, 0.5).kind).toBe('wrong');
    // 50ms song time at 50% = 100ms real = good... actually great is 80: so good.
    const r = j.press(60, 1.05, 0.5);
    expect(r.kind === 'hit' && r.grade).toBe('good');
    // At 150% speed, 150ms song time = 100ms real
    const k = new Judge([note(0, 60, 1)]);
    const r2 = k.press(60, 1.15, 1.5);
    expect(r2.kind === 'hit' && r2.grade).toBe('good');
  });

  it('reset() makes a range pending again (for loops)', () => {
    const j = new Judge([note(0, 60, 1), note(1, 62, 3)]);
    j.press(60, 1, 1);
    j.update(5, 1);
    j.reset(0, 2);
    expect(j.states.get(0)!.status).toBe('pending');
    expect(j.states.get(1)!.status).toBe('missed');
    expect(j.press(60, 1, 1).kind).toBe('hit');
  });
});

describe('Scorer', () => {
  it('applies combo multipliers at 10, 20 and 30', () => {
    expect([0, 9, 10, 19, 20, 29, 30, 99].map(multiplierFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    const s = new Scorer();
    for (let i = 0; i < 10; i++) s.hit('perfect', 'R');
    // hits 1-9 at x1 (combo < 10 before increment... combo counts the current hit)
    expect(s.combo).toBe(10);
    expect(s.score).toBe(9 * 100 + 100 * 2);
  });

  it('breaks the combo on a miss or wrong note, unless told not to', () => {
    const s = new Scorer();
    s.hit('great', 'R');
    s.hit('good', 'L');
    s.miss('L', 3);
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(2);
    s.hit('perfect', 'R');
    s.wrong('R', 3, false);
    expect(s.combo).toBe(1);
    expect(s.worstMeasures()).toEqual([{ measure: 3, errors: 2 }]);
  });

  it('computes accuracy per hand, counting wrong notes against it', () => {
    const s = new Scorer();
    s.hit('perfect', 'R');
    s.hit('great', 'R');
    s.miss('L', 0);
    s.hit('good', 'L');
    expect(s.accuracy('R')).toBeCloseTo(0.9);
    expect(s.accuracy('L')).toBeCloseTo(0.25);
    expect(s.accuracy()).toBeCloseTo((1 + 0.8 + 0.5) / 4);
    s.wrong('R', 0);
    expect(s.accuracy('R')).toBeCloseTo(1.8 / 2.5);
  });

  it('gives star ratings from accuracy', () => {
    expect([1, 0.95, 0.9, 0.75, 0.6, 0.2, 0].map(starsFor)).toEqual([5, 5, 4, 3, 2, 1, 0]);
  });
});

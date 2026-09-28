import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '../src/importers/musicxml';
import { nextStep, passed, planLesson } from '../src/model/lesson';

const ode = () => parseMusicXml(readFileSync('public/songs/ode-to-joy.musicxml', 'utf8'));

describe('guided practice plan', () => {
  it('builds hand, together, tempo and join steps for each section', () => {
    const steps = planLesson(ode(), 4); // 16 bars -> 4 sections
    const first = steps.filter((s) => s.from === 0 && s.to === 3).map((s) => `${s.hands}/${s.mode}/${s.speed}`);
    expect(first).toEqual(['right/wait/0.7', 'left/wait/0.7', 'both/wait/0.8', 'both/performance/0.7', 'both/performance/1']);
    expect(steps.filter((s) => s.kind === 'join').map((s) => [s.from, s.to])).toEqual([
      [0, 7],
      [8, 15],
    ]);
    expect(steps[steps.length - 1]).toMatchObject({ kind: 'final', from: 0, to: 15, speed: 1 });
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length); // ids are unique
    expect(steps[0].group).toBe('Bars 1–4');
  });

  it('skips a hand that has no notes in a section', () => {
    const song = ode();
    song.notes = song.notes.filter((n) => !(n.hand === 'L' && n.measure < 4));
    const first = planLesson(song, 4).filter((s) => s.from === 0 && s.to === 3);
    expect(first.map((s) => s.hands)).toEqual(['right', 'right', 'right']);
  });

  it('moves on to the first step not yet done, and checks goals', () => {
    const steps = planLesson(ode(), 8);
    expect(nextStep(steps, { barsPerSection: 8, done: [] })).toBe(steps[0]);
    expect(nextStep(steps, { barsPerSection: 8, done: [steps[0].id, steps[1].id] })).toBe(steps[2]);
    expect(nextStep(steps, { barsPerSection: 8, done: steps.map((s) => s.id) })).toBeUndefined();
    expect(passed(steps[0], 0.9)).toBe(true);
    expect(passed(steps[0], 0.89)).toBe(false);
  });
});

describe('one-hand lessons', () => {
  it('keeps to one hand throughout', () => {
    const steps = planLesson(ode(), 4, 'right');
    expect(steps.every((s) => s.hands === 'right')).toBe(true);
    expect(steps.filter((s) => s.from === 0 && s.to === 3).map((s) => `${s.mode}/${s.speed}`)).toEqual(['wait/0.7', 'performance/0.7', 'performance/1']);
    expect(steps[steps.length - 1].title).toContain('right hand');
    // Different ids from the two-hand lesson, so progress is kept separately.
    const both = new Set(planLesson(ode(), 4, 'both').map((s) => s.id));
    expect(steps.filter((s) => both.has(s.id)).length).toBe(steps.filter((s) => s.kind === 'hand').length);
  });
});

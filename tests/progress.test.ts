import { describe, expect, it } from 'vitest';
import { barHeat } from '../src/model/progress';
import type { SessionResults } from '../src/engine/session';


describe('progress', () => {
  it('works out error rates per bar over recent runs', () => {
    const run = (date: number, stats: [number, number, number][]) =>
      ({ date, barStats: stats.map(([bar, notes, errors]) => ({ bar, notes, errors })) }) as unknown as SessionResults;
    const heat = barHeat([run(1, [[1, 4, 0], [2, 4, 2]]), run(2, [[1, 4, 1], [2, 4, 2]]), run(3, [[1, 4, 0]])], 2);
    // Only the 2 most recent runs (dates 3 and 2)
    expect(heat).toEqual([
      { bar: 1, notes: 8, errors: 1, rate: 1 / 8, runs: 2 },
      { bar: 2, notes: 4, errors: 2, rate: 0.5, runs: 1 },
    ]);
  });
});

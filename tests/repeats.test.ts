import { describe, expect, it } from 'vitest';
import { playbackOrder, type BarRepeatInfo } from '../src/importers/repeats';

const bars = (n: number, marks: Record<number, BarRepeatInfo> = {}): BarRepeatInfo[] => Array.from({ length: n }, (_, i) => marks[i] ?? {});
// Bar numbers (1-based) make the expectations readable.
const order = (info: BarRepeatInfo[]) => playbackOrder(info).map((i) => i + 1);

describe('playbackOrder', () => {
  it('plays straight through without repeats', () => {
    expect(order(bars(4))).toEqual([1, 2, 3, 4]);
  });

  it('repeats back to the start when there is no forward repeat', () => {
    expect(order(bars(4, { 1: { backward: 2 } }))).toEqual([1, 2, 1, 2, 3, 4]);
  });

  it('repeats between forward and backward barlines', () => {
    expect(order(bars(5, { 1: { forward: true }, 2: { backward: 2 } }))).toEqual([1, 2, 3, 2, 3, 4, 5]);
  });

  it('honours times="3"', () => {
    expect(order(bars(3, { 0: { forward: true }, 1: { backward: 3 } }))).toEqual([1, 2, 1, 2, 1, 2, 3]);
  });

  it('takes 1st and 2nd endings', () => {
    // | 1 | 2 | [1. 3 :| [2. 4 | 5 |
    expect(order(bars(5, { 2: { ending: [1], backward: 2 }, 3: { ending: [2] } }))).toEqual([1, 2, 3, 1, 2, 4, 5]);
  });

  it('handles multi-bar endings and "1, 2" endings with a third time', () => {
    // |: 1 | [1.2. 2 :| [3. 3 | 4 |   (times = 3)
    expect(order(bars(4, { 0: { forward: true }, 1: { ending: [1, 2], backward: 3 }, 2: { ending: [3] } }))).toEqual([1, 2, 1, 2, 1, 3, 4]);
    // |: 1 | [1. 2 | 3 :| [2. 4 | 5 |
    expect(order(bars(5, { 0: { forward: true }, 1: { ending: [1] }, 2: { ending: [1], backward: 2 }, 3: { ending: [2] } }))).toEqual([1, 2, 3, 1, 4, 5]);
  });

  it('plays two repeat sections one after the other', () => {
    // |: 1 :|: 2 :| 3
    expect(order(bars(3, { 0: { forward: true, backward: 2 }, 1: { forward: true, backward: 2 } }))).toEqual([1, 1, 2, 2, 3]);
    // | 1 :| 2 :| 3   (second section has no forward repeat: goes back to bar 2)
    expect(order(bars(3, { 0: { backward: 2 }, 1: { backward: 2 } }))).toEqual([1, 1, 2, 2, 3]);
  });

  it('D.C. al Fine: back to the start, no repeats, stop at Fine', () => {
    // | 1 :| 2 Fine | 3 | 4 D.C. |
    expect(order(bars(4, { 0: { backward: 2 }, 1: { fine: true }, 3: { dacapo: true } }))).toEqual([1, 1, 2, 3, 4, 1, 2]);
  });

  it('D.S. al Coda: back to the segno, then jump to the coda', () => {
    // | 1 | 2 segno | 3 To Coda | 4 D.S. | 5 coda | 6 |
    const info = bars(6, { 1: { segno: 'segno' }, 2: { tocoda: 'coda' }, 3: { dalsegno: 'segno' }, 4: { coda: 'coda' } });
    expect(order(info)).toEqual([1, 2, 3, 4, 2, 3, 5, 6]);
  });

  it('after a D.C., voltas play the last ending', () => {
    // | 1 | [1. 2 :| [2. 3 | 4 D.C. al Fine (Fine at 3) |
    const info = bars(4, { 1: { ending: [1], backward: 2 }, 2: { ending: [2], fine: true }, 3: { dacapo: true } });
    expect(order(info)).toEqual([1, 2, 1, 3, 4, 1, 3]);
  });
});

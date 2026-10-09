import { describe, expect, it } from 'vitest';
import { handOptions, songHands, usableHands } from '../src/ui/help';

const song = (hands: ('L' | 'R')[], backing: ('L' | 'R')[] = []) => ({
  notes: [
    ...hands.map((hand, i) => ({ id: i, pitch: 60, start: i, duration: 1, hand, velocity: 80, measure: 0 })),
    ...backing.map((hand, i) => ({ id: 100 + i, pitch: 40, start: i, duration: 1, hand, velocity: 80, measure: 0, backing: true })),
  ],
});

describe('hands a song actually has', () => {
  it('ignores backing parts', () => {
    expect(songHands(song(['R', 'R'], ['L']))).toEqual({ L: false, R: true });
    expect(songHands(song(['R', 'L']))).toEqual({ L: true, R: true });
  });
  it('falls back to the hand the song has', () => {
    const rightOnly = { L: false, R: true };
    expect(usableHands('left', rightOnly)).toBe('right');
    expect(usableHands('both', rightOnly)).toBe('right');
    expect(usableHands('both', { L: true, R: false })).toBe('left');
    expect(usableHands('left', { L: true, R: true })).toBe('left');
  });
  it('disables the buttons for missing hands', () => {
    const opts = handOptions({ L: false, R: true });
    expect(opts.map(([h, , o]) => [h, o.disabled])).toEqual([
      ['left', true],
      ['both', true],
      ['right', false],
    ]);
    expect(opts[0][2].title).toMatch(/no left-hand part/);
  });
});

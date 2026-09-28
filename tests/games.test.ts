import { describe, expect, it } from 'vitest';
import { finderPool, isCorrect, pick, questionXml, readerPool } from '../src/games/notes';
import { parseMusicXml } from '../src/importers/musicxml';
import { pitchName } from '../src/model/song';

describe('note games', () => {
  it('level 1 asks the five notes around middle C for each hand', () => {
    expect(readerPool(1, 'treble').map((q) => pitchName(q.pitch))).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
    expect(readerPool(1, 'bass').map((q) => pitchName(q.pitch))).toEqual(['C3', 'D3', 'E3', 'F3', 'G3']);
    expect(readerPool(1, 'both')).toHaveLength(10);
  });

  it('level 2 covers every line and space; level 4 adds sharps and flats', () => {
    expect(readerPool(2, 'treble').map((q) => pitchName(q.pitch))).toEqual(['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5']);
    const l4 = readerPool(4, 'treble');
    expect(l4.some((q) => q.spelled.alter === 1)).toBe(true);
    expect(l4.some((q) => q.spelled.alter === -1)).toBe(true);
    const bflat = l4.find((q) => q.spelled.step === 'B' && q.spelled.alter === -1 && q.spelled.octave === 4)!;
    expect(bflat.pitch).toBe(70);
  });

  it('never asks the same note twice in a row', () => {
    const pool = readerPool(1, 'treble');
    let last = pool[0];
    for (let i = 0; i < 50; i++) {
      const q = pick(pool, last);
      expect(q.pitch).not.toBe(last.pitch);
      last = q;
    }
  });

  it('checks answers exactly, or in any octave', () => {
    expect(isCorrect(60, 60, false)).toBe(true);
    expect(isCorrect(60, 72, false)).toBe(false);
    expect(isCorrect(60, 72, true)).toBe(true);
    expect(isCorrect(61, 49, true)).toBe(true);
    expect(isCorrect(61, 62, true)).toBe(false);
  });

  it('Key Finder has 7 natural names, or 17 with sharps and flats', () => {
    expect(finderPool(false)).toHaveLength(7);
    expect(finderPool(true)).toHaveLength(17);
  });

  it('draws each question as valid MusicXML', () => {
    for (const q of readerPool(4, 'both')) {
      expect(parseMusicXml(questionXml(q)).notes.map((n) => n.pitch)).toEqual([q.pitch]);
    }
  });
});

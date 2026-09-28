import { describe, expect, it } from 'vitest';
import { EXERCISES, makeExercise } from '../src/content/exercises';
import { generateMusicXml } from '../src/importers/notation';
import { parseMusicXml } from '../src/importers/musicxml';
import { pitchName } from '../src/model/song';

const names = (id: string, hand: 'L' | 'R') =>
  makeExercise(id)
    .notes.filter((n) => n.hand === hand)
    .map((n) => pitchName(n.pitch))
    .join(' ');

describe('built-in exercises', () => {
  it('every exercise builds, fills whole bars, and makes a readable score', () => {
    for (const e of EXERCISES) {
      const song = makeExercise(e.id);
      expect(song.notes.length).toBeGreaterThan(4);
      expect(song.notes.every((n) => n.finger && n.fingerSource === 'score')).toBe(true);
      const back = parseMusicXml(generateMusicXml(song));
      expect(back.notes.length).toBe(song.notes.length);
    }
  });

  it('writes scales with the right notes and fingers', () => {
    expect(names('scale-G', 'R')).toBe('G4 A4 B4 C5 D5 E5 F#5 G5 F#5 E5 D5 C5 B4 A4 G4');
    expect(names('scale-F', 'R')).toBe('F4 G4 A4 A#4 C5 D5 E5 F5 E5 D5 C5 A#4 A4 G4 F4');
    expect(makeExercise('scale-C').notes.filter((n) => n.hand === 'R').map((n) => n.finger)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]);
    expect(names('minor-A', 'L')).toBe('A3 B3 C4 D4 E4 F4 G4 A4 G4 F4 E4 D4 C4 B3 A3');
  });

  it('writes chord progressions as three-note chords over a bass', () => {
    const song = makeExercise('prog-C');
    expect(song.notes.filter((n) => n.hand === 'R')).toHaveLength(12);
    expect(song.measures).toHaveLength(4);
    expect(names('prog-C', 'L')).toBe('C3 F3 G3 C3');
  });

  it('uses the key signature of the scale in the generated score', () => {
    expect(generateMusicXml(makeExercise('scale-D'))).toContain('<fifths>2</fifths>');
    expect(generateMusicXml(makeExercise('scale-F'))).toContain('<fifths>-1</fifths>');
  });
});

describe('more exercises', () => {
  it('fill whole bars exactly', () => {
    for (const e of EXERCISES) {
      const song = makeExercise(e.id);
      const beats = song.measures.reduce((s, m) => s + m.beats, 0);
      const lastEnd = Math.max(...song.notes.map((n) => n.start + n.duration / 0.95));
      expect(lastEnd * (song.tempos[0].bpm / 60)).toBeCloseTo(beats, 5);
    }
  });

  it('uses the standard fingerings for black-key scales', () => {
    expect(names('scale-Db', 'R')).toBe('C#4 D#4 F4 F#4 G#4 A#4 C5 C#5 C5 A#4 G#4 F#4 F4 D#4 C#4');
    expect(makeExercise('scale-Db').notes.filter((n) => n.hand === 'R').slice(0, 8).map((n) => n.finger)).toEqual([2, 3, 1, 2, 3, 4, 1, 2]);
    expect(makeExercise('scale-B').notes.filter((n) => n.hand === 'L').slice(0, 8).map((n) => n.finger)).toEqual([4, 3, 2, 1, 4, 3, 2, 1]);
  });

  it('melodic minor goes up raised and comes down natural', () => {
    expect(names('mel-A', 'R')).toBe('A4 B4 C5 D5 E5 F#5 G#5 A5 G5 F5 E5 D5 C5 B4 A4');
  });

  it('contrary motion starts both thumbs on middle C and moves apart', () => {
    expect(names('contrary-C', 'L').split(' ').slice(0, 8).join(' ')).toBe('C4 B3 A3 G3 F3 E3 D3 C3');
    expect(names('contrary-C', 'R').split(' ').slice(0, 8).join(' ')).toBe('C4 D4 E4 F4 G4 A4 B4 C5');
  });

  it('12-bar blues has twelve bars and a boogie bass', () => {
    const song = makeExercise('blues-C');
    expect(song.measures).toHaveLength(12);
    expect(names('blues-C', 'L').split(' ').slice(0, 4).join(' ')).toBe('C3 G3 A3 G3');
  });

  it('Hanon No. 1 climbs one step per group', () => {
    expect(names('hanon-1', 'R').split(' ').slice(0, 16).join(' ')).toBe('C4 E4 F4 G4 A4 G4 F4 E4 D4 F4 G4 A4 B4 A4 G4 F4');
  });
});

import { describe, expect, it } from 'vitest';
import { cleanNotes, estimateTempo, measuresFor, songFromTranscription, type RawNote } from '../src/importers/audio';
import { detectKind } from '../src/importers';

const beatNotes = (bpm: number, count: number, offset = 0, jitter = 0): RawNote[] =>
  Array.from({ length: count }, (_, i) => ({
    pitch: 60 + (i % 8),
    start: offset + (i * 60) / bpm + (i % 3 === 0 ? jitter : -jitter),
    duration: 0.3,
    amplitude: 0.6,
  }));

describe('audio import', () => {
  it('recognises audio files', () => {
    expect(detectKind('song.mp3')).toBe('audio');
    expect(detectKind('Take 1.M4A')).toBe('audio');
    expect(detectKind('x.wav')).toBe('audio');
  });

  it('estimates tempo and the first beat from onsets', () => {
    for (const bpm of [72, 100, 132]) {
      const est = estimateTempo(beatNotes(bpm, 40, 0.8, 0.01).map((n) => n.start));
      expect(Math.abs(est.bpm - bpm)).toBeLessThanOrEqual(1.5);
      // first beat lands on (or a whole number of beats before) the first note
      const beat = 60 / est.bpm;
      const off = (0.79 - est.phase) / beat;
      expect(Math.abs(off - Math.round(off))).toBeLessThan(0.15);
    }
  });

  it('finds the beat in a melody with eighth notes', () => {
    // 90 bpm, alternating quarter and two eighths
    const ons: number[] = [];
    let t = 0.5;
    for (let i = 0; i < 24; i++) {
      ons.push(t);
      if (i % 2) {
        ons.push(t + 60 / 90 / 2);
      }
      t += 60 / 90;
    }
    expect(Math.abs(estimateTempo(ons).bpm - 90)).toBeLessThanOrEqual(1.5);
  });

  it('builds bars, with a pickup bar when the music starts late', () => {
    const m = measuresFor(10, 120, 0.5, 4);
    expect(m[0]).toMatchObject({ start: 0, duration: 0.5, number: 0 });
    expect(m[1]).toMatchObject({ start: 0.5, duration: 2, number: 1 });
    expect(m[m.length - 1].start).toBeLessThan(10);
  });

  it('drops noise: very short, very quiet and off-piano notes', () => {
    const notes: RawNote[] = [
      ...beatNotes(100, 20),
      { pitch: 64, start: 1, duration: 0.02, amplitude: 0.9 },
      { pitch: 15, start: 2, duration: 0.5, amplitude: 0.9 },
      { pitch: 70, start: 3, duration: 0.5, amplitude: 0.01 },
    ];
    const clean = cleanNotes(notes);
    expect(clean).toHaveLength(20);
  });

  it('makes a playable song with hands split at the chosen note', () => {
    const raw = [...beatNotes(100, 16, 0.4), { pitch: 45, start: 0.4, duration: 1, amplitude: 0.5 }];
    const song = songFromTranscription(raw, 12, { title: 'Take', split: 62 });
    expect(song.sourceKind).toBe('audio');
    expect(song.notes.find((n) => n.pitch === 45)!.hand).toBe('L');
    expect(song.notes.find((n) => n.pitch === 61)!.hand).toBe('L');
    expect(song.notes.find((n) => n.pitch === 64)!.hand).toBe('R');
    expect(Math.abs(song.tempos[0].bpm - 100)).toBeLessThanOrEqual(1.5);
    // notes keep their real times from the recording
    expect(song.notes[0].start).toBeCloseTo(0.4);
    expect(() => songFromTranscription([], 5, { title: 'x' })).toThrow(/Hardly any notes/);
  });
});

describe('octave echo removal', () => {
  it('drops quiet ghosts an octave above a louder note, keeps real octaves', async () => {
    const { removeOctaveEchoes } = await import('../src/importers/audio');
    const notes: RawNote[] = [
      { pitch: 64, start: 1, duration: 0.5, amplitude: 0.8 },
      { pitch: 76, start: 1.02, duration: 0.4, amplitude: 0.4 }, // ghost
      { pitch: 48, start: 2, duration: 1, amplitude: 0.7 },
      { pitch: 60, start: 2, duration: 1, amplitude: 0.68 }, // played octave, similar loudness
      { pitch: 72, start: 3, duration: 0.5, amplitude: 0.3 }, // no lower partner: kept
    ];
    expect(removeOctaveEchoes(notes).map((n) => n.pitch)).toEqual([64, 48, 60, 72]);
  });
});

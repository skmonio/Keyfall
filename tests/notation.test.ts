import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMidi } from '../src/importers/midi';
import { parseMusicXml } from '../src/importers/musicxml';
import { estimateFifths, generateMusicXml, spell, splitDuration } from '../src/importers/notation';
import { quarterToSec, secToQuarter } from '../src/model/time';
import type { Song } from '../src/model/song';

const sig = (s: Song) => s.notes.map((n) => `${n.pitch}@${secToQuarter(s, n.start).toFixed(2)}${n.hand}`).sort();

describe('time conversion', () => {
  it('converts seconds <-> quarters through tempo changes', () => {
    const song = { tempos: [{ time: 0, bpm: 60 }, { time: 2, bpm: 120 }] };
    expect(secToQuarter(song, 1)).toBeCloseTo(1);
    expect(secToQuarter(song, 3)).toBeCloseTo(4);
    expect(quarterToSec(song, 4)).toBeCloseTo(3);
    expect(quarterToSec(song, secToQuarter(song, 5.3))).toBeCloseTo(5.3);
  });
});

describe('notation generation', () => {
  it('estimates key signatures', () => {
    const scale = (root: number, steps: number[]) => steps.map((s) => ({ pitch: root + s, duration: 1 }));
    const major = [0, 2, 4, 5, 7, 9, 11, 12, 7, 4, 0, 0];
    expect(estimateFifths(scale(60, major))).toBe(0); // C
    expect(estimateFifths(scale(67, major))).toBe(1); // G
    expect(estimateFifths(scale(65, major))).toBe(-1); // F
    expect(estimateFifths(scale(62, major))).toBe(2); // D
  });

  it('spells accidentals to suit the key', () => {
    expect(spell(66, 1)).toEqual({ step: 'F', alter: 1, octave: 4 });
    expect(spell(70, -1)).toEqual({ step: 'B', alter: -1, octave: 4 });
    expect(spell(60, 0)).toEqual({ step: 'C', alter: 0, octave: 4 });
  });

  it('splits durations into written values', () => {
    expect(splitDuration(0, 16)).toEqual([16]);
    expect(splitDuration(0, 6)).toEqual([6]);
    expect(splitDuration(0, 5)).toEqual([4, 1]);
    expect(splitDuration(2, 4)).toEqual([2, 2]); // off-beat quarter: two tied eighths
  });

  it('round-trips the Twinkle MIDI file through generated MusicXML', () => {
    const song = parseMidi(new Uint8Array(readFileSync('public/songs/twinkle.mid')));
    const xml = generateMusicXml(song);
    const back = parseMusicXml(xml);
    expect(back.measures).toHaveLength(song.measures.length);
    expect(sig(back)).toEqual(sig(song));
  });

  it('round-trips Minuet in G (3/4, F sharps) with the right key', () => {
    const song = parseMusicXml(readFileSync('public/songs/minuet-in-g.musicxml', 'utf8'));
    const xml = generateMusicXml(song);
    expect(xml).toContain('<fifths>1</fifths>');
    const back = parseMusicXml(xml);
    expect(sig(back)).toEqual(sig(song));
  });

  it('ties notes held across a barline', () => {
    const song = parseMidi(new Uint8Array(readFileSync('public/songs/twinkle.mid')));
    // Stretch one note over the barline (bar 1 → 2).
    const n = song.notes.find((x) => x.hand === 'R' && secToQuarter(song, x.start) > 2.9 && secToQuarter(song, x.start) < 3.1)!;
    n.duration = quarterToSec(song, 2);
    song.notes = song.notes.filter((x) => !(x.hand === 'R' && secToQuarter(song, x.start) >= 3.9 && secToQuarter(song, x.start) < 4.1));
    const back = parseMusicXml(generateMusicXml(song));
    const tied = back.notes.find((x) => x.pitch === n.pitch && Math.abs(secToQuarter(back, x.start) - 3) < 0.01)!;
    expect(secToQuarter(back, tied.start + tied.duration) - 3).toBeCloseTo(2, 1);
  });
});

describe('notation: legato snapping', () => {
  it('writes a slightly short whole note as a whole note, not a tied value plus a rest', () => {
    const song = parseMidi(new Uint8Array(readFileSync('public/songs/twinkle.mid')));
    const xml = generateMusicXml(song);
    // Bar 1, bass: the C3 whole note (played 5% short in the MIDI file)
    const bar1 = xml.split('<measure number="1"')[1].split('</measure>')[0];
    const bass = bar1.split('<backup>')[1];
    expect(bass).toContain('<type>whole</type>');
    expect(bass).not.toContain('<rest/>');
  });
});

describe('key signature description', () => {
  it('explains the key in plain words', async () => {
    const { describeKey } = await import('../src/render/sheet');
    expect(describeKey(0)).toMatch(/No sharps or flats/);
    expect(describeKey(1)).toBe('Key signature: 1 sharp (F♯). Every F is played sharp unless marked ♮.');
    expect(describeKey(-4)).toBe('Key signature: 4 flats (B♭ E♭ A♭ D♭). Every B, E, A and D is played flat unless marked ♮.');
  });
});

describe('written positions with repeats', () => {
  it('maps the second time through a repeat back onto the written bars', async () => {
    const { writtenQuarter } = await import('../src/model/time');
    const at = (step: string) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration></note>`;
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">
      <measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>${at('C')}</measure>
      <measure number="2">${at('D')}<barline location="right"><repeat direction="backward"/></barline></measure>
      <measure number="3">${at('E')}</measure></part></score-partwise>`;
    const song = parseMusicXml(xml);
    // Played: C D C D E at 0,2,4,6,8s. Written positions: 0,4,0,4,8 quarters.
    expect(song.notes.map((n) => writtenQuarter(song, n.start))).toEqual([0, 4, 0, 4, 8]);
    expect(writtenQuarter(song, 5)).toBeCloseTo(2); // halfway through the replayed bar 1
  });
});

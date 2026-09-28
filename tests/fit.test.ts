import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '../src/importers/musicxml';
import { applyFit, KEYBOARDS, lumiOctaveFor, planFit, resolveKeyboard, windowStarts } from '../src/model/fit';
import { octaveCommand } from '../src/midi/lumiLights';
import type { Hand, Note } from '../src/model/song';

const minuet = () => parseMusicXml(readFileSync('public/songs/minuet-in-g.musicxml', 'utf8'));
const set = (...h: Hand[]) => new Set<Hand>(h);
const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const note = (id: number, pitch: number, start: number, hand: Hand, duration = 0.5): Note => ({ id, pitch, start, duration, hand, velocity: 80, measure: 0 });

describe('keyboard specs', () => {
  it('auto picks a LUMI when one is connected', () => {
    expect(resolveKeyboard('auto', true).keys).toBe(24);
    expect(resolveKeyboard('auto', false).keys).toBe(88);
    expect(resolveKeyboard('keys61', true).keys).toBe(61);
  });

  it('LUMI positions follow its octave buttons (C3 + 12 × octave, −4..+5)', () => {
    const starts = windowStarts(KEYBOARDS.lumi1);
    expect(starts[0]).toBe(0);
    expect(starts).toContain(48);
    expect(starts[starts.length - 1]).toBe(108);
    expect(lumiOctaveFor(48)).toBe(0);
    expect(lumiOctaveFor(60)).toBe(1);
    expect(lumiOctaveFor(36)).toBe(-1);
  });

  it('encodes the LUMI octave SysEx like the documented examples', () => {
    expect(hex(octaveCommand(0))).toBe('10 40 00 00 00 00 00 00');
    expect(hex(octaveCommand(1))).toBe('10 40 20 00 00 00 00 00');
    expect(hex(octaveCommand(2))).toBe('10 40 40 00 00 00 00 00');
    expect(hex(octaveCommand(4))).toBe('10 40 00 01 00 00 00 00');
    expect(hex(octaveCommand(5))).toBe('10 40 20 01 00 00 00 00');
    expect(hex(octaveCommand(-1))).toBe('10 40 60 7F 7F 7F 7F 03');
    expect(hex(octaveCommand(-4))).toBe('10 40 00 7F 7F 7F 7F 03');
    expect(hex(octaveCommand(9))).toBe(hex(octaveCommand(5))); // clamped
  });
});

describe('planFit / applyFit', () => {
  it('leaves a song alone on a full keyboard', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('L', 'R'), KEYBOARDS.keys88);
    expect(plan.fitsAsWritten).toBe(true);
    expect(plan.lo).toBe(21);
  });

  it('places the Minuet right hand on a LUMI as written (octave +1)', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('R'), KEYBOARDS.lumi1);
    expect(plan.fitsAsWritten).toBe(true);
    expect([plan.lo, plan.hi]).toEqual([60, 83]); // C4–B5
    expect(plan.lumiOctave).toBe(1);
  });

  it('fits the Minuet left hand by folding only its lowest note', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('L'), KEYBOARDS.lumi1);
    expect(plan.lo).toBe(48); // C3–B4, the LUMI's default octave
    expect(plan.shift.L).toBe(0);
    expect(plan.folded).toBe(1); // the final G2
  });

  it('squeezes both hands of the Minuet onto one LUMI with every note in range', () => {
    const song = minuet();
    const hands = set('L', 'R');
    const plan = planFit(song.notes, hands, KEYBOARDS.lumi1);
    expect(plan.fitsAsWritten).toBe(false);
    expect(plan.handFits.R).toBe(true);
    expect(plan.shift.R).toBe(0); // melody stays where it's written
    const fitted = applyFit(song, plan, hands);
    for (const n of fitted.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(plan.lo);
      expect(n.pitch).toBeLessThanOrEqual(plan.hi);
    }
    // Moved notes remember their written pitch for the backing track.
    expect(fitted.notes.some((n) => n.origPitch !== undefined)).toBe(true);
    // The original song is untouched.
    expect(Math.min(...song.notes.map((n) => n.pitch))).toBe(43);
  });

  it('fits both hands of the Minuet on two chained LUMIs without folding', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('L', 'R'), KEYBOARDS.lumi2);
    expect(plan.fitsAsWritten).toBe(true);
    expect(plan.lo).toBe(36);
  });

  it('only moves the practised hand; the other hand keeps its pitches', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('L'), KEYBOARDS.lumi1);
    const fitted = applyFit(song, plan, set('L'));
    const rh = (s: typeof song) => s.notes.filter((n) => n.hand === 'R').map((n) => n.pitch);
    expect(rh(fitted)).toEqual(rh(song));
  });

  it('merges notes that land on the same key at the same time', () => {
    const song = {
      ...minuet(),
      notes: [note(0, 67, 0, 'R', 1), note(1, 55, 0, 'L', 1), note(2, 69, 0.5, 'R')],
    };
    // Force LH up an octave onto the RH's G4.
    const plan = { ...planFit(song.notes, set('L', 'R'), KEYBOARDS.lumi1, 60), shift: { L: 12, R: 0 } };
    const fitted = applyFit(song, plan, set('L', 'R'));
    expect(fitted.notes.filter((n) => n.pitch === 67)).toHaveLength(1);
    expect(fitted.notes.find((n) => n.pitch === 67)!.hand).toBe('R');
  });

  it('respects a manual keyboard position', () => {
    const song = minuet();
    const plan = planFit(song.notes, set('R'), KEYBOARDS.lumi1, 72);
    expect(plan.manual).toBe(true);
    expect([plan.lo, plan.hi]).toEqual([72, 95]);
    const fitted = applyFit(song, plan, set('R'));
    expect(Math.min(...fitted.notes.filter((n) => n.hand === 'R').map((n) => n.pitch))).toBeGreaterThanOrEqual(72);
  });
});

describe('detectPosition', () => {
  it('works out where a LUMI really is from a key it sent', async () => {
    const { detectPosition } = await import('../src/model/fit');
    // We assumed C4–B5 (60), but the player pressed B3 → the LUMI is at C3–B4.
    expect(detectPosition(59, KEYBOARDS.lumi1, 60)).toBe(48);
    // Pressed C6 → the LUMI is one octave higher than assumed.
    expect(detectPosition(84, KEYBOARDS.lumi1, 60)).toBe(72);
    // Inside the assumed range: nothing to change.
    expect(detectPosition(67, KEYBOARDS.lumi1, 60)).toBeUndefined();
    // Full keyboards never move.
    expect(detectPosition(30, KEYBOARDS.keys88, 21)).toBeUndefined();
  });
});

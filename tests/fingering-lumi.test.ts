import { describe, expect, it } from 'vitest';
import { estimateFingering } from '../src/model/fingering';
import type { Note } from '../src/model/song';
import {
  brightnessCommand,
  buildSysex,
  checksum,
  colorCommand,
  colorModeCommand,
  hexToRgb,
  LumiLights,
  nearestPaletteVelocity,
} from '../src/midi/lumiLights';
import { layoutKeyboard, visibleRange } from '../src/render/keyboard';
import { parseMidiMessage } from '../src/midi/input';

const seq = (pitches: number[], hand: 'L' | 'R' = 'R', step = 0.5): Note[] =>
  pitches.map((p, i) => ({ id: i, pitch: p, start: i * step, duration: step, hand, velocity: 80, measure: 0 }));

describe('fingering estimation', () => {
  it('fingers a C major five-finger pattern 1-2-3-4-5 in the right hand', () => {
    const notes = seq([60, 62, 64, 65, 67]);
    estimateFingering(notes);
    expect(notes.map((n) => n.finger)).toEqual([1, 2, 3, 4, 5]);
    expect(notes.every((n) => n.fingerSource === 'auto')).toBe(true);
  });

  it('mirrors for the left hand (5-4-3-2-1 going up)', () => {
    const notes = seq([48, 50, 52, 53, 55], 'L');
    estimateFingering(notes);
    expect(notes.map((n) => n.finger)).toEqual([5, 4, 3, 2, 1]);
  });

  it('uses a thumb crossing for a one-octave scale instead of reusing fingers', () => {
    const notes = seq([60, 62, 64, 65, 67, 69, 71, 72], 'R', 0.25);
    estimateFingering(notes);
    const f = notes.map((n) => n.finger!);
    // Never the same finger on consecutive different keys
    for (let i = 1; i < f.length; i++) expect(f[i]).not.toBe(f[i - 1]);
    // Thumb has to come back at some point in a scale
    expect(f.slice(1).includes(1)).toBe(true);
    expect(f.every((x) => x >= 1 && x <= 5)).toBe(true);
  });

  it('keeps score fingering and gives chords distinct fingers', () => {
    const notes: Note[] = [
      { id: 0, pitch: 60, start: 0, duration: 1, hand: 'R', velocity: 80, measure: 0, finger: 2, fingerSource: 'score' },
      { id: 1, pitch: 64, start: 1, duration: 1, hand: 'R', velocity: 80, measure: 0 },
      { id: 2, pitch: 67, start: 1, duration: 1, hand: 'R', velocity: 80, measure: 0 },
      { id: 3, pitch: 72, start: 1, duration: 1, hand: 'R', velocity: 80, measure: 0 },
    ];
    estimateFingering(notes);
    expect(notes[0].finger).toBe(2);
    expect(notes[0].fingerSource).toBe('score');
    const chord = notes.slice(1).map((n) => n.finger!);
    expect(new Set(chord).size).toBe(3);
    expect([...chord].sort()).toEqual(chord); // ascending in RH
  });
});

describe('LUMI SysEx encoding (matches benob/LUMI-lights SYSEX.txt)', () => {
  const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  it('encodes key colours exactly like the documented examples', () => {
    expect(hex(colorCommand(0, [0, 0, 255]))).toBe('10 20 64 3F 00 00 7E 03'); // blue
    expect(hex(colorCommand(0, [0, 255, 0]))).toBe('10 20 04 40 7F 00 7E 03'); // green
    expect(hex(colorCommand(0, [255, 0, 0]))).toBe('10 20 04 00 00 7F 7F 03'); // red
    expect(hex(colorCommand(0, [255, 255, 0]))).toBe('10 20 04 40 7F 7F 7F 03'); // yellow
    expect(hex(colorCommand(1, [0, 0, 255])).startsWith('10 30')).toBe(true); // root colour
  });

  it('encodes brightness and colour modes like the documented examples', () => {
    expect(hex(brightnessCommand(0))).toBe('10 40 04 00 00 00 00 00');
    expect(hex(brightnessCommand(100))).toBe('10 40 04 19 00 00 00 00');
    expect(hex(colorModeCommand('rainbow'))).toBe('10 40 02 00 00 00 00 00');
    expect(hex(colorModeCommand('piano'))).toBe('10 40 42 00 00 00 00 00');
    expect(hex(colorModeCommand('night'))).toBe('10 40 62 00 00 00 00 00');
  });

  it('wraps commands with the ROLI header, device id and checksum', () => {
    const cmd = colorModeCommand('rainbow');
    const msg = buildSysex(cmd);
    expect(msg.slice(0, 6)).toEqual([0xf0, 0x00, 0x21, 0x10, 0x77, 0x37]);
    expect(msg[msg.length - 1]).toBe(0xf7);
    expect(msg[msg.length - 2]).toBe(checksum(cmd));
    expect(msg.every((b, i) => i === 0 || i === msg.length - 1 || b < 0x80)).toBe(true);
  });

  it('maps colours to the nearest LUMI palette velocity', () => {
    expect(nearestPaletteVelocity([255, 255, 255])).toBe(127);
    // Blue-ish hand colour lands in the blue part of the palette, orange in the orange part.
    const blue = nearestPaletteVelocity([59, 130, 246]);
    const orange = nearestPaletteVelocity([245, 158, 11]);
    expect(blue).toBeGreaterThan(85);
    expect(blue).toBeLessThan(110);
    expect(orange).toBeGreaterThan(10);
    expect(orange).toBeLessThan(30);
  });

  it('lights keys with note-on and only sends changes', () => {
    const sent: number[][] = [];
    const l = new LumiLights({ send: (d) => sent.push([...d]) }, false);
    l.setKeyVelocity(60, 100, 1);
    expect(sent).toEqual([
      [0xa0, 60, 127],
      [0x90, 60, 100],
    ]);
    l.setKeyVelocity(60, 100, 1);
    expect(sent).toHaveLength(2);
    l.clearKey(60);
    expect(sent[2]).toEqual([0x80, 60, 0]);
    expect(l.setMode('app')).toBe(false); // no SysEx permission -> graceful no-op
  });
});

describe('keyboard layout and MIDI parsing', () => {
  it('zooms to the song range with at least 24 keys, on white-key edges', () => {
    const [lo, hi] = visibleRange(62, 67);
    expect(hi - lo + 1).toBeGreaterThanOrEqual(24);
    expect([1, 3, 6, 8, 10]).not.toContain(lo % 12);
    expect(visibleRange(21, 108)).toEqual([21, 108]);
  });

  it('lays out white and black keys', () => {
    const k = layoutKeyboard(60, 71, 700);
    expect(k.whiteWidth).toBe(100);
    expect(k.keys.get(60)!.x).toBe(0);
    expect(k.keys.get(61)!.black).toBe(true);
    expect(k.keys.get(61)!.x).toBeCloseTo(100 - 31);
  });

  it('parses note-on, note-off and running note-on with velocity 0', () => {
    expect(parseMidiMessage([0x90, 60, 100], 5)).toMatchObject({ type: 'on', pitch: 60, velocity: 100, time: 5 });
    expect(parseMidiMessage([0x91, 60, 0], 5)).toMatchObject({ type: 'off' });
    expect(parseMidiMessage([0x80, 60, 64], 5)).toMatchObject({ type: 'off' });
    expect(parseMidiMessage([0xb0, 64, 127], 5)).toBeNull();
    expect(parseMidiMessage([0xfe], 5)).toBeNull();
  });
});

describe('LightsDirector', () => {
  it('lights "now" and "next" keys in each hand\'s two colours, flashes hits and wrong keys, and clears', async () => {
    const { LightsDirector } = await import('../src/midi/lightsDirector');
    const { DEFAULT_SETTINGS } = await import('../src/engine/settings');
    const sent: number[][] = [];
    let now = 0;
    const lumi = new LumiLights({ send: (d) => sent.push([...d]) }, false);
    const { colors, nextColors } = DEFAULT_SETTINGS;
    const dir = new LightsDirector(lumi, colors, nextColors, () => now);
    dir.setTargets(
      new Map([
        [60, { hand: 'R' as const, role: 'now' as const }],
        [62, { hand: 'R' as const, role: 'next' as const }],
        [48, { hand: 'L' as const, role: 'now' as const }],
        [50, { hand: 'L' as const, role: 'next' as const }],
      ]),
    );
    const vel = (p: number) => sent.find((m) => m[0] === 0x90 && m[1] === p)![2];
    expect(vel(60)).toBe(nearestPaletteVelocity(hexToRgb(colors.R)));
    expect(vel(62)).toBe(nearestPaletteVelocity(hexToRgb(nextColors.R)));
    expect(vel(48)).toBe(nearestPaletteVelocity(hexToRgb(colors.L)));
    expect(vel(50)).toBe(nearestPaletteVelocity(hexToRgb(nextColors.L)));
    expect(new Set([vel(60), vel(62), vel(48), vel(50)]).size).toBe(4); // four distinct colours

    sent.length = 0;
    dir.flash(60, 'hit');
    expect(sent).toContainEqual([0x90, 60, 127]); // white
    now = 1000; // flash expired
    dir.setTargets(new Map());
    expect(sent).toContainEqual([0x80, 60, 0]);
    expect(sent).toContainEqual([0x80, 48, 0]);

    sent.length = 0;
    dir.flash(61, 'wrong');
    expect(sent.find((m) => m[0] === 0x90)![2]).toBe(nearestPaletteVelocity([255, 0, 0]));
    dir.clear();
    expect(lumi.litNotes()).toEqual([]);
  });

  it('uses on-screen colours the LUMI can show exactly', async () => {
    const { DEFAULT_SETTINGS } = await import('../src/engine/settings');
    const { snapToLumi } = await import('../src/midi/lumiLights');
    for (const c of [...Object.values(DEFAULT_SETTINGS.colors), ...Object.values(DEFAULT_SETTINGS.nextColors)]) {
      expect(snapToLumi(c)).toBe(c);
    }
  });
});

describe('MIDI timestamp sanitising', () => {
  it('keeps plausible stamps and replaces missing, future or stale ones with now', async () => {
    const { sanitizeTimestamp } = await import('../src/midi/input');
    expect(sanitizeTimestamp(995, 1000)).toEqual({ time: 995, corrected: false });
    expect(sanitizeTimestamp(0, 1000)).toEqual({ time: 1000, corrected: false });
    expect(sanitizeTimestamp(5000, 1000)).toEqual({ time: 1000, corrected: true }); // future
    expect(sanitizeTimestamp(10, 100000)).toEqual({ time: 100000, corrected: true }); // other timebase
  });
});


describe('LUMI SysEx address', () => {
  it('uses 0x37 unless another address is given', async () => {
    const { buildSysex, colorModeCommand, LumiLights } = await import('../src/midi/lumiLights');
    expect(buildSysex(colorModeCommand('single'))[5]).toBe(0x37);
    expect(buildSysex(colorModeCommand('single'), 0x05)[5]).toBe(0x05);
    const sent: number[][] = [];
    new LumiLights({ send: (d) => sent.push([...d]) }, true, 0x12).setMode('app');
    expect(sent.every((m) => m[5] === 0x12)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Midi } from '@tonejs/midi';
import { writeMidi } from 'midi-file';
import { parseMidi } from '../src/importers/midi';
import { ImportError } from '../src/importers/musicxml';

function twoTrackMidi(names: [string, string] = ['Piano 1', 'Piano 2']) {
  const m = new Midi();
  m.header.setTempo(120);
  m.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] });
  const a = m.addTrack();
  a.name = names[0];
  a.addNote({ midi: 72, time: 0, duration: 0.5, velocity: 0.8 });
  a.addNote({ midi: 74, time: 0.5, duration: 0.5, velocity: 0.8 });
  const b = m.addTrack();
  b.name = names[1];
  b.addNote({ midi: 48, time: 0, duration: 1.5, velocity: 0.6 });
  b.addNote({ midi: 43, time: 1.5, duration: 1.5, velocity: 0.6 });
  return m.toArray();
}

describe('MIDI importer', () => {
  it('treats the higher track as the right hand', () => {
    const song = parseMidi(twoTrackMidi());
    expect(song.sourceKind).toBe('midi');
    expect(song.notes.filter((n) => n.hand === 'R').map((n) => n.pitch)).toEqual([72, 74]);
    expect(song.notes.filter((n) => n.hand === 'L').map((n) => n.pitch)).toEqual([48, 43]);
    expect(song.notes.find((n) => n.pitch === 72)!.velocity).toBeGreaterThan(90);
  });

  it('honours track names like "Left Hand" / "Right Hand"', () => {
    // Deliberately name the high track "Left" to check names win over pitch.
    const song = parseMidi(twoTrackMidi(['Left Hand', 'Right Hand']));
    expect(song.notes.find((n) => n.pitch === 72)!.hand).toBe('L');
    expect(song.notes.find((n) => n.pitch === 48)!.hand).toBe('R');
  });

  it('builds measures from the time signature and tempo', () => {
    const song = parseMidi(twoTrackMidi());
    // 3/4 at 120 bpm = 1.5s per bar; notes span 3s -> 2 bars
    expect(song.measures.length).toBeGreaterThanOrEqual(2);
    expect(song.measures[0].beats).toBe(3);
    expect(song.measures[1].start).toBeCloseTo(1.5);
    expect(song.notes.find((n) => n.pitch === 43)!.measure).toBe(1);
    expect(song.tempos[0].bpm).toBeCloseTo(120);
  });

  it('splits a single-channel single-track file at middle C', () => {
    const m = new Midi();
    const t = m.addTrack();
    t.addNote({ midi: 64, time: 0, duration: 0.5 });
    t.addNote({ midi: 50, time: 0, duration: 0.5 });
    const song = parseMidi(m.toArray());
    expect(song.notes.find((n) => n.pitch === 64)!.hand).toBe('R');
    expect(song.notes.find((n) => n.pitch === 50)!.hand).toBe('L');
  });

  it('splits a type-0 file by channel', () => {
    // Channel 0 plays high notes, channel 1 plays low notes, all in one track.
    const bytes = writeMidi({
      header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
      tracks: [
        [
          { deltaTime: 0, type: 'setTempo', meta: true, microsecondsPerBeat: 500000 },
          { deltaTime: 0, type: 'noteOn', channel: 0, noteNumber: 76, velocity: 100 },
          { deltaTime: 0, type: 'noteOn', channel: 1, noteNumber: 62, velocity: 100 },
          { deltaTime: 480, type: 'noteOff', channel: 0, noteNumber: 76, velocity: 0 },
          { deltaTime: 0, type: 'noteOff', channel: 1, noteNumber: 62, velocity: 0 },
          { deltaTime: 0, type: 'endOfTrack', meta: true },
        ],
      ],
    });
    const song = parseMidi(new Uint8Array(bytes));
    // Both notes are above middle C, so only the channel split can put 62 in the left hand.
    expect(song.notes.find((n) => n.pitch === 76)!.hand).toBe('R');
    expect(song.notes.find((n) => n.pitch === 62)!.hand).toBe('L');
    expect(song.notes[0].duration).toBeCloseTo(0.5);
  });

  it('ignores drum channel notes', () => {
    const m = new Midi();
    const drums = m.addTrack();
    drums.channel = 9;
    drums.addNote({ midi: 36, time: 0, duration: 0.1 });
    const p = m.addTrack();
    p.addNote({ midi: 60, time: 0, duration: 1 });
    const song = parseMidi(m.toArray());
    expect(song.notes.map((n) => n.pitch)).toEqual([60]);
  });

  it('rejects garbage and empty files', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4]))).toThrow(ImportError);
    expect(() => parseMidi(new Midi().toArray())).toThrow(/no piano notes/);
  });

  it('imports the bundled Twinkle file', () => {
    const song = parseMidi(new Uint8Array(readFileSync('public/songs/twinkle.mid')));
    expect(song.notes.filter((n) => n.hand === 'R')).toHaveLength(42);
    expect(song.measures).toHaveLength(12);
  });
});

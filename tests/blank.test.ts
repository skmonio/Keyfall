import { describe, expect, it } from 'vitest';
import { addBars, canRemoveLastBar, createBlankSong, removeLastBar, setTempo } from '../src/model/blank';
import { addNote, applyEdits, toEditable } from '../src/model/edit';
import { parseMusicXml } from '../src/importers/musicxml';
import { InputManager } from '../src/midi/input';
import { LightsDirector } from '../src/midi/lightsDirector';

const opts = { title: 'Tune', composer: 'Me', beats: 3, beatType: 4, bpm: 120, bars: 4, fifths: -2 };

describe('writing your own music', () => {
  it('makes empty bars at the tempo and time signature', () => {
    const s = createBlankSong(opts);
    expect(s.sourceKind).toBe('written');
    expect(s.notes).toHaveLength(0);
    expect(s.measures).toHaveLength(4);
    expect(s.measures[1].start).toBeCloseTo(1.5); // 3 beats at 120 bpm
    expect(s.duration).toBeCloseTo(6);
    expect(s.musicXml!.match(/<measure /g)).toHaveLength(4);
    expect(s.musicXml).toContain('<beats>3</beats>');
    expect(s.musicXml).toContain('<fifths>-2</fifths>');
    expect(s.musicXml).toContain('<creator type="composer">Me</creator>');
  });

  it('writes the notes you add into the sheet music, in the chosen key', () => {
    const s = createBlankSong(opts);
    let notes = toEditable(s);
    notes = addNote(notes, { pitch: 70, q: 0, len: 1, hand: 'R', velocity: 80 }); // B♭4
    notes = addNote(notes, { pitch: 46, q: 3, len: 3, hand: 'L', velocity: 80 });
    const saved = applyEdits(s, notes);
    expect(saved.originalMusicXml).toBeUndefined();
    expect(saved.edited).toBe(false);
    expect(saved.musicXml).toContain('<fifths>-2</fifths>');
    const back = parseMusicXml(saved.musicXml!, 'x');
    expect(back.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [70, 'R'],
      [46, 'L'],
    ]);
    expect(back.notes[1].start).toBeCloseTo(1.5);
  });

  it('adds bars, and removes only an empty last bar', () => {
    const s = addBars(createBlankSong(opts), 4);
    expect(s.measures).toHaveLength(8);
    expect(s.measures[7].number).toBe(8);
    expect(s.duration).toBeCloseTo(12);
    expect(canRemoveLastBar(s, [0, 1])).toBe(true);
    expect(canRemoveLastBar(s, [s.measures[7].start + 0.1])).toBe(false);
    const r = removeLastBar(s);
    expect(r.measures).toHaveLength(7);
    expect(r.duration).toBeCloseTo(10.5);
  });

  it('changes the tempo without moving notes off their beats', () => {
    const s = setTempo(createBlankSong(opts), 60);
    expect(s.measures[1].start).toBeCloseTo(3);
    expect(s.tempos[0].bpm).toBe(60);
  });
});

describe('keyboard reconnects', () => {
  const port = (id: string, name: string, state: string) => ({ id, name, manufacturer: 'ROLI', state });
  it('listens to every input when the chosen one has gone', () => {
    const m = new InputManager();
    m.access = { inputs: new Map([['new', port('new', 'LUMI Keys BLOCK', 'connected')]]), outputs: new Map() } as unknown as MIDIAccess;
    m.selectedInputId = 'old-bluetooth';
    expect(m.activeInputId()).toBeUndefined();
    m.selectedInputId = 'new';
    expect(m.activeInputId()).toBe('new');
  });

  it('sends lights to the connected LUMI, not an unplugged one', () => {
    const m = new InputManager();
    const outs = new Map([
      ['bt', port('bt', 'LUMI Keys BLOCK Bluetooth', 'disconnected')],
      ['usb', port('usb', 'LUMI Keys BLOCK', 'connected')],
    ]);
    m.access = { inputs: new Map(), outputs: outs } as unknown as MIDIAccess;
    expect(m.lumiOutput()?.id).toBe('usb');
    outs.get('usb')!.state = 'disconnected';
    expect(m.lumiOutput()).toBeUndefined();
  });

  it('lights a LUMI that connects mid-song', () => {
    const sent: number[][] = [];
    const dir = new LightsDirector(undefined, { R: '#5877fd', L: '#ff8547' });
    dir.setTargets(new Map([[60, { hand: 'R', role: 'now' }]]));
    expect(sent).toHaveLength(0);
    return import('../src/midi/lumiLights').then(({ LumiLights }) => {
      dir.setLights(new LumiLights({ send: (d) => sent.push([...d]) }, false));
      expect(sent.some((d) => (d[0] & 0xf0) === 0x90 && d[1] === 60)).toBe(true);
    });
  });
});

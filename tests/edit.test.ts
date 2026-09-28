import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { addNote, applyEdits, copyNotes, moveNotes, nextNoteStart, notesAt, notesInBox, pasteNotes, prevNoteStart, removeNotes, resizeNotes, setHand, snap, toEditable, type EditNote } from '../src/model/edit';
import { parseMusicXml } from '../src/importers/musicxml';
import { secToQuarter } from '../src/model/time';

const ode = () => parseMusicXml(readFileSync('public/songs/ode-to-joy.musicxml', 'utf8'));

describe('note editing', () => {
  it('converts to quarter-note positions and back without changing anything', () => {
    const song = ode();
    const edited = applyEdits(song, toEditable(song));
    expect(edited.notes.map((n) => [n.pitch, n.start.toFixed(3), n.hand])).toEqual(song.notes.map((n) => [n.pitch, n.start.toFixed(3), n.hand]));
    expect(edited.measures).toHaveLength(song.measures.length);
  });

  it('adds, moves, resizes, re-hands and deletes notes', () => {
    const song = ode();
    let notes = toEditable(song);
    const before = notes.length;
    notes = addNote(notes, { pitch: 67, q: 1, len: 1, hand: 'R', velocity: 80 });
    expect(notes).toHaveLength(before + 1);
    expect(addNote(notes, { pitch: 67, q: 1, len: 1, hand: 'R', velocity: 80 })).toHaveLength(before + 1); // no duplicates
    const added = notes[notes.length - 1];
    notes = moveNotes(notes, new Set([added.key]), 0.5, 2);
    notes = resizeNotes(notes, new Set([added.key]), 1);
    notes = setHand(notes, new Set([added.key]), 'L');
    const n = notes.find((x) => x.key === added.key)!;
    expect(n).toMatchObject({ pitch: 69, q: 1.5, len: 2, hand: 'L' });
    notes = removeNotes(notes, new Set([added.key]));
    expect(notes).toHaveLength(before);
  });

  it('snaps to the grid', () => {
    expect(snap(1.13, 0.25)).toBe(1.25);
    expect(snap(2.9, 1)).toBe(3);
  });

  it('saves: new note is in the song, the sheet is rewritten, and the original is kept', () => {
    const song = ode();
    const notes = addNote(toEditable(song), { pitch: 84, q: 2, len: 1, hand: 'R', velocity: 80 });
    const saved = applyEdits(song, notes);
    const added = saved.notes.find((x) => x.pitch === 84)!;
    expect(secToQuarter(saved, added.start)).toBeCloseTo(2);
    expect(added.measure).toBe(0);
    expect(added.finger).toBeDefined(); // fingering estimated for it
    expect(saved.edited).toBe(true);
    expect(saved.originalMusicXml).toBe(song.musicXml);
    // The rewritten sheet contains the new note.
    const back = parseMusicXml(saved.musicXml!);
    expect(back.notes.some((x) => x.pitch === 84)).toBe(true);
    expect(back.notes).toHaveLength(saved.notes.length);
  });
});

describe('copy, paste and stepping', () => {
  const base = (): EditNote[] => [
    { key: 0, pitch: 60, q: 0, len: 1, hand: 'R', velocity: 80 },
    { key: 1, pitch: 64, q: 1, len: 1, hand: 'R', velocity: 80 },
    { key: 2, pitch: 48, q: 1, len: 2, hand: 'L', velocity: 80 },
    { key: 3, pitch: 67, q: 3, len: 1, hand: 'R', velocity: 80 },
  ];
  it('copies relative to the first note and pastes at the cursor', () => {
    const clip = copyNotes(base(), new Set([1, 2]))!;
    expect(clip.span).toBe(2);
    expect(clip.items.map((n) => [n.pitch, n.q])).toEqual([[64, 0], [48, 0]]);
    const r = pasteNotes(base(), clip, 4);
    expect(r.notes).toHaveLength(6);
    expect(r.keys.size).toBe(2);
    expect(r.notes.filter((n) => r.keys.has(n.key)).map((n) => [n.pitch, n.q, n.hand])).toEqual([[64, 4, 'R'], [48, 4, 'L']]);
  });
  it('does not stack a paste on identical notes', () => {
    const clip = copyNotes(base(), new Set([0]))!;
    expect(pasteNotes(base(), clip, 0).keys.size).toBe(0);
  });
  it('steps from note to note', () => {
    expect(nextNoteStart(base(), 0)).toBe(1);
    expect(nextNoteStart(base(), 1)).toBe(3);
    expect(nextNoteStart(base(), 3)).toBeUndefined();
    expect(prevNoteStart(base(), 3)).toBe(1);
    expect(prevNoteStart(base(), 0)).toBeUndefined();
    expect(notesAt(base(), 1).map((n) => n.pitch)).toEqual([64, 48]);
  });
  it('selects notes in a box', () => {
    expect(notesInBox(base(), 0.5, 2, 50, 70).map((n) => n.key)).toEqual([0, 1]);
    expect(notesInBox(base(), 2, 0.5, 40, 70).map((n) => n.key)).toEqual([0, 1, 2]);
  });
});

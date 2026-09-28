/**
 * Note editing (fixing a scanned or imported score).
 *
 * Notes are edited in quarter-note positions (so the grid follows the music, not the
 * clock). Saving converts them back to song time, recomputes bars, re-estimates fingering
 * for changed notes, and rewrites the sheet music from the notes. The original MusicXML is
 * kept so the edit can be undone later.
 */
import { generateMusicXml } from '../importers/notation';
import { estimateFingering } from './fingering';
import { finalizeSong, measureAt, type Finger, type Hand, type Song } from './song';
import { quarterToSec, secToQuarter } from './time';

export interface EditNote {
  key: number; // stable id while editing
  pitch: number;
  q: number; // start, quarter notes from the beginning
  len: number; // length in quarter notes
  hand: Hand;
  velocity: number;
  finger?: Finger;
  fingerSource?: 'score' | 'auto';
  backing?: boolean;
  part?: number;
  staff?: number;
  /** Changed since loading (its fingering is re-estimated on save). */
  touched?: boolean;
}

export function toEditable(song: Song): EditNote[] {
  return song.notes.map((n, i) => {
    const q = secToQuarter(song, n.start);
    return {
      key: i,
      pitch: n.pitch,
      q: round(q),
      len: round(secToQuarter(song, n.start + n.duration) - q),
      hand: n.hand,
      velocity: n.velocity,
      finger: n.finger,
      fingerSource: n.fingerSource,
      backing: n.backing,
      part: n.part,
      staff: n.staff,
    };
  });
}

const round = (x: number) => Math.round(x * 960) / 960;

export function snap(q: number, grid: number): number {
  return round(Math.round(q / grid) * grid);
}

export function nextKey(notes: EditNote[]): number {
  return notes.reduce((m, n) => Math.max(m, n.key), -1) + 1;
}

export function addNote(notes: EditNote[], n: Omit<EditNote, 'key' | 'touched'>): EditNote[] {
  // Don't stack an identical note on top of an existing one.
  if (notes.some((x) => x.pitch === n.pitch && Math.abs(x.q - n.q) < 1e-6)) return notes;
  return [...notes, { ...n, key: nextKey(notes), touched: true }];
}

export function removeNotes(notes: EditNote[], keys: Set<number>): EditNote[] {
  return notes.filter((n) => !keys.has(n.key));
}

export function moveNotes(notes: EditNote[], keys: Set<number>, dq: number, dp: number): EditNote[] {
  return notes.map((n) =>
    keys.has(n.key)
      ? { ...n, q: round(Math.max(0, n.q + dq)), pitch: Math.max(21, Math.min(108, n.pitch + dp)), touched: true, ...(dp ? { finger: undefined, fingerSource: undefined } : {}) }
      : n,
  );
}

export function resizeNotes(notes: EditNote[], keys: Set<number>, dLen: number, minLen = 0.125): EditNote[] {
  return notes.map((n) => (keys.has(n.key) ? { ...n, len: round(Math.max(minLen, n.len + dLen)), touched: true } : n));
}

export function setLength(notes: EditNote[], keys: Set<number>, len: number): EditNote[] {
  return notes.map((n) => (keys.has(n.key) ? { ...n, len, touched: true } : n));
}

export function setHand(notes: EditNote[], keys: Set<number>, hand: Hand): EditNote[] {
  return notes.map((n) => (keys.has(n.key) ? { ...n, hand, finger: undefined, fingerSource: undefined, touched: true } : n));
}

/** Build the edited song: new notes, same bars and tempo, sheet music rewritten from the notes. */
export function applyEdits(song: Song, notes: EditNote[]): Song {
  const draft: Song = {
    ...song,
    notes: notes.map((n) => {
      const start = quarterToSec(song, n.q);
      return {
        id: 0,
        pitch: n.pitch,
        start,
        duration: Math.max(0.02, quarterToSec(song, n.q + n.len) - start),
        hand: n.hand,
        velocity: n.velocity,
        measure: 0,
        finger: n.touched && n.fingerSource !== 'score' ? undefined : n.finger,
        fingerSource: n.touched && n.fingerSource !== 'score' ? undefined : n.fingerSource,
        ...(n.backing ? { backing: true } : {}),
        ...(n.part !== undefined ? { part: n.part } : {}),
        ...(n.staff !== undefined ? { staff: n.staff } : {}),
      };
    }),
  };
  for (const n of draft.notes) n.measure = measureAt(draft, n.start);
  const done = finalizeSong(draft);
  estimateFingering(done.notes);
  // The sheet now shows the corrected notes. Repeats are written out (the notes are in playing
  // order), so bars get plain numbers and no repeat marks.
  const plain: Song = { ...done, measures: done.measures.map(({ writtenIndex: _w, writtenQ: _q, pass: _p, ...m }) => m) };
  // Music you wrote yourself has no "original" to go back to.
  const written = song.sourceKind === 'written';
  return {
    ...plain,
    musicXml: generateMusicXml(plain),
    originalMusicXml: written ? undefined : (song.originalMusicXml ?? song.musicXml),
    edited: !written,
  };
}

// ---- copy and paste

export interface Clip {
  /** Notes relative to the earliest copied note. */
  items: Omit<EditNote, 'key' | 'touched'>[];
  /** Length of the copied passage, in quarters (so "duplicate" can put a copy right after). */
  span: number;
}

export function copyNotes(notes: EditNote[], keys: Set<number>): Clip | undefined {
  const picked = notes.filter((n) => keys.has(n.key));
  if (!picked.length) return undefined;
  const q0 = Math.min(...picked.map((n) => n.q));
  const end = Math.max(...picked.map((n) => n.q + n.len));
  return {
    items: picked.map(({ key: _k, touched: _t, ...n }) => ({ ...n, q: round(n.q - q0) })),
    span: round(end - q0),
  };
}

/** Paste a clip with its first note at `at`. Returns the new notes and the keys of the pasted ones. */
export function pasteNotes(notes: EditNote[], clip: Clip, at: number): { notes: EditNote[]; keys: Set<number> } {
  let next = notes;
  const keys = new Set<number>();
  for (const it of clip.items) {
    const before = next;
    next = addNote(next, { ...it, q: round(Math.max(0, at + it.q)) });
    if (next !== before) keys.add(next[next.length - 1].key);
  }
  return { notes: next, keys };
}

// ---- moving the cursor from note to note

/** Start of the next note after `q` (or undefined at the end). */
export function nextNoteStart(notes: EditNote[], q: number): number | undefined {
  let best: number | undefined;
  for (const n of notes) if (n.q > q + 1e-6 && (best === undefined || n.q < best)) best = n.q;
  return best;
}

/** Start of the previous note before `q` (or undefined at the start). */
export function prevNoteStart(notes: EditNote[], q: number): number | undefined {
  let best: number | undefined;
  for (const n of notes) if (n.q < q - 1e-6 && (best === undefined || n.q > best)) best = n.q;
  return best;
}

/** The notes that start at `q` (a chord). */
export function notesAt(notes: EditNote[], q: number): EditNote[] {
  return notes.filter((n) => Math.abs(n.q - q) < 1e-6);
}

/** Notes overlapping a box in quarters × pitches (for drag-selecting). */
export function notesInBox(notes: EditNote[], q0: number, q1: number, p0: number, p1: number): EditNote[] {
  const [qa, qb] = q0 < q1 ? [q0, q1] : [q1, q0];
  const [pa, pb] = p0 < p1 ? [p0, p1] : [p1, p0];
  return notes.filter((n) => n.q < qb && n.q + n.len > qa && n.pitch >= pa && n.pitch <= pb);
}

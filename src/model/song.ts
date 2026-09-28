export type Hand = 'L' | 'R';
export type Finger = 1 | 2 | 3 | 4 | 5;

/** A single note. Times are in seconds of song time at 100% speed. */
export interface Note {
  id: number;
  /** MIDI pitch, 21 (A0) .. 108 (C8). */
  pitch: number;
  start: number;
  duration: number;
  hand: Hand;
  finger?: Finger;
  /** Where the finger number came from: the score, or estimated by the app. */
  fingerSource?: 'score' | 'auto';
  velocity: number;
  /** Pitch as written, when the note was moved to fit a small keyboard. The backing track plays this. */
  origPitch?: number;
  /** 0-based measure index. */
  measure: number;
  /** Staff number from the score (1 = treble, 2 = bass), if known. */
  staff?: number;
  /** Another instrument's part (e.g. a voice alongside the piano): heard in Full sound, never yours to play. */
  backing?: boolean;
  /** Which part of the score (0-based). */
  part?: number;
}

export interface Measure {
  index: number;
  /** Printed measure number (what the user sees in the score). */
  number: number;
  start: number;
  duration: number;
  beats: number;
  beatType: number;
  /** For scores with repeats: which written bar this played bar is (0-based), its written
   *  position in quarter notes, and which time through it is (1 = first). */
  writtenIndex?: number;
  writtenQ?: number;
  pass?: number;
}

export interface TempoEvent {
  /** Song time in seconds. */
  time: number;
  bpm: number;
}

export type SourceKind = 'musicxml' | 'midi' | 'omr' | 'audio' | 'exercise' | 'written';

export interface Song {
  id: string;
  title: string;
  composer?: string;
  notes: Note[];
  measures: Measure[];
  tempos: TempoEvent[];
  duration: number;
  sourceKind: SourceKind;
  /** The score's parts, and how KeyFall uses each one. */
  parts?: { name: string; role: 'piano' | 'melody' | 'backing' }[];
  /** Version of the importer that read this song; older songs are re-read from `musicXml`. */
  importerVersion?: number;
  /** An original recording is stored for this song (audio imports), usable as the backing track. */
  hasRecording?: boolean;
  /** The MusicXML as imported, kept when the notes have been edited (so the edit can be undone). */
  originalMusicXml?: string;
  /** The notes were changed in the note editor (the sheet is rewritten from them). */
  edited?: boolean;
  /** Key signature for sheet music written from the notes (fifths, −7..7); estimated when unset. */
  keyFifths?: number;
  /** Original MusicXML text, kept so OSMD can render the score. */
  musicXml?: string;
  addedAt: number;
}

export function sortNotes(notes: Note[]): Note[] {
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** Recompute ids, sort order, and measure indices after edits. */
export function finalizeSong(song: Omit<Song, 'duration'> & { duration?: number }): Song {
  sortNotes(song.notes);
  song.notes.forEach((n, i) => (n.id = i));
  const lastNoteEnd = song.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const lastMeasureEnd = song.measures.length
    ? song.measures[song.measures.length - 1].start + song.measures[song.measures.length - 1].duration
    : 0;
  return { ...song, duration: Math.max(lastNoteEnd, lastMeasureEnd, song.duration ?? 0) };
}

export function measureAt(song: Song, time: number): number {
  const ms = song.measures;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ms[mid].start <= time + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Build a regular measure grid when a source has no explicit barlines (e.g. MIDI). */
export function buildMeasureGrid(
  duration: number,
  bpm: number,
  beats = 4,
  beatType = 4,
): Measure[] {
  const beatSec = (60 / bpm) * (4 / beatType);
  const len = beats * beatSec;
  const count = Math.max(1, Math.ceil((duration - 1e-6) / len));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    number: i + 1,
    start: i * len,
    duration: len,
    beats,
    beatType,
  }));
}

export function pitchRange(notes: Note[]): [number, number] {
  if (!notes.length) return [60, 72];
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  return [lo, hi];
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function pitchName(p: number): string {
  return `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
}
const SHARP_LETTERS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_LETTERS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

/** A note's letter name without octave ("C", "F♯", "B♭"), spelled with flats in flat keys. */
export function noteLetter(p: number, flats = false): string {
  return (flats ? FLAT_LETTERS : SHARP_LETTERS)[((p % 12) + 12) % 12];
}

/** Does this song's key use flats? From the score's key signature, or guessed from the notes. */
export function prefersFlats(song: Pick<Song, 'musicXml' | 'notes'>): boolean {
  const m = song.musicXml?.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/);
  if (m) return Number(m[1]) < 0;
  // No key signature: count black keys that read more naturally as flats (B♭, E♭, A♭).
  let flat = 0;
  let sharp = 0;
  for (const n of song.notes) {
    const pc = n.pitch % 12;
    if (pc === 10 || pc === 3 || pc === 8) flat++;
    if (pc === 6 || pc === 1) sharp++;
  }
  return flat > sharp;
}

export function isBlack(p: number): boolean {
  return [1, 3, 6, 8, 10].includes(p % 12);
}

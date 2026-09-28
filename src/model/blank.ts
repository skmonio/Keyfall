/**
 * Writing your own music: a new, empty song to fill in with the note editor, and adding or
 * removing bars at the end.
 */
import { generateMusicXml } from '../importers/notation';
import { finalizeSong, type Measure, type Song } from './song';

export interface BlankOptions {
  title: string;
  composer?: string;
  beats: number;
  beatType: number;
  bpm: number;
  bars: number;
  /** Key signature in fifths (−7 = seven flats … 7 = seven sharps). */
  fifths: number;
}

export const KEY_SIGNATURES: { fifths: number; name: string }[] = [
  { fifths: 0, name: 'C major / A minor' },
  { fifths: 1, name: 'G major / E minor (1♯)' },
  { fifths: 2, name: 'D major / B minor (2♯)' },
  { fifths: 3, name: 'A major / F♯ minor (3♯)' },
  { fifths: 4, name: 'E major / C♯ minor (4♯)' },
  { fifths: 5, name: 'B major / G♯ minor (5♯)' },
  { fifths: 6, name: 'F♯ major / D♯ minor (6♯)' },
  { fifths: -1, name: 'F major / D minor (1♭)' },
  { fifths: -2, name: 'B♭ major / G minor (2♭)' },
  { fifths: -3, name: 'E♭ major / C minor (3♭)' },
  { fifths: -4, name: 'A♭ major / F minor (4♭)' },
  { fifths: -5, name: 'D♭ major / B♭ minor (5♭)' },
  { fifths: -6, name: 'G♭ major / E♭ minor (6♭)' },
];

/** Seconds per bar at the song's last tempo (bars are only added or removed at the end). */
function barSeconds(song: Pick<Song, 'tempos'>, beats: number, beatType: number): number {
  const bpm = song.tempos[song.tempos.length - 1]?.bpm ?? 100;
  return ((beats * 4) / beatType) * (60 / bpm);
}

export function createBlankSong(o: BlankOptions): Song {
  const base = {
    id: crypto.randomUUID(),
    title: o.title.trim() || 'My song',
    composer: o.composer?.trim() || undefined,
    notes: [],
    measures: [] as Measure[],
    tempos: [{ time: 0, bpm: o.bpm }],
    sourceKind: 'written' as const,
    keyFifths: o.fifths,
    addedAt: Date.now(),
  };
  const song = addBars(finalizeSong(base), Math.max(1, o.bars), o.beats, o.beatType);
  return { ...song, musicXml: generateMusicXml(song) };
}

/** Add bars at the end, in the last bar's time signature (or the one given). */
export function addBars(song: Song, count: number, beats?: number, beatType?: number): Song {
  const measures = song.measures.map((m) => ({ ...m }));
  const last = measures[measures.length - 1];
  const b = beats ?? last?.beats ?? 4;
  const bt = beatType ?? last?.beatType ?? 4;
  const len = barSeconds(song, b, bt);
  let start = last ? last.start + last.duration : 0;
  for (let i = 0; i < count; i++) {
    const index = measures.length;
    measures.push({ index, number: (last?.number ?? 0) + i + 1, start, duration: len, beats: b, beatType: bt });
    start += len;
  }
  return { ...song, measures, duration: start };
}

/** Can the last bar go? Only when it's empty (and it isn't the only bar). */
export function canRemoveLastBar(song: Song, noteStarts: number[]): boolean {
  const last = song.measures[song.measures.length - 1];
  return song.measures.length > 1 && !!last && noteStarts.every((t) => t <= last.start + 1e-6);
}

export function removeLastBar(song: Song): Song {
  const measures = song.measures.slice(0, -1);
  const end = measures.length ? measures[measures.length - 1].start + measures[measures.length - 1].duration : 0;
  return { ...song, measures, duration: end };
}

/** Change the tempo of a song with a single tempo (notes are edited in beats, so they follow). */
export function setTempo(song: Song, bpm: number): Song {
  const old = song.tempos[0]?.bpm ?? bpm;
  if (song.tempos.length > 1 || old === bpm) return song;
  const f = old / bpm;
  return {
    ...song,
    tempos: [{ time: 0, bpm }],
    measures: song.measures.map((m) => ({ ...m, start: m.start * f, duration: m.duration * f })),
    notes: song.notes.map((n) => ({ ...n, start: n.start * f, duration: n.duration * f })),
    duration: song.duration * f,
  };
}

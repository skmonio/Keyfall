import type { Song } from '../model/song';
import { estimateFingering } from '../model/fingering';
import { importMidiFile } from './midi';
import { ImportError, importMusicXmlFile } from './musicxml';

export { ImportError } from './musicxml';

export type ImportKind = 'musicxml' | 'midi' | 'audio';

export function detectKind(name: string): ImportKind | undefined {
  const n = name.toLowerCase();
  if (/\.(musicxml|mxl|xml)$/.test(n)) return 'musicxml';
  if (/\.midi?$/.test(n)) return 'midi';
  if (/\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/.test(n)) return 'audio';
  return undefined;
}

/** A PDF or picture of sheet music: KeyFall can't read these, it needs MusicXML. */
export function isSheetScan(name: string): boolean {
  return /\.(pdf|png|jpe?g|heic|tiff?|bmp|webp)$/i.test(name);
}

/** Import MusicXML or MIDI directly. */
export async function importFile(file: File): Promise<Song> {
  const kind = detectKind(file.name);
  let song: Song;
  if (kind === 'musicxml') song = await importMusicXmlFile(file);
  else if (kind === 'midi') song = await importMidiFile(file);
  else throw new ImportError(`Unsupported file type: ${file.name}`);
  estimateFingering(song.notes);
  return song;
}

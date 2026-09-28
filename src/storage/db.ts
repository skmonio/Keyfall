/** Tiny IndexedDB wrapper: songs, results (scores) and key/value settings. No backend. */
import type { Calibration, AppSettings } from '../engine/settings';
import { DEFAULT_SETTINGS } from '../engine/settings';
import type { SessionResults } from '../engine/session';
import type { Song } from '../model/song';

const DB_NAME = 'keyfall';
const VERSION = 3;

let dbPromise: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('results')) {
        const s = db.createObjectStore('results', { autoIncrement: true });
        s.createIndex('songId', 'songId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      // v2: original audio for songs imported from recordings, kept apart so song lists stay light.
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings');
      // v3: kept for compatibility with earlier versions (no longer used).
      if (!db.objectStoreNames.contains('activity')) db.createObjectStore('activity', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Earlier versions defaulted to colours the LUMI can't show exactly; move those to the new defaults. */
function upgradeColors(saved?: Partial<AppSettings['colors']>): AppSettings['colors'] {
  const old: Record<string, string> = { R: '#3b82f6', L: '#f59e0b' };
  const out = { ...DEFAULT_SETTINGS.colors, ...saved };
  for (const h of ['R', 'L'] as const) if (out[h]?.toLowerCase() === old[h]) out[h] = DEFAULT_SETTINGS.colors[h];
  return out;
}

export const db = {
  saveSong: (song: Song) => tx('songs', 'readwrite', (s) => s.put(song)),
  getSong: (id: string) => tx<Song | undefined>('songs', 'readonly', (s) => s.get(id)),
  deleteSong: async (id: string) => {
    await tx('recordings', 'readwrite', (s) => s.delete(id));
    return tx('songs', 'readwrite', (s) => s.delete(id));
  },
  saveRecording: (songId: string, blob: Blob) => tx('recordings', 'readwrite', (s) => s.put(blob, songId)),
  getRecording: (songId: string) => tx<Blob | undefined>('recordings', 'readonly', (s) => s.get(songId)),
  listSongs: async (): Promise<Song[]> => {
    const all = await tx<Song[]>('songs', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.addedAt - a.addedAt);
  },

  addResult: (r: SessionResults) => tx('results', 'readwrite', (s) => s.add(r)),
  getKv: <T,>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key)),
  setKv: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)),
  allResults: () => tx<SessionResults[]>('results', 'readonly', (s) => s.getAll()),
  resultsFor: (songId: string) =>
    tx<SessionResults[]>('results', 'readonly', (s) => s.index('songId').getAll(songId)),

  async getSettings(): Promise<AppSettings> {
    const saved = await tx<Partial<AppSettings> | undefined>('kv', 'readonly', (s) => s.get('settings'));
    // v2: practising one hand no longer plays the other hand unless you ask for it.
    if (saved?.play && (saved.settingsVersion ?? 1) < 2) saved.play.autoPlayOtherHand = false;
    // v3: next-note hints are off by default (switch on with "Next notes").
    if (saved?.play && (saved.settingsVersion ?? 1) < 3) saved.play.showNextNotes = false;
    // v4: forget what we learnt about the LUMI's octave. It may have been learnt while SysEx
    // was blocked (so the octave command could never work); the next song checks again.
    if (saved && (saved.settingsVersion ?? 1) < 4) {
      delete saved.lumiOctaveWorks;
      delete saved.lumiBase;
    }
    if (saved) saved.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      play: {
        ...DEFAULT_SETTINGS.play,
        ...saved?.play,
        windows: { ...DEFAULT_SETTINGS.play.windows, ...saved?.play?.windows },
        sheet: { ...DEFAULT_SETTINGS.play.sheet, ...saved?.play?.sheet },
      },
      colors: upgradeColors(saved?.colors),
      nextColors: { ...DEFAULT_SETTINGS.nextColors, ...saved?.nextColors },
    };
  },
  saveSettings: (s: AppSettings) => tx('kv', 'readwrite', (st) => st.put(s, 'settings')),

  getCalibration: (deviceKey: string) =>
    tx<Calibration | undefined>('kv', 'readonly', (s) => s.get(`calibration:${deviceKey}`)),
  deleteCalibration: (deviceKey: string) => tx('kv', 'readwrite', (s) => s.delete(`calibration:${deviceKey}`)),
  saveCalibration: (c: Calibration) => tx('kv', 'readwrite', (s) => s.put(c, `calibration:${c.deviceKey}`)),
};

/** Best previous result for the same song, mode and hands (personal best). */
/** Best earlier run of the same kind: same mode, hands and section (e.g. "whole song" or "bars 1–4"). */
export function personalBest(results: SessionResults[], mode: string, hands: string, section = 'whole song'): SessionResults | undefined {
  return results
    .filter((r) => r.mode === mode && r.hands === hands && (r.section ?? 'whole song') === section && !r.seeked)
    .sort((a, b) => b.score - a.score)[0];
}

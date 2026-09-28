import { useEffect, useState } from 'react';
import type { SessionResults } from '../engine/session';
import type { Song } from '../model/song';
import type { LessonStep } from '../model/lesson';
import { db } from '../storage/db';
import { MUSICXML_IMPORTER_VERSION, parseMusicXml } from '../importers/musicxml';
import { estimateFingering } from '../model/fingering';
import { EXERCISE_VERSION, makeExercise } from '../content/exercises';
import { DeviceBadge } from './DeviceBadge';
import { Calibrate } from './screens/Calibrate';
import { Games } from './screens/Games';
import { SysexFix } from './SysexFix';
import { KeyboardMismatch } from './KeyboardMismatch';
import { Editor } from './screens/Editor';
import { AudioReview } from './screens/AudioReview';
import type { RawNote } from '../importers/audio';
import { Library } from './screens/Library';
import { LumiTest } from './screens/LumiTest';
import { Play } from './screens/Play';
import { Results } from './screens/Results';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { ensureAudio, initDevices, loadSettings } from './services';

export type Route =
  | { name: 'library' }
  | { name: 'setup'; song: Song }
  | { name: 'play'; song: Song; lesson?: LessonStep }
  | { name: 'results'; song: Song; results: SessionResults; lesson?: LessonStep }
  | { name: 'settings' }
  | { name: 'calibrate' }
  | { name: 'lumi' }
  | { name: 'games' }
  | { name: 'edit'; song: Song }
  | { name: 'audio'; raw: RawNote[]; duration: number; recording: Blob; title: string };

export type Navigate = (r: Route) => void;

/** Songs read by an older importer are re-read from their saved MusicXML (keeping id and name). */
async function upgradeSong(song: Song): Promise<Song> {
  // Built-in exercises: rebuild from the current version (keeps the id, so progress stays).
  if (song.sourceKind === 'exercise' && (song.importerVersion ?? 1) < EXERCISE_VERSION) {
    try {
      const fresh = makeExercise(song.id.replace(/^exercise:/, ''));
      await db.saveSong(fresh);
      return fresh;
    } catch {
      return song;
    }
  }
  if (!song.musicXml || song.edited || (song.sourceKind !== 'musicxml' && song.sourceKind !== 'omr')) return song;
  if ((song.importerVersion ?? 1) >= MUSICXML_IMPORTER_VERSION) return song;
  try {
    const fresh = parseMusicXml(song.musicXml, song.title);
    estimateFingering(fresh.notes);
    const upgraded: Song = { ...fresh, id: song.id, title: song.title, addedAt: song.addedAt, sourceKind: song.sourceKind, hasRecording: song.hasRecording };
    await db.saveSong(upgraded);
    return upgraded;
  } catch (e) {
    console.warn('Could not re-read song', e);
    return song;
  }
}

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'library' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().then(() => {
      setReady(true);
      initDevices().catch((e) => console.warn(e));
    });
    // Browsers only allow audio after a user gesture.
    const unlock = () => {
      ensureAudio().catch((e) => console.warn('Audio init failed', e));
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }, []);

  if (!ready) return <div className="main muted">Loading…</div>;

  // Reload the song from storage when going back to setup so edits (hands) are reflected.
  const nav: Navigate = (r) => {
    if (r.name === 'setup') {
      db.getSong(r.song.id)
        .then((s) => upgradeSong(s ?? r.song))
        .then((s) => setRoute({ name: 'setup', song: s }))
        .catch(() => setRoute(r));
      return;
    }
    setRoute(r);
  };

  if (route.name === 'play') return <Play key={route.lesson?.id ?? 'free'} song={route.song} lesson={route.lesson} nav={nav} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" role="button" onClick={() => nav({ name: 'library' })} style={{ cursor: 'pointer' }}>
          Key<span>Fall</span>
        </div>
        <nav className="row">
          <button className="link" onClick={() => nav({ name: 'library' })}>Songs</button>
          <button className="link" onClick={() => nav({ name: 'games' })}>Games</button>
          <button className="link" onClick={() => nav({ name: 'settings' })}>Settings</button>
          <button className="link" onClick={() => nav({ name: 'calibrate' })}>Calibrate</button>
          <button className="link" onClick={() => nav({ name: 'lumi' })}>LUMI test</button>
        </nav>
        <div className="spacer" />
        <DeviceBadge />
      </header>
      <SysexFix compact />
      <KeyboardMismatch compact />
      <main className="main">
        {route.name === 'library' && <Library nav={nav} />}
        {route.name === 'setup' && <Setup key={route.song.id} song={route.song} nav={nav} />}
        {route.name === 'results' && <Results song={route.song} results={route.results} lesson={route.lesson} nav={nav} />}
        {route.name === 'settings' && <Settings nav={nav} />}
        {route.name === 'calibrate' && <Calibrate nav={nav} />}
        {route.name === 'lumi' && <LumiTest />}
        {route.name === 'games' && <Games />}
        {route.name === 'edit' && <Editor key={route.song.id} song={route.song} nav={nav} />}
        {route.name === 'audio' && <AudioReview raw={route.raw} duration={route.duration} recording={route.recording} title={route.title} nav={nav} />}
      </main>
    </div>
  );
}

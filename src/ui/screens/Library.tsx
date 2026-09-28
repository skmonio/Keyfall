import { useEffect, useRef, useState } from 'react';
import { detectKind, importFile, isSheetScan } from '../../importers';
import { parseMidi } from '../../importers/midi';
import { parseMusicXml, readMusicXmlText } from '../../importers/musicxml';
import { groupNumbered, mergedTitle, mergeMusicXml } from '../../importers/merge';
import { estimateFingering } from '../../model/fingering';
import type { Song } from '../../model/song';
import { db } from '../../storage/db';
import { createBlankSong, KEY_SIGNATURES } from '../../model/blank';
import { EXERCISES, makeExercise, type ExerciseInfo } from '../../content/exercises';
import type { Navigate } from '../App';

interface Sample {
  file: string;
  title: string;
  composer: string;
  level: string;
  format: string;
}

export function Library({ nav }: { nav: Navigate }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [error, setError] = useState<string>();
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string }>();
  // "Write your own": a blank score to fill in with the note editor.
  const [writing, setWriting] = useState<{ title: string; composer: string; time: string; fifths: number; bpm: number; bars: number }>();
  const startWriting = async () => {
    if (!writing) return;
    const [beats, beatType] = writing.time.split('/').map(Number);
    const song = createBlankSong({ ...writing, beats, beatType });
    await db.saveSong(song);
    setWriting(undefined);
    nav({ name: 'edit', song });
  };

  const saveRename = async () => {
    if (!renaming) return;
    const song = songs.find((x) => x.id === renaming.id);
    const title = renaming.title.trim();
    setRenaming(undefined);
    if (!song || !title || title === song.title) return;
    await db.saveSong({ ...song, title });
    refresh();
  };

  const refresh = () => db.listSongs().then(setSongs).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    fetch(`${import.meta.env.BASE_URL}songs/index.json`)
      .then((r) => r.json())
      .then(setSamples)
      .catch(() => setSamples([]));
  }, []);

  /**
   * Several files at once: MusicXML files named alike but numbered (Song 1, Song 2 …) are joined
   * into one song in number order; everything else is imported one by one.
   */
  const handleFiles = async (list: File[]) => {
    if (list.length === 1) return handleFile(list[0]);
    setError(undefined);
    const xmlFiles = list.filter((f) => detectKind(f.name) === 'musicxml');
    const others = list.filter((f) => detectKind(f.name) === 'midi');
    const skipped = list.filter((f) => !xmlFiles.includes(f) && !others.includes(f));
    const made: Song[] = [];
    const notes: string[] = [];
    try {
      for (const group of groupNumbered(xmlFiles)) {
        if (group.length === 1) {
          setBusy(`Importing ${group[0].name}…`);
          made.push(await importFile(group[0]));
          continue;
        }
        setBusy(`Joining ${group.length} files into one song…`);
        const texts = await Promise.all(group.map((f) => readMusicXmlText(f)));
        const title = mergedTitle(group[0].name);
        const song = parseMusicXml(mergeMusicXml(texts), title);
        song.title = title;
        estimateFingering(song.notes);
        made.push(song);
        notes.push(`Joined ${group.map((f) => f.name).join(', ')} into "${title}".`);
      }
      for (const f of others) {
        setBusy(`Importing ${f.name}…`);
        made.push(await importFile(f));
      }
      for (const s of made) await db.saveSong(s);
      if (skipped.length) notes.push(`Recordings are imported one at a time, and PDFs/photos can't be read: skipped ${skipped.map((f) => f.name).join(', ')}.`);
      if (made.length === 1 && !skipped.length) return nav({ name: 'setup', song: made[0] });
      refresh();
      setBusy(undefined);
      setInfo([`Imported ${made.length} song${made.length === 1 ? '' : 's'}.`, ...notes].join(' '));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const handleFile = async (file: File) => {
    setError(undefined);
    const kind = detectKind(file.name);
    if (!kind) {
      setError(
        isSheetScan(file.name)
          ? `KeyFall can't read PDFs or photos of sheet music. Convert "${file.name}" to MusicXML first with a music-scanning app (e.g. PlayScore 2, ScanScore or Soundslice), then import the .musicxml/.mxl file here.`
          : `"${file.name}" isn't a supported file. Use MusicXML (.musicxml, .mxl, .xml), MIDI (.mid), or audio (MP3, WAV, M4A…).`,
      );
      return;
    }
    try {
      if (kind === 'audio') {
        setBusy(`Listening to ${file.name} and working out the notes… 0%`);
        const { transcribeAudio } = await import('../../importers/audio');
        const r = await transcribeAudio(await file.arrayBuffer(), (p) =>
          setBusy(`Listening to ${file.name} and working out the notes… ${Math.round(p * 100)}%`),
        );
        nav({ name: 'audio', raw: r.notes, duration: r.duration, recording: file, title: file.name.replace(/\.[^.]+$/, '') });
        return;
      }
      setBusy(`Importing ${file.name}…`);
      const song = await importFile(file);
      await db.saveSong(song);
      nav({ name: 'setup', song });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const openSample = async (s: Sample) => {
    setError(undefined);
    setBusy(`Loading ${s.title}…`);
    try {
      const existing = songs.find((x) => x.title === s.title);
      if (existing) return nav({ name: 'setup', song: existing });
      const res = await fetch(`${import.meta.env.BASE_URL}songs/${s.file}`);
      if (!res.ok) throw new Error(`Could not load ${s.file}`);
      let song: Song;
      if (s.file.endsWith('.mid')) song = parseMidi(await res.arrayBuffer(), s.title);
      else song = parseMusicXml(await res.text(), s.title);
      song.title = s.title;
      estimateFingering(song.notes);
      await db.saveSong(song);
      nav({ name: 'setup', song });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const openExercise = async (e: ExerciseInfo) => {
    // Exercises have fixed ids, so progress and lessons carry over between visits.
    const existing = await db.getSong(`exercise:${e.id}`);
    const song = existing ?? makeExercise(e.id);
    if (!existing) await db.saveSong(song);
    nav({ name: 'setup', song });
  };
  const mySongs = songs.filter((s) => s.sourceKind !== 'exercise');

  const remove = async (song: Song) => {
    if (!confirm(`Remove "${song.title}" from your library?`)) return;
    await db.deleteSong(song.id);
    refresh();
  };

  return (
    <div className="page">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) handleFiles(files);
        }}
      >
        <h2>Add sheet music</h2>
        <div className="muted">
          Drop files here or click to choose (several at once is fine: numbered parts like "Song 1.mxl", "Song 2.mxl" are joined into one song). MusicXML (.musicxml / .mxl) works best. MIDI (.mid) works too. Audio (MP3, WAV, M4A…)
          is transcribed into notes in your browser; clear solo piano works best. PDFs and photos can't be read: convert them to MusicXML first with a music-scanning app, or search for the piece as MusicXML/MIDI (e.g. on MuseScore.com).
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".musicxml,.mxl,.xml,.mid,.midi,.mp3,.wav,.m4a,.aac,.ogg,.flac"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) handleFiles(files);
            e.target.value = '';
          }}
        />
      </div>
      {writing ? (
        <div className="card col">
          <h3 style={{ margin: 0 }}>Write your own music</h3>
          <div className="muted small">Start with empty bars, then add notes in the editor (click, or play them on your LUMI). KeyFall writes the sheet music as you go.</div>
          <div className="row" style={{ gap: 18, alignItems: 'flex-end' }}>
            <div className="field">
              <label>Title</label>
              <input type="text" autoFocus value={writing.title} onChange={(e) => setWriting({ ...writing, title: e.target.value })} />
            </div>
            <div className="field">
              <label>Composer (optional)</label>
              <input type="text" value={writing.composer} onChange={(e) => setWriting({ ...writing, composer: e.target.value })} />
            </div>
            <div className="field">
              <label>Time</label>
              <select value={writing.time} onChange={(e) => setWriting({ ...writing, time: e.target.value })}>
                {['4/4', '3/4', '2/4', '6/8', '2/2', '12/8'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Key</label>
              <select value={writing.fifths} onChange={(e) => setWriting({ ...writing, fifths: Number(e.target.value) })}>
                {KEY_SIGNATURES.map((k) => (
                  <option key={k.fifths} value={k.fifths}>{k.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tempo (bpm)</label>
              <input type="number" min={20} max={300} style={{ width: 80 }} value={writing.bpm} onChange={(e) => setWriting({ ...writing, bpm: Math.max(20, Math.min(300, Number(e.target.value) || 100)) })} />
            </div>
            <div className="field">
              <label>Bars</label>
              <input type="number" min={1} max={200} style={{ width: 70 }} value={writing.bars} onChange={(e) => setWriting({ ...writing, bars: Math.max(1, Math.min(200, Number(e.target.value) || 8)) })} />
            </div>
          </div>
          <div className="row">
            <button onClick={() => setWriting(undefined)}>Cancel</button>
            <button className="primary" onClick={startWriting}>Start writing</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button onClick={() => setWriting({ title: 'My song', composer: '', time: '4/4', fifths: 0, bpm: 90, bars: 8 })}>✍️ Write your own music</button>
          <span className="muted small">Make sheet music from scratch in the note editor.</span>
        </div>
      )}
      {busy && <div className="notice">{busy}</div>}
      {info && !busy && <div className="notice" style={{ color: 'var(--good)', borderColor: '#065f46' }}>{info}</div>}
      {error && <div className="error">{error}</div>}

      {mySongs.length > 0 && (
        <section className="col">
          <h3>Your songs</h3>
          <div className="grid">
            {mySongs.map((s) => (
              <div key={s.id} className="card song-card">
                {renaming?.id === s.id ? (
                  <input
                    type="text"
                    autoFocus
                    value={renaming.title}
                    onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') setRenaming(undefined);
                    }}
                    onBlur={saveRename}
                  />
                ) : (
                  <div className="title">{s.title}</div>
                )}
                <div className="muted small">
                  {s.composer ? `${s.composer} · ` : ''}
                  {s.measures.length} bars · {Math.round(s.duration)}s · {s.sourceKind.toUpperCase()}
                </div>
                <div className="row">
                  <button className="primary" onClick={() => nav({ name: 'setup', song: s })}>Practise</button>
                  <div className="spacer" />
                  <button className="link" onClick={() => setRenaming({ id: s.id, title: s.title })}>Rename</button>
                  <button className="link danger" onClick={() => remove(s)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="col">
        <div className="row">
          <h3 style={{ margin: 0 }}>Exercises &amp; games</h3>
          <span className="small muted">Scales, arpeggios and chords with standard fingering, playable in every mode</span>
        </div>
        <div className="grid">
          {[...new Set(EXERCISES.map((e) => e.category))].map((cat) => (
            <div key={cat} className="card song-card">
              <div className="title">{cat}</div>
              <div className="col" style={{ gap: 4 }}>
                {EXERCISES.filter((e) => e.category === cat).map((e) => (
                  <button key={e.id} className="link" style={{ textAlign: 'left' }} title={e.description} onClick={() => openExercise(e)}>
                    {e.title} <span className="muted small">· {e.level}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="card song-card">
            <div className="title">Games</div>
            <div className="muted small">Learn to read notes and find keys, one minute at a time.</div>
            <div className="row">
              <button className="primary" onClick={() => nav({ name: 'games' })}>Play a game</button>
            </div>
          </div>
        </div>
      </section>

      <section className="col">
        <h3>Public-domain test pieces</h3>
        <div className="grid">
          {samples.map((s) => (
            <div key={s.file} className="card song-card">
              <div className="title">{s.title}</div>
              <div className="muted small">
                {s.composer} · {s.level}
              </div>
              <div>
                <span className="pill">{s.format}</span>
              </div>
              <div className="row">
                <button onClick={() => openSample(s)}>Open</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card small muted">
        No MIDI keyboard? Play with the computer keyboard: <span className="kbd">A</span> = C,{' '}
        <span className="kbd">W</span> = C#, <span className="kbd">S</span> = D … <span className="kbd">K</span> = next C.{' '}
        <span className="kbd">Z</span>/<span className="kbd">X</span> change octave. Space pauses, Esc exits.
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { estimateTempo, cleanNotes, songFromTranscription, type RawNote } from '../../importers/audio';
import { estimateFingering } from '../../model/fingering';
import { pitchName, pitchRange } from '../../model/song';
import { db } from '../../storage/db';
import type { Navigate } from '../App';

/** Review step after transcribing a recording: set tempo, metre and hand split before saving. */
export function AudioReview({ raw, duration, recording, title: initialTitle, nav }: { raw: RawNote[]; duration: number; recording: Blob; title: string; nav: Navigate }) {
  const detected = useMemo(() => estimateTempo(cleanNotes(raw).map((n) => n.start)), [raw]);
  const [title, setTitle] = useState(initialTitle);
  const [bpm, setBpm] = useState(detected.bpm);
  const [beats, setBeats] = useState(4);
  const [split, setSplit] = useState(60);
  const [keep, setKeep] = useState(true);
  const [echoes, setEchoes] = useState(true);
  const [error, setError] = useState<string>();

  const song = useMemo(() => {
    try {
      setError(undefined);
      return songFromTranscription(raw, duration, { title, bpm, firstBeat: detected.phase, beats, split, removeEchoes: echoes });
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    }
  }, [raw, duration, title, bpm, beats, split, echoes, detected.phase]);

  const save = async () => {
    if (!song) return;
    estimateFingering(song.notes);
    song.hasRecording = keep;
    await db.saveSong(song);
    if (keep) await db.saveRecording(song.id, recording);
    nav({ name: 'setup', song });
  };

  const [lo, hi] = song ? pitchRange(song.notes) : [60, 60];
  const lh = song?.notes.filter((n) => n.hand === 'L').length ?? 0;
  const chordy = song ? song.notes.length / Math.max(1, new Set(song.notes.map((n) => Math.round(n.start * 20))).size) : 0;

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="row">
        <h1 className="grow" style={{ margin: 0 }}>Check the transcription</h1>
        <button onClick={() => nav({ name: 'library' })}>Discard</button>
        <button className="primary" disabled={!song} onClick={save}>Save and practise</button>
      </div>
      <div className="notice">
        Notes were worked out from the recording by Spotify's Basic Pitch model. It works best on clear solo piano. Expect some wrong, missing or
        extra notes, especially in fast or loud passages. If you can find the piece as MIDI or MusicXML, that will be much more accurate.
      </div>
      {error && <div className="error">{error}</div>}
      {song && (
        <div className="card col">
          <div className="small">
            {Math.round(duration)}s of audio · <b>{song.notes.length}</b> notes ({song.notes.length - lh} right / {lh} left) · range {pitchName(lo)}–{pitchName(hi)} ·{' '}
            {song.measures.length} bars
          </div>
          <div className="row" style={{ gap: 24 }}>
            <div className="field">
              <label>Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="field">
              <label>Tempo (bpm), detected {detected.bpm}</label>
              <div className="row">
                <input type="number" min={30} max={260} step={0.5} value={bpm} onChange={(e) => setBpm(Math.max(30, Number(e.target.value) || detected.bpm))} />
                <button onClick={() => setBpm((b) => Math.round(b * 2 * 2) / 2)} title="If the bars look twice as long as they should">×2</button>
                <button onClick={() => setBpm((b) => Math.round((b / 2) * 2) / 2)} title="If the bars look half as long as they should">÷2</button>
              </div>
            </div>
            <div className="field">
              <label>Beats per bar</label>
              <select value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
                {[2, 3, 4, 6].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Split hands at</label>
              <select value={split} onChange={(e) => setSplit(Number(e.target.value))}>
                {Array.from({ length: 25 }, (_, i) => 48 + i).map((p) => (
                  <option key={p} value={p}>{pitchName(p)}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="row small" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={echoes} onChange={(e) => setEchoes(e.target.checked)} />
            Remove "octave echoes" (ghost notes an octave above louder ones, from overtones). Turn off if the music has lots of played octaves.
          </label>
          <label className="row small" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            Keep the recording and play it as the backing track (Performance mode, Full sound). It's stored only in this browser.
          </label>
          <div className="small muted">
            Tempo and bar lines only affect the bar numbers, the metronome and loops. The notes stay exactly where they are in the recording.
            {chordy > 3 && ' This recording has a lot of simultaneous notes. If it is a full band or orchestral mix, the result may not be very playable.'}
          </div>
        </div>
      )}
    </div>
  );
}

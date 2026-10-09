import { useEffect, useMemo, useState } from 'react';
import type { SessionResults } from '../../engine/session';
import { sectionFor, type AudioMode, type GameMode, type HandsMode } from '../../engine/settings';
import { estimateFingering } from '../../model/fingering';
import { resetHandsByStaff, setHandForMeasures, splitHandsAt } from '../../model/hands';
import { pitchName, type Song } from '../../model/song';
import { db, personalBest } from '../../storage/db';
import type { Navigate } from '../App';
import { ScoreView } from '../ScoreView';
import { generateMusicXml } from '../../importers/notation';
import { KeyboardStrip } from '../KeyboardStrip';
import { SongProgress } from '../SongProgress';
import { LessonCard } from '../LessonCard';
import { Seg } from '../Seg';
import { InstrumentSelect } from '../InstrumentSelect';
import { computeFit, lumiCanMove } from '../fit';
import { KEYBOARDS, type KeyboardKind } from '../../model/fit';
import { activeHands } from '../../engine/settings';
import { updateSettings, useDevices, useSettings } from '../services';

export function Setup({ song: initial, nav }: { song: Song; nav: Navigate }) {
  const settings = useSettings();
  const p = settings.play;
  const [song, setSong] = useState(initial);
  const [results, setResults] = useState<SessionResults[]>([]);
  const [split, setSplit] = useState(60);
  const [message, setMessage] = useState<string>();
  const [editingTitle, setEditingTitle] = useState<string>();
  const saveTitle = async () => {
    const title = editingTitle?.trim();
    setEditingTitle(undefined);
    if (!title || title === song.title) return;
    const s = { ...song, title };
    await db.saveSong(s);
    setSong(s);
  };
  const nBars = song.measures.length;
  const sec = sectionFor(p, song.id, nBars);
  const from = sec?.fromMeasure ?? 0;
  const to = sec?.toMeasure ?? nBars - 1;

  useEffect(() => {
    db.resultsFor(song.id).then(setResults).catch(() => setResults([]));
  }, [song.id]);

  // Sheet music: MusicXML songs have a score; for MIDI/audio one is generated (if that works).
  const canSheet = useMemo(() => {
    if (song.musicXml) return true;
    try {
      return generateMusicXml(song).length > 0;
    } catch {
      return false;
    }
  }, [song]);
  const devices = useDevices();
  const lumiConnected = devices.inputs.some((i) => i.isLumi);
  const fit = computeFit(song, settings, lumiConnected, lumiCanMove(settings, devices.sysex));
  const { plan, spec } = fit;
  const moveKeyboard = (octaves: number) =>
    setPlay((pl) => {
      const lo = Math.max(0, Math.min(108, plan.lo + octaves * 12));
      pl.keyboardPos = { songId: song.id, lo, source: 'manual' };
    });

  const setPlay = (fn: (pl: typeof p) => void) => updateSettings((s) => fn(s.play));
  const setRange = (f: number, t: number) =>
    setPlay((pl) => {
      const a = Math.max(0, Math.min(f, nBars - 1));
      const b = Math.max(a, Math.min(t, nBars - 1));
      pl.section = a === 0 && b === nBars - 1 ? null : { fromMeasure: a, toMeasure: b };
      pl.sectionSongId = song.id;
    });

  const editHands = async (fn: (s: Song) => void, what: string) => {
    const s = structuredClone(song);
    fn(s);
    estimateFingering(s.notes);
    await db.saveSong(s);
    setSong(s);
    setMessage(what);
  };

  const mine = song.notes.filter((n) => !n.backing);
  const lh = mine.filter((n) => n.hand === 'L').length;
  const rh = mine.length - lh;
  const backingParts = (song.parts ?? []).filter((p) => p.role === 'backing').map((p) => p.name);
  const melodyOnly = (song.parts?.length ?? 0) === 1 && song.parts![0].role === 'melody';
  const scoreFingers = song.notes.filter((n) => n.fingerSource === 'score').length;
  const best = personalBest(results, p.mode, p.hands);
  const ORD = ['', '', '2nd', '3rd', '4th', '5th'];
  const barLabel = (i: number) => {
    const m = song.measures[i];
    const pass = m?.pass ?? 1;
    if (m?.number === 0) return 'Pickup';
    return `Bar ${m?.number ?? i + 1}${pass > 1 ? ` (${ORD[pass] ?? `${pass}th`} time)` : ''}`;
  };
  // The score preview shows written bars: with repeats, the span of written bars in the section.
  const writtenSpan = (() => {
    const ws = song.measures.slice(from, to + 1).map((m, k) => m.writtenIndex ?? from + k);
    return ws.length ? [Math.min(...ws) + 1, Math.max(...ws) + 1] : [from + 1, to + 1];
  })();
  const repeats = song.measures.some((m) => (m.pass ?? 1) > 1);

  return (
    <div className="page">
      <div className="row">
        <button onClick={() => nav({ name: 'library' })}>← Songs</button>
        <div className="grow">
          {editingTitle !== undefined ? (
            <input
              type="text"
              autoFocus
              style={{ fontSize: 20, fontWeight: 650, width: 'min(520px, 100%)' }}
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setEditingTitle(undefined);
              }}
              onBlur={saveTitle}
            />
          ) : (
            <h1 style={{ margin: 0 }}>
              {song.title}{' '}
              <button className="link" style={{ fontSize: 14 }} title="Rename" onClick={() => setEditingTitle(song.title)}>
                ✎ Rename
              </button>
            </h1>
          )}
          <div className="muted small">
            {song.composer ? `${song.composer} · ` : ''}
            {nBars} bars · {Math.round(song.tempos[0]?.bpm ?? 0)} bpm · {song.notes.length} notes ({rh} right, {lh} left)
            {scoreFingers ? ` · ${scoreFingers} fingerings from score` : ''}
            {melodyOnly && lh === 0 && ` · a single melody line (${song.parts![0].name}), so it's all right hand; use "Split at" below to share it between the hands`}
            {backingParts.length > 0 && ` · ${backingParts.join(', ')}: played as backing (in Full sound), not yours to play`}
          </div>
        </div>
        <button onClick={() => nav({ name: 'edit', song })} title="Add, remove or fix notes">
          ✏️ Edit notes
        </button>
        <button className="primary" style={{ fontSize: 16, padding: '10px 24px' }} onClick={() => nav({ name: 'play', song })}>
          ▶ Play
        </button>
      </div>

      <LessonCard song={song} onStart={(lesson) => nav({ name: 'play', song, lesson })} />

      <div className="card col">
        <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
          <div className="field">
            <label>Mode</label>
            <Seg<GameMode>
              value={p.mode}
              options={[
                ['wait', 'Wait (practice)'],
                ['performance', 'Performance'],
              ]}
              onChange={(v) => setPlay((pl) => (pl.mode = v))}
            />
          </div>
          <div className="field">
            <label>View</label>
            <Seg<'falling' | 'sheet'>
              value={canSheet ? p.view : 'falling'}
              options={canSheet ? [
                ['falling', 'Falling notes'],
                ['sheet', 'Sheet music'],
              ] : [['falling', 'Falling notes']]}
              onChange={(v) => setPlay((pl) => (pl.view = v))}
            />
            {canSheet && !song.musicXml && song.sourceKind !== 'exercise' && p.view === 'sheet' && <span className="small muted">Score generated from the {song.sourceKind === 'audio' ? 'recording' : 'MIDI'}</span>}
            {canSheet && p.view === 'sheet' && (
              <select value={p.sheet.layout} onChange={(e) => setPlay((pl) => (pl.sheet.layout = e.target.value as typeof p.sheet.layout))}>
                <option value="scroll">One scrolling line</option>
                <option value="lines">Two lines at a time</option>
                <option value="page">Whole sheet</option>
              </select>
            )}
          </div>
          <div className="field">
            <label>Hands</label>
            <Seg<HandsMode>
              value={p.hands}
              options={[
                ['left', 'Left'],
                ['both', 'Both'],
                ['right', 'Right'],
              ]}
              onChange={(v) => setPlay((pl) => (pl.hands = v))}
            />

          </div>
          <div className="field">
            <label>Sound</label>
            <Seg<AudioMode>
              value={p.audio}
              options={[
                ['full', 'Full'],
                ['mine', 'My hand'],
                ['metronome', 'Metro'],
                ['silent', 'Silent'],
              ]}
              onChange={(v) => setPlay((pl) => (pl.audio = v))}
            />
            <InstrumentSelect />
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label>Speed: {Math.round(p.speed * 100)}%</label>
            <input type="range" min={25} max={150} step={5} value={Math.round(p.speed * 100)} onChange={(e) => setPlay((pl) => (pl.speed = Number(e.target.value) / 100))} />
          </div>
        </div>

        <div className="row" style={{ gap: 24 }}>
          <div className="field">
            <label>Section</label>
            <div className="row">
              <select value={from} onChange={(e) => setRange(Number(e.target.value), Math.max(to, Number(e.target.value)))}>
                {song.measures.map((m) => (
                  <option key={m.index} value={m.index}>{barLabel(m.index)}</option>
                ))}
              </select>
              to
              <select value={to} onChange={(e) => setRange(Math.min(from, Number(e.target.value)), Number(e.target.value))}>
                {song.measures.map((m) => (
                  <option key={m.index} value={m.index}>{barLabel(m.index)}</option>
                ))}
              </select>
              {sec && <button className="link" onClick={() => setRange(0, nBars - 1)}>Whole song</button>}
            </div>
          </div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.loop} onChange={(e) => setPlay((pl) => (pl.loop = e.target.checked))} />
            Loop A–B
          </label>
          <label className="row small" style={{ gap: 6, opacity: p.loop ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!p.loop} checked={p.speedUpOnClean} onChange={(e) => setPlay((pl) => (pl.speedUpOnClean = e.target.checked))} />
            +5% speed after each clean run
          </label>
          <label className="row small" style={{ gap: 6 }} title="Play your own part quietly as each note comes up, so you hear what to play next">
            <input type="checkbox" checked={p.hearMyNotes !== false} onChange={(e) => setPlay((pl) => (pl.hearMyNotes = e.target.checked))} />
            Hear my notes (guide)
          </label>
          <label className="row small" style={{ gap: 6 }} title="Show the note after the one to play now: faded on the keyboard, in its own colour on the LUMI">
            <input type="checkbox" checked={p.showNextNotes} onChange={(e) => setPlay((pl) => (pl.showNextNotes = e.target.checked))} />
            Show next notes
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.showNoteNames} onChange={(e) => setPlay((pl) => (pl.showNoteNames = e.target.checked))} />
            Show note names
          </label>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.showFingers} onChange={(e) => setPlay((pl) => (pl.showFingers = e.target.checked))} />
            Show finger numbers
          </label>
          {song.hasRecording && (
            <label className="row small" style={{ gap: 6 }} title="Performance mode with Full sound. Wait mode uses the piano sound, because it stops at every chord.">
              <input type="checkbox" checked={p.useRecording} onChange={(e) => setPlay((pl) => (pl.useRecording = e.target.checked))} />
              Play the original recording (Performance + Full)
            </label>
          )}
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={p.countIn} onChange={(e) => setPlay((pl) => (pl.countIn = e.target.checked))} />
            Count-in
          </label>
        </div>
        {best && (
          <div className="small muted">
            Personal best ({p.mode}, {p.hands} hands): <b style={{ color: 'var(--text)' }}>{best.score.toLocaleString()}</b> ·{' '}
            {Math.round(best.accuracy * 100)}% · {'★'.repeat(best.stars)} at {Math.round(best.speed * 100)}% speed
          </div>
        )}
      </div>


      <div className="card col">
        <div className="row">
          <h3 style={{ margin: 0 }}>Your keyboard</h3>
          <select value={settings.keyboard} onChange={(e) => updateSettings((x) => (x.keyboard = e.target.value as KeyboardKind))}>
            <option value="auto">Auto ({lumiConnected ? 'LUMI detected: 24 keys' : 'no LUMI: 88 keys'})</option>
            {Object.values(KEYBOARDS).map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
          {spec.keys < 88 && (
            <>
              <button onClick={() => moveKeyboard(-1)} disabled={plan.lo <= (spec.lumi ? 0 : 12)} title="Move down an octave">◀ Octave</button>
              <button onClick={() => moveKeyboard(1)} disabled={plan.lo >= 108} title="Move up an octave">Octave ▶</button>
              {plan.manual && (
                <button className="link" onClick={() => setPlay((pl) => (pl.keyboardPos = undefined))}>
                  {p.keyboardPos?.source === 'detected' ? 'Detected from your keys · reset to auto' : 'Auto position'}
                </button>
              )}
            </>
          )}
        </div>
        <KeyboardStrip notes={song.notes} lo={plan.lo} hi={plan.hi} colors={settings.colors} hands={activeHands(p.hands)} />
        {spec.keys >= 88 ? (
          <div className="small muted">The whole piano is available, so the song plays as written.</div>
        ) : (
          <div className="col small" style={{ gap: 4 }}>
            <div>
              Keyboard position: <b>{pitchName(plan.lo)}–{pitchName(plan.hi)}</b>
              {spec.lumi && plan.lumiOctave !== undefined && (
                <>
                  {' '}(LUMI octave {plan.lumiOctave > 0 ? '+' : ''}{plan.lumiOctave}
                  {lumiCanMove(settings, devices.sysex) && lumiConnected
                    ? ', set automatically when you press Play)'
                    : !plan.manual && settings.lumiBase === plan.lo && lumiConnected
                      ? ': where your LUMI is now)'
                    : `: ${plan.lumiOctave === 0 ? 'the default octave' : `press the LUMI's octave ${plan.lumiOctave > 0 ? '▲' : '▼'} button ${Math.abs(plan.lumiOctave)}× from the default`})`}
                </>
              )}
              . The song needs {pitchName(plan.songLo)}–{pitchName(plan.songHi)} ({plan.songHi - plan.songLo + 1} keys) for {p.hands === 'both' ? 'both hands' : `the ${p.hands} hand`}.
            </div>
            {plan.fitsAsWritten ? (
              <div style={{ color: 'var(--good)' }}>✓ Fits your keyboard as written.</div>
            ) : (
              <>
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={p.fitToKeyboard} onChange={(e) => setPlay((pl) => (pl.fitToKeyboard = e.target.checked))} />
                  Fit the song to my keyboard
                </label>
                {p.fitToKeyboard ? (
                  <div className="notice">
                    {[
                      plan.shift.L ? `left hand moved ${plan.shift.L > 0 ? 'up' : 'down'} ${Math.abs(plan.shift.L / 12)} octave${Math.abs(plan.shift.L) > 12 ? 's' : ''}` : '',
                      plan.shift.R ? `right hand moved ${plan.shift.R > 0 ? 'up' : 'down'} ${Math.abs(plan.shift.R / 12)} octave${Math.abs(plan.shift.R) > 12 ? 's' : ''}` : '',
                      plan.folded ? `${plan.folded} note${plan.folded > 1 ? 's' : ''} moved by an octave to stay on the keys` : '',
                      plan.collisions ? `${plan.collisions} place${plan.collisions > 1 ? 's' : ''} where both hands share a key (merged)` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                      .replace(/^./, (c) => c.toUpperCase())}
                    . The backing track still plays the notes as written.
                    {p.hands === 'both' && (plan.handFits.L || plan.handFits.R) && (
                      <>
                        {' '}Tip: this song is wider than your keyboard, so try one hand at a time:{' '}
                        {plan.handFits.R && <button className="link" onClick={() => setPlay((pl) => (pl.hands = 'right'))}>right hand</button>}
                        {plan.handFits.R && plan.handFits.L && ' or '}
                        {plan.handFits.L && <button className="link" onClick={() => setPlay((pl) => (pl.hands = 'left'))}>left hand</button>}
                        {' '}fits as written.
                      </>
                    )}
                  </div>
                ) : (
                  <div className="muted">Notes outside {pitchName(plan.lo)}–{pitchName(plan.hi)} won't be playable on your keyboard.</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="card col">
        <h3>Your progress</h3>
        <SongProgress
          results={results}
          onPracticeBar={(bar) => {
            const idx = song.measures.findIndex((m) => m.number === bar);
            if (idx < 0) return;
            setPlay((pl) => {
              pl.section = { fromMeasure: idx, toMeasure: idx };
              pl.sectionSongId = song.id;
              pl.loop = true;
              pl.mode = 'wait';
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      </div>

      <div className="card col">
        <h3>Hands &amp; fingering</h3>
        <div className="small muted">
          Treble staff = right hand (<span className="swatch" style={{ background: settings.colors.R }} />), bass staff = left hand (
          <span className="swatch" style={{ background: settings.colors.L }} />
          ). Changes apply to the selected section ({barLabel(from)}–{barLabel(to).replace('Bar ', '')}). You can also pause during play and click a
          falling note to switch its hand.
        </div>
        <div className="row">
          <button onClick={() => editHands((s) => setHandForMeasures(s, from, to, 'R'), 'Section set to right hand.')}>Section → right hand</button>
          <button onClick={() => editHands((s) => setHandForMeasures(s, from, to, 'L'), 'Section set to left hand.')}>Section → left hand</button>
          <span className="muted">or split at</span>
          <select value={split} onChange={(e) => setSplit(Number(e.target.value))}>
            {Array.from({ length: 49 }, (_, i) => 36 + i).map((pp) => (
              <option key={pp} value={pp}>{pitchName(pp)}</option>
            ))}
          </select>
          <button onClick={() => editHands((s) => splitHandsAt(s.notes, split, from, to), `Split at ${pitchName(split)}.`)}>Split</button>
          <button onClick={() => editHands((s) => resetHandsByStaff(s.notes), 'Hands reset to staves.')} disabled={!song.notes.some((n) => n.staff !== undefined)}>
            Reset to staves
          </button>
          <button onClick={() => editHands(() => {}, 'Fingering re-estimated.')}>Re-estimate fingering</button>
        </div>
        {message && <div className="small" style={{ color: 'var(--good)' }}>{message}</div>}
      </div>

      {song.musicXml ? (
        <div className="card col">
          <h3>Score {sec ? `(${barLabel(from)}–${song.measures[to]?.number ?? to + 1})` : ''}</h3>
          {repeats && <div className="small muted">This score has repeats: KeyFall plays them in order ({song.measures.length} bars played in total).</div>}
          <ScoreView xml={song.musicXml} from={writtenSpan[0]} to={writtenSpan[1]} />
        </div>
      ) : (
        <div className="card small muted">
          {song.sourceKind === 'exercise' ? 'Switch the view to Sheet music to read this exercise from the score.' : 'No score preview for MIDI and audio songs. Pick bars by number above, or switch the view to Sheet music to read a generated score.'}
        </div>
      )}
    </div>
  );
}

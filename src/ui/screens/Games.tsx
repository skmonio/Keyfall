import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { finderPool, isCorrect, pick, questionXml, READER_LEVELS, readerPool, spelledName, type Clef, type Question, type ReaderLevel } from '../../games/notes';
import { LightsDirector } from '../../midi/lightsDirector';
import { isBlack, pitchName } from '../../model/song';
import { db } from '../../storage/db';
import { PianoKeys } from '../PianoKeys';
import { ensureAudio, getLumi, getSettings, input, piano, useDevices, onLumiChanged } from '../services';
import { Seg } from '../Seg';

type Game = 'reader' | 'finder';
const ROUND_SEC = 60;

interface Options {
  clef: Clef;
  level: ReaderLevel;
  anyOctave: boolean;
  blackKeys: boolean;
}

interface Summary {
  correct: number;
  wrong: number;
  avgMs: number;
  bestStreak: number;
  best?: number;
  isBest: boolean;
}

const bestKey = (g: Game, o: Options) => (g === 'reader' ? `games:best:reader:${o.clef}:${o.level}:${o.anyOctave ? 'any' : 'exact'}` : `games:best:finder:${o.blackKeys ? 'all' : 'white'}`);

export function Games() {
  const devices = useDevices();
  const lumi = devices.inputs.some((i) => i.isLumi);
  const [game, setGame] = useState<Game>();
  const [opts, setOpts] = useState<Options>({ clef: 'treble', level: 1, anyOctave: lumi, blackKeys: false });
  const [bests, setBests] = useState<Record<string, number>>({});
  useEffect(() => {
    (async () => {
      const b: Record<string, number> = {};
      for (const g of ['reader', 'finder'] as Game[]) {
        const v = await db.getKv<number>(bestKey(g, opts));
        if (v !== undefined) b[g] = v;
      }
      setBests(b);
    })();
  }, [opts, game]);

  if (game) return <Round game={game} opts={opts} onExit={() => setGame(undefined)} />;

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1>Games</h1>
      <div className="muted">One-minute rounds. Play on your keyboard, the computer keyboard, or click the keys on screen.</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        <div className="card col">
          <h2>🎼 Note Reader</h2>
          <div className="muted small">A note appears on the staff. Play it. Learn to read music without thinking about it.</div>
          <div className="field">
            <label>Clef</label>
            <Seg<Clef> value={opts.clef} options={[['treble', 'Treble (right hand)'], ['bass', 'Bass (left hand)'], ['both', 'Both']]} onChange={(clef) => setOpts({ ...opts, clef })} />
          </div>
          <div className="field">
            <label>Level</label>
            <select value={opts.level} onChange={(e) => setOpts({ ...opts, level: Number(e.target.value) as ReaderLevel })}>
              {([1, 2, 3, 4] as ReaderLevel[]).map((l) => (
                <option key={l} value={l}>
                  {l}. {READER_LEVELS[l].name} – {READER_LEVELS[l].description}
                </option>
              ))}
            </select>
          </div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={opts.anyOctave} onChange={(e) => setOpts({ ...opts, anyOctave: e.target.checked })} />
            Any octave counts (handy on a 24-key LUMI)
          </label>
          <div className="row">
            <button className="primary" onClick={() => setGame('reader')}>Play</button>
            {bests.reader !== undefined && <span className="small muted">Best: {bests.reader} notes</span>}
          </div>
        </div>
        <div className="card col">
          <h2>🎹 Key Finder</h2>
          <div className="muted small">A note name appears. Find that key, in any octave. Learn your way around the keyboard.</div>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={opts.blackKeys} onChange={(e) => setOpts({ ...opts, blackKeys: e.target.checked })} />
            Include black keys (♯ and ♭)
          </label>
          <div className="row">
            <button className="primary" onClick={() => setGame('finder')}>Play</button>
            {bests.finder !== undefined && <span className="small muted">Best: {bests.finder} keys</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaffNote({ q }: { q: Question }) {
  const ref = useRef<HTMLDivElement>(null);
  const osmd = useRef<OpenSheetMusicDisplay | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!osmd.current) {
        const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
        if (!alive || !ref.current) return;
        osmd.current = new OpenSheetMusicDisplay(ref.current, {
          backend: 'svg',
          autoResize: false,
          drawTitle: false,
          drawPartNames: false,
          drawMeasureNumbers: false,
          drawTimeSignatures: false,
          drawCredits: false,
        });
        osmd.current.zoom = 2.2;
      }
      await osmd.current.load(questionXml(q));
      if (alive) osmd.current.render();
    })();
    return () => {
      alive = false;
    };
  }, [q]);
  return <div ref={ref} className="game-staff" />;
}

function Round({ game, opts, onExit }: { game: Game; opts: Options; onExit: () => void }) {
  const pool = useRef(game === 'reader' ? readerPool(opts.level, opts.clef) : finderPool(opts.blackKeys)).current;
  const anyOctave = game === 'finder' || opts.anyOctave;
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready');
  const [q, setQ] = useState<Question>(() => pick(pool));
  const [left, setLeft] = useState(ROUND_SEC);
  const [stats, setStats] = useState({ correct: 0, wrong: 0, streak: 0, bestStreak: 0, totalMs: 0 });
  const [hint, setHint] = useState<{ played: number; answer: number }>();
  const [colors, setColors] = useState(new Map<number, string>());
  const [summary, setSummary] = useState<Summary>();
  const asked = useRef(performance.now());
  const endAt = useRef(0);
  const state = useRef({ phase, q, stats });
  state.current = { phase, q, stats };
  const director = useRef<LightsDirector | undefined>(undefined);

  // Keyboard range on screen: the notes this game can ask, plus some room.
  const lo = Math.min(...pool.map((x) => x.pitch)) - (anyOctave ? 12 : 3);
  const hi = Math.max(...pool.map((x) => x.pitch)) + (anyOctave ? 12 : 3);
  let kbLo = Math.max(21, lo);
  while (isBlack(kbLo)) kbLo--;
  let kbHi = Math.min(108, hi);
  while (isBlack(kbHi)) kbHi++;

  useEffect(() => {
    const l = getLumi();
    const s = getSettings();
    director.current = new LightsDirector(l, s.colors, s.nextColors);
    const off = onLumiChanged(() => {
      const nl = getLumi();
      if (nl && getSettings().lumiAppMode) nl.setMode('app');
      director.current?.setLights(nl);
    });
    return () => {
      off();
      director.current?.clear();
    };
  }, []);

  const flashKey = (p: number, c: string) => {
    setColors((m) => new Map(m).set(p, c));
    setTimeout(() => setColors((m) => {
      const n = new Map(m);
      n.delete(p);
      return n;
    }), 350);
  };

  const answer = (p: number) => {
    const { phase: ph, q: cur, stats: st } = state.current;
    if (ph !== 'play') return;
    if (isCorrect(cur.pitch, p, anyOctave)) {
      const ms = performance.now() - asked.current;
      const streak = st.streak + 1;
      setStats({ ...st, correct: st.correct + 1, streak, bestStreak: Math.max(st.bestStreak, streak), totalMs: st.totalMs + ms });
      flashKey(p, '#16a34a');
      director.current?.flash(p, 'hit');
      director.current?.setTargets(new Map());
      setHint(undefined);
      const nq = pick(pool, cur);
      setQ(nq);
      asked.current = performance.now();
    } else {
      setStats({ ...st, wrong: st.wrong + 1, streak: 0 });
      flashKey(p, '#dc2626');
      director.current?.flash(p, 'wrong');
      // Show where the right key is (nearest octave to what was played, if any octave counts).
      const target = anyOctave ? cur.pitch + 12 * Math.round((p - cur.pitch) / 12) : cur.pitch;
      setHint({ played: p, answer: target });
      director.current?.setTargets(new Map([[target, { hand: cur.clef === 'bass' ? 'L' : 'R', role: 'now' as const }]]));
    }
  };

  useEffect(() => {
    const off = input.onKey((e) => {
      if (e.type === 'on') {
        piano.keyDown(e.pitch, e.velocity);
        answer(e.pitch);
      } else piano.keyUp(e.pitch);
    });
    return off;
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(async () => {
      const remaining = Math.max(0, (endAt.current - performance.now()) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        clearInterval(id);
        const st = state.current.stats;
        const key = bestKey(game, opts);
        const prev = await db.getKv<number>(key);
        const isBest = prev === undefined || st.correct > prev;
        if (isBest) await db.setKv(key, st.correct);
        if (isBest && st.correct > 0) piano.fanfare();
        director.current?.setTargets(new Map());
        setSummary({ correct: st.correct, wrong: st.wrong, avgMs: st.correct ? st.totalMs / st.correct : 0, bestStreak: st.bestStreak, best: prev, isBest });
        setPhase('done');
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  const start = async () => {
    await ensureAudio();
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0, totalMs: 0 });
    setHint(undefined);
    setQ(pick(pool));
    endAt.current = performance.now() + ROUND_SEC * 1000;
    asked.current = performance.now();
    setLeft(ROUND_SEC);
    setPhase('play');
  };

  const keyColors = new Map(colors);
  if (hint) keyColors.set(hint.answer, getSettings().colors[q.clef === 'bass' ? 'L' : 'R']);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="row">
        <button onClick={onExit}>← Games</button>
        <h1 className="grow" style={{ margin: 0 }}>{game === 'reader' ? '🎼 Note Reader' : '🎹 Key Finder'}</h1>
        {phase === 'play' && (
          <div className="row">
            <span className="pill">✓ {stats.correct}</span>
            <span className="pill">✗ {stats.wrong}</span>
            {stats.streak >= 3 && <span className="pill warn">🔥 {stats.streak} in a row</span>}
          </div>
        )}
      </div>
      <div className="lesson-bar">
        <div style={{ width: `${(left / ROUND_SEC) * 100}%`, background: left < 10 ? 'var(--warn)' : 'var(--accent)', transition: 'width 0.1s linear' }} />
      </div>

      <div className="card col" style={{ alignItems: 'center', minHeight: 260, justifyContent: 'center' }}>
        {phase === 'ready' && (
          <>
            <div className="muted">
              {game === 'reader' ? `Play each note you see. ${anyOctave ? 'Any octave counts.' : 'Play it in the octave shown.'}` : 'Play the key that has this name, in any octave.'} You have one minute.
            </div>
            <button className="primary" style={{ fontSize: 18, padding: '10px 28px' }} onClick={start}>Start</button>
          </>
        )}
        {phase === 'play' && (game === 'reader' ? <StaffNote q={q} /> : <div className="game-name">{spelledName(q.spelled)}</div>)}
        {phase === 'play' && hint && (
          <div className="small" style={{ color: 'var(--warn)' }}>
            You played {pitchName(hint.played)}. {game === 'reader' ? `This note is ${spelledName(q.spelled)}${anyOctave ? '' : q.spelled.octave}` : ''}: it's lit up below.
          </div>
        )}
        {phase === 'done' && summary && (
          <div className="col" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="big">{summary.correct}</div>
            <div className="muted">
              notes in a minute · {summary.correct + summary.wrong ? Math.round((summary.correct / (summary.correct + summary.wrong)) * 100) : 0}% right ·{' '}
              {(summary.avgMs / 1000).toFixed(1)}s per note · best streak {summary.bestStreak}
            </div>
            {summary.isBest ? <span className="pill ok">New best!</span> : <span className="pill">Best: {summary.best}</span>}
            <div className="row">
              <button className="primary" onClick={start}>Play again</button>
              <button onClick={onExit}>Other games</button>
            </div>
          </div>
        )}
      </div>
      <PianoKeys lo={kbLo} hi={kbHi} colors={keyColors} onPress={(p) => {
        piano.keyDown(p, 90);
        setTimeout(() => piano.keyUp(p), 300);
        answer(p);
      }} />
    </div>
  );
}

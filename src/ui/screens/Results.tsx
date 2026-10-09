import { useEffect, useState } from 'react';
import type { SessionResults } from '../../engine/session';
import type { Song } from '../../model/song';
import { db, personalBest } from '../../storage/db';
import type { Navigate } from '../App';
import { piano, updateSettings, useSettings } from '../services';
import { nextStep, passed, type LessonStep } from '../../model/lesson';
import { lessonSteps, recordStep, StarRow } from '../LessonCard';

export function Stars({ n }: { n: number }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? '' : 'off'}>★</span>
      ))}
    </div>
  );
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);

export function Results({ song, results: r, lesson, nav }: { song: Song; results: SessionResults; lesson?: LessonStep; nav: Navigate }) {
  const settings = useSettings();
  const [prevBest, setPrevBest] = useState<SessionResults | undefined>();
  const [history, setHistory] = useState<SessionResults[]>([]);

  useEffect(() => {
    db.resultsFor(song.id).then((all) => {
      setHistory(all);
      // Best among *earlier* runs, so we can say "new personal best".
      setPrevBest(personalBest(all.filter((x) => x.date !== r.date), r.mode, r.hands, r.section));
    });
  }, [song.id, r.date, r.mode, r.hands]);

  // Guided practice: did this run pass the step?
  const stepOk = lesson ? passed(lesson, r.accuracy) && r.hands === lesson.hands && r.speed >= lesson.speed - 1e-3 && !r.seeked : false;
  const [next, setNext] = useState<LessonStep | null>();
  useEffect(() => {
    if (!lesson) return;
    (async () => {
      // A run with the wrong hands or speed doesn't count towards the step's stars.
      const counts = r.hands === lesson.hands && r.speed >= lesson.speed - 1e-3 && !r.seeked;
      const progress = await recordStep(song.id, lesson.id, counts ? r.accuracy : 0, stepOk);
      if (stepOk) piano.fanfare();
      else piano.softFail();
      setNext(nextStep(lessonSteps(song, progress), progress) ?? null);
    })();
  }, [lesson?.id, stepOk]);
  const whyNot = !lesson || stepOk
    ? ''
    : r.seeked
      ? 'You skipped or replayed bars during this run.'
      : r.hands !== lesson.hands
        ? `This step is for ${lesson.hands === 'both' ? 'both hands' : `the ${lesson.hands} hand`}.`
        : r.speed < lesson.speed - 1e-3
          ? `This step needs ${Math.round(lesson.speed * 100)}% speed (you played at ${Math.round(r.speed * 100)}%).`
          : `You need ${Math.round(lesson.goal * 100)}% and got ${Math.round(r.accuracy * 100)}%. Nearly there!`;

  const isBest = !r.seeked && (!prevBest || r.score > prevBest.score);

  const practiseBar = (bar: number) => {
    const idx = song.measures.findIndex((m) => m.number === bar);
    if (idx < 0) return;
    updateSettings((s) => {
      s.play.section = { fromMeasure: Math.max(0, idx - 1), toMeasure: Math.min(song.measures.length - 1, idx + 1) };
      s.play.sectionSongId = song.id;
      s.play.loop = true;
      s.play.mode = 'wait';
    });
    nav({ name: 'setup', song });
  };

  const hands = (['R', 'L'] as const).filter((h) => (h === 'R' ? r.accuracyR : r.accuracyL) !== null);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      {lesson && (
        <div className="card col" style={{ borderColor: stepOk ? '#065f46' : '#78350f' }}>
          <div className="row" style={{ fontSize: 18, fontWeight: 650 }}>
            {stepOk ? '✓ Step passed!' : 'Not quite yet'} <StarRow accuracy={r.accuracy} size={18} />
          </div>
          <div className="muted">
            {lesson.group} · {lesson.title}. {stepOk ? `You reached the ${Math.round(lesson.goal * 100)}% goal.` : whyNot}
          </div>
          <div className="row">
            {stepOk && next && (
              <button className="primary" onClick={() => nav({ name: 'play', song, lesson: next })}>
                Next step: {next.group}, {next.title.toLowerCase()}
              </button>
            )}
            {stepOk && next === null && <span style={{ color: 'var(--good)' }}>🎉 That was the last step. You've learned the whole song!</span>}
            <button className={stepOk ? '' : 'primary'} onClick={() => nav({ name: 'play', song, lesson })}>
              {stepOk ? 'Play this step again' : 'Try again'}
            </button>
            <button onClick={() => nav({ name: 'setup', song })}>Back to the song</button>
          </div>
        </div>
      )}
      <div className="card col" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="muted">{song.title} · {r.section} · {r.mode === 'wait' ? 'Wait mode' : r.mode === 'free' ? 'Free play' : 'Performance'} · {Math.round(r.speed * 100)}% speed</div>
        <Stars n={r.stars} />
        <div className="big">{r.score.toLocaleString()}</div>
        {r.seeked ? (
          <span className="pill">You skipped or replayed bars, so this run doesn't count as a personal best</span>
        ) : isBest ? (
          <span className="pill ok">New personal best!</span>
        ) : (
          <span className="pill">Personal best: {prevBest!.score.toLocaleString()} ({pct(prevBest!.accuracy)})</span>
        )}
        <div className="row" style={{ justifyContent: 'center', gap: 30, marginTop: 8 }}>
          <div><div className="muted small">Accuracy</div><b style={{ fontSize: 22 }}>{pct(r.accuracy)}</b></div>
          <div><div className="muted small">Max combo</div><b style={{ fontSize: 22 }}>{r.maxCombo}</b></div>
          {r.loopPasses > 0 && <div><div className="muted small">Loop runs</div><b style={{ fontSize: 22 }}>{r.loopPasses}</b></div>}
        </div>
      </div>

      <div className="card">
        <h3>By hand</h3>
        <table>
          <thead>
            <tr><th>Hand</th><th>Accuracy</th><th>Perfect</th><th>Great</th><th>Good</th><th>Miss</th><th>Wrong keys</th></tr>
          </thead>
          <tbody>
            {hands.map((h) => {
              const c = r.counts[h];
              return (
                <tr key={h}>
                  <td><span className="swatch" style={{ background: settings.colors[h] }} /> {h === 'R' ? 'Right' : 'Left'}</td>
                  <td><b>{pct(h === 'R' ? r.accuracyR : r.accuracyL)}</b></td>
                  <td>{c.perfect}</td><td>{c.great}</td><td>{c.good}</td><td>{c.miss}</td><td>{c.wrong}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card col">
        <h3>Trickiest bars</h3>
        {r.worstMeasures.length === 0 ? (
          <div className="muted">No misses or wrong notes. Clean run!</div>
        ) : (
          <table>
            <tbody>
              {r.worstMeasures.map((w) => (
                <tr key={w.bar}>
                  <td>Bar {w.bar}</td>
                  <td>{w.errors} {w.errors === 1 ? 'error' : 'errors'}</td>
                  <td style={{ textAlign: 'right' }}><button onClick={() => practiseBar(w.bar)}>Loop this bar in Wait mode</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history.length > 1 && (
        <div className="card small muted">
          You've played this song {history.length} times. Best ever: {Math.max(...history.map((h) => h.score)).toLocaleString()}.
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={() => nav({ name: 'play', song })}>Play again</button>
        <button onClick={() => nav({ name: 'setup', song })}>Change settings</button>
        <button onClick={() => nav({ name: 'library' })}>Songs</button>
      </div>
    </div>
  );
}

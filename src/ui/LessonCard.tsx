import { useEffect, useState } from 'react';
import { nextStep, planLesson, type LessonHands, type LessonProgress, type LessonStep } from '../model/lesson';
import { starsFor } from '../engine/judge';
import { Seg } from './Seg';
import type { Song } from '../model/song';
import { db } from '../storage/db';

export const lessonKey = (songId: string) => `lesson:${songId}`;

export async function loadLesson(songId: string): Promise<LessonProgress> {
  return (await db.getKv<LessonProgress>(lessonKey(songId))) ?? { barsPerSection: 4, done: [] };
}

/** Save a step attempt: its best accuracy always, and "done" if it passed. */
export async function recordStep(songId: string, stepId: string, accuracy: number, passed: boolean): Promise<LessonProgress> {
  const p = await loadLesson(songId);
  p.best = { ...p.best, [stepId]: Math.max(p.best?.[stepId] ?? 0, accuracy) };
  if (passed && !p.done.includes(stepId)) p.done.push(stepId);
  await db.setKv(lessonKey(songId), p);
  return p;
}

export function lessonSteps(song: Song, p: LessonProgress): LessonStep[] {
  return planLesson(song, p.barsPerSection, p.hands ?? 'both');
}

/** ★★★☆☆ for a 0..1 accuracy. */
export function StarRow({ accuracy, size = 12 }: { accuracy: number; size?: number }) {
  const n = starsFor(accuracy);
  return (
    <span style={{ fontSize: size, letterSpacing: 1 }} title={`${Math.round(accuracy * 100)}%`}>
      <span style={{ color: 'var(--warn)' }}>{'★'.repeat(n)}</span>
      <span style={{ color: '#4b5563' }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

const KIND_ICON: Record<LessonStep['kind'], string> = { hand: '✋', together: '🙌', tempo: '⏱', join: '🔗', final: '🏁' };

/** "Learn this song step by step" on the song's setup screen. */
export function LessonCard({ song, onStart }: { song: Song; onStart: (step: LessonStep) => void }) {
  const [progress, setProgress] = useState<LessonProgress>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    loadLesson(song.id).then(setProgress);
  }, [song.id]);
  if (!progress) return null;
  const steps = lessonSteps(song, progress);
  const hands = progress.hands ?? 'both';
  const hasHand = (h: 'L' | 'R') => song.notes.some((n) => n.hand === h);
  const next = nextStep(steps, progress);
  const doneCount = steps.filter((s) => progress.done.includes(s.id)).length;
  const save = async (p: LessonProgress) => {
    await db.setKv(lessonKey(song.id), p);
    setProgress(p);
  };
  const groups: { name: string; steps: LessonStep[] }[] = [];
  for (const s of steps) {
    const g = groups[groups.length - 1];
    if (g && g.name === s.group) g.steps.push(s);
    else groups.push({ name: s.group, steps: [s] });
  }

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0 }}>Learn it step by step</h3>
        <div className="spacer" />
        <Seg<LessonHands>
          value={hands}
          options={[
            ...(hasHand('L') && hasHand('R') ? [['both', 'Both hands'] as [LessonHands, string]] : []),
            ...(hasHand('R') ? [['right', 'Right hand'] as [LessonHands, string]] : []),
            ...(hasHand('L') ? [['left', 'Left hand'] as [LessonHands, string]] : []),
          ]}
          onChange={(h) => save({ ...progress, hands: h })}
        />
        <label className="small muted row" style={{ gap: 6 }}>
          Sections of
          <select
            value={progress.barsPerSection}
            onChange={(e) => {
              const bars = Number(e.target.value);
              if (doneCount && !confirm('Changing the section size starts the lesson again. Continue?')) return;
              save({ ...progress, barsPerSection: bars, done: [], best: {} });
            }}
          >
            {[2, 4, 8].map((b) => (
              <option key={b} value={b}>{b} bars</option>
            ))}
          </select>
        </label>
      </div>
      <div className="small muted">
        {hands === 'both'
          ? 'A few bars at a time: each hand slowly (the notes wait for you), then both hands, then in time, then at full speed. Every two sections are joined up, and you finish with the whole song.'
          : `Just the ${hands} hand, a few bars at a time: slowly (the notes wait for you), then in time, then at full speed. Every two sections are joined up, and you finish with the whole song.`}{' '}
        Reach the accuracy goal to move on; your best stars show on each step.
      </div>
      <div className="lesson-bar" title={`${doneCount} of ${steps.length} steps done`}>
        <div style={{ width: `${(doneCount / Math.max(1, steps.length)) * 100}%` }} />
      </div>
      <div className="row">
        {next ? (
          <>
            <button className="primary" onClick={() => onStart(next)}>
              {doneCount ? 'Continue' : 'Start'}: {next.group}, {next.title.toLowerCase()}
            </button>
            <span className="small muted">
              Step {steps.indexOf(next) + 1} of {steps.length} · goal {Math.round(next.goal * 100)}%
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--good)' }}>🎉 You've done every step. Play the whole song any time, or start again.</span>
        )}
        <div className="spacer" />
        <button className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Hide steps' : 'Show all steps'}</button>
        {doneCount > 0 && (
          <button className="link" onClick={() => confirm('Start the lesson again from the first step?') && save({ ...progress, done: [], best: {} })}>
            Start again
          </button>
        )}
      </div>
      {open && (
        <div className="col small" style={{ gap: 6 }}>
          {groups.map((g) => (
            <div key={g.name} className="row" style={{ gap: 6 }}>
              <span style={{ width: 150 }} className="muted">{g.name}</span>
              {g.steps.map((s) => {
                const done = progress.done.includes(s.id);
                const best = progress.best?.[s.id];
                return (
                  <button
                    key={s.id}
                    className={`lesson-step ${done ? 'done' : ''} ${s === next ? 'next' : ''}`}
                    title={`${s.title} · goal ${Math.round(s.goal * 100)}%${best !== undefined ? ` · best ${Math.round(best * 100)}%` : ''}${done ? ' · passed' : ''}`}
                    onClick={() => onStart(s)}
                  >
                    {done ? '✓' : KIND_ICON[s.kind]} {s.kind === 'hand' ? (s.hands === 'left' ? 'LH' : 'RH') : s.kind === 'together' ? 'Both' : s.kind === 'tempo' ? `${Math.round(s.speed * 100)}%` : s.kind === 'join' ? 'Join' : 'All'}
                    {best !== undefined && (
                      <>
                        {' '}
                        <StarRow accuracy={best} size={10} />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

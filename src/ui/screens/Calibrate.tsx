import { useEffect, useRef, useState } from 'react';
import { MAX_INPUT_LATENCY_MS } from '../../engine/session';
import { db } from '../../storage/db';
import type { Navigate } from '../App';
import { ensureAudio, input, piano, useCalibration } from '../services';

const BEATS = 16;
const INTERVAL_MS = 600; // 100 bpm
const WARMUP = 4; // ignore the first taps while the player locks in

type Phase = 'idle' | 'audio' | 'visual' | 'done';

/** Median of tap-minus-beat offsets, matching each tap to its nearest beat. */
export function tapOffset(beats: number[], taps: number[], warmup = WARMUP): number | undefined {
  const offsets: number[] = [];
  for (const t of taps) {
    let best = Infinity;
    let idx = -1;
    beats.forEach((b, i) => {
      if (Math.abs(t - b) < Math.abs(best)) {
        best = t - b;
        idx = i;
      }
    });
    if (idx >= warmup && Math.abs(best) < INTERVAL_MS / 2) offsets.push(best);
  }
  if (offsets.length < 5) return undefined;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

export function Calibrate({ nav }: { nav: Navigate }) {
  const existing = useCalibration();
  const [phase, setPhase] = useState<Phase>('idle');
  const [flash, setFlash] = useState(false);
  const [audioOff, setAudioOff] = useState<number>();
  const [visualOff, setVisualOff] = useState<number>();
  const [error, setError] = useState<string>();
  const [taps, setTaps] = useState(0);
  const beats = useRef<number[]>([]);
  const tapTimes = useRef<number[]>([]);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    const record = (time: number) => {
      if (phaseRef.current !== 'audio' && phaseRef.current !== 'visual') return;
      tapTimes.current.push(time);
      setTaps(tapTimes.current.length);
    };
    const off = input.onKey((e) => e.type === 'on' && record(e.time));
    const onSpace = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        record(e.timeStamp);
      }
    };
    window.addEventListener('keydown', onSpace);
    return () => {
      off();
      window.removeEventListener('keydown', onSpace);
    };
  }, []);

  const runAudio = async () => {
    setError(undefined);
    await ensureAudio();
    tapTimes.current = [];
    setTaps(0);
    beats.current = Array.from({ length: BEATS }, (_, i) => piano.clickIn(1 + (i * INTERVAL_MS) / 1000, i % 4 === 0));
    setPhase('audio');
    setTimeout(() => {
      const off = tapOffset(beats.current, tapTimes.current);
      if (off === undefined) setError('Not enough taps near the clicks. Try again and tap along with every click.');
      else setAudioOff(off);
      setPhase('idle');
    }, 1000 + BEATS * INTERVAL_MS + 500);
  };

  const runVisual = () => {
    setError(undefined);
    tapTimes.current = [];
    setTaps(0);
    const start = performance.now() + 1000;
    beats.current = Array.from({ length: BEATS }, (_, i) => start + i * INTERVAL_MS);
    setPhase('visual');
    let i = 0;
    const loop = (now: number) => {
      if (i < BEATS && now >= beats.current[i]) {
        // Record when the flash actually got drawn (this frame), not when we planned it.
        beats.current[i] = now;
        setFlash(true);
        setTimeout(() => setFlash(false), 90);
        i++;
      }
      if (i < BEATS || now < beats.current[BEATS - 1] + 500) requestAnimationFrame(loop);
      else {
        const off = tapOffset(beats.current, tapTimes.current);
        if (off === undefined) setError('Not enough taps near the flashes. Try again.');
        else setVisualOff(off);
        setPhase('idle');
      }
    };
    requestAnimationFrame(loop);
  };

  const save = async () => {
    if (visualOff === undefined || audioOff === undefined) return;
    await db.saveCalibration({
      deviceKey: input.deviceKey(),
      inputLatencyMs: Math.max(0, Math.min(MAX_INPUT_LATENCY_MS, visualOff)),
      audioLatencyMs: Math.max(0, Math.min(400, audioOff - visualOff)),
      updatedAt: Date.now(),
    });
    setPhase('done');
  };

  const busy = phase === 'audio' || phase === 'visual';
  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <h1>Latency calibration</h1>
      <div className="muted">
        Tap along on the keyboard you'll play with (any key; Space also works). Calibrating for <b>{input.deviceKey()}</b>.
        {existing && ` Current: input ${Math.round(existing.inputLatencyMs)} ms, audio ${Math.round(existing.audioLatencyMs)} ms.`}
      </div>

      <div className="card col" style={{ textAlign: 'center' }}>
        <div className={`tap-target ${flash ? 'flash' : ''}`} />
        <div className="muted small">
          {phase === 'audio' && `Tap with each click… (${taps} taps)`}
          {phase === 'visual' && `Tap each time the circle flashes… (${taps} taps)`}
          {phase === 'idle' && '16 beats at 100 bpm. The first 4 taps are ignored.'}
          {phase === 'done' && 'Saved. Timing is now compensated for this device.'}
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button disabled={busy} onClick={runAudio}>1. Audio test (listen)</button>
          <button disabled={busy} onClick={runVisual}>2. Visual test (watch)</button>
        </div>
        <div className="row" style={{ justifyContent: 'center', gap: 30 }}>
          <div>Audio tap offset: <b>{audioOff === undefined ? '–' : `${Math.round(audioOff)} ms`}</b></div>
          <div>Visual tap offset: <b>{visualOff === undefined ? '–' : `${Math.round(visualOff)} ms`}</b></div>
        </div>
        {error && <div className="error">{error}</div>}
        {visualOff !== undefined && visualOff > MAX_INPUT_LATENCY_MS && (
          <div className="notice">
            {Math.round(visualOff)} ms is more than real keyboards add. You were probably reacting to the flash rather than tapping along with it. Try
            again, tapping on the beat. (Saved values are capped at {MAX_INPUT_LATENCY_MS} ms.)
          </div>
        )}
        {audioOff !== undefined && visualOff !== undefined && (
          <div className="small">
            Input latency ≈ <b>{Math.round(Math.max(0, visualOff))} ms</b>, extra audio latency ≈ <b>{Math.round(Math.max(0, audioOff - visualOff))} ms</b>.
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" disabled={audioOff === undefined || visualOff === undefined || busy} onClick={save}>Save for this device</button>
          <button onClick={() => nav({ name: 'settings' })}>Back</button>
        </div>
      </div>
      <div className="small muted">
        How it works: the visual test measures how late your key presses arrive compared with what you see (key + display delay).
        Presses are shifted back by that much when judged. The audio test adds the speaker/headphone delay; the difference is used to play
        the backing track earlier so sound and falling notes line up. Bluetooth headphones can add 150 ms or more.
      </div>
    </div>
  );
}

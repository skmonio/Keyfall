import * as Tone from 'tone';
import type { AudioSink } from '../engine/session';

import { createVoice, INSTRUMENTS, type Voice } from './instruments';

/**
 * Instrument sound + metronome + game sound effects. Implements the session's AudioSink,
 * plus live key sounds. Tempo changes never change pitch, because we synthesise from note
 * data rather than time-stretching a recording.
 */
export class PianoAudio implements AudioSink {
  private voices = new Map<string, { voice: Voice; ok?: boolean }>();
  private current = 'piano';
  private fallback?: Tone.PolySynth;
  private click?: Tone.Synth;
  private sfx?: Tone.PolySynth;
  private out?: Tone.Gain;
  private started = false;
  private onStatus?: (s: PianoAudio['status']) => void;
  status: 'idle' | 'loading' | 'ready' | 'fallback' = 'idle';
  private lastClickAt = 0;
  /** Which voice started each held key, so the release goes to the same voice. */
  private held = new Map<number, Voice>();
  /** Whether the player's own key presses make sound. */
  keySoundOn = true;
  /** Game sound effects (combo chimes, fanfares). */
  sfxOn = true;

  /** Must be called from a user gesture (browser autoplay rules). */
  async init(onStatus?: (s: PianoAudio['status']) => void, instrument?: string): Promise<void> {
    if (onStatus) this.onStatus = onStatus;
    if (!this.started) {
      await Tone.start();
      // Low-latency settings: live key presses should sound immediately.
      Tone.getContext().lookAhead = 0.01;
      this.started = true;
    }
    if (!this.out) {
      this.out = new Tone.Gain(0.9).toDestination();
      this.click = new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        volume: -12,
      }).connect(this.out);
      this.fallback = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.8 },
        volume: -8,
      }).connect(this.out);
      this.sfx = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 5,
        modulationIndex: 3,
        envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 },
        volume: -16,
      }).connect(this.out);
    }
    this.setInstrument(instrument ?? this.current);
  }

  /** Switch the sound of your keys and the backing track. Loads samples the first time. */
  setInstrument(id: string) {
    if (!INSTRUMENTS.some((i) => i.id === id)) id = 'piano';
    if (id !== this.current) this.releaseEverything();
    this.current = id;
    if (!this.out) return; // applied on init
    let entry = this.voices.get(id);
    if (!entry) {
      const e: { voice: Voice; ok?: boolean } = { voice: undefined as unknown as Voice };
      this.voices.set(id, e);
      this.setStatus('loading');
      e.voice = createVoice(id, this.out, (ok) => {
        e.ok = ok;
        if (this.current === id) this.setStatus(ok ? 'ready' : 'fallback');
      });
      entry = e;
    } else {
      this.setStatus(entry.ok === undefined ? 'loading' : entry.ok ? 'ready' : 'fallback');
    }
  }

  get instrument(): string {
    return this.current;
  }

  private setStatus(s: PianoAudio['status']) {
    this.status = s;
    this.onStatus?.(s);
  }

  private voice(): Voice | undefined {
    const e = this.voices.get(this.current);
    return (e?.ok ? e.voice : this.fallback) as Voice | undefined;
  }

  /** A little fanfare: step passed, new best score. */
  fanfare() {
    if (!this.sfxOn || !this.sfx) return;
    const t = Tone.now() + 0.05;
    [['C5', 0], ['E5', 0.1], ['G5', 0.2], ['C6', 0.3]].forEach(([n, d]) => this.sfx!.triggerAttackRelease(n as string, 0.25, t + (d as number), 0.6));
    this.sfx.triggerAttackRelease(['C5', 'E5', 'G5', 'C6'], 0.6, t + 0.45, 0.5);
  }

  /** A soft "try again" sound. */
  softFail() {
    if (!this.sfxOn || !this.sfx) return;
    const t = Tone.now() + 0.05;
    this.sfx.triggerAttackRelease('G4', 0.2, t, 0.4);
    this.sfx.triggerAttackRelease('E4', 0.35, t + 0.18, 0.4);
  }

  /** Estimated output latency of the audio device, in ms. */
  outputLatencyMs(): number {
    const ctx = Tone.getContext().rawContext as AudioContext;
    return ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000;
  }

  scheduleNote(pitch: number, durationSec: number, velocity: number, delaySec: number, gain: number): void {
    const v = this.voice();
    if (!v) return;
    const when = Tone.now() + delaySec;
    const freq = Tone.Frequency(pitch, 'midi').toNote();
    const vel = Math.max(0.05, Math.min(1, (velocity / 127) * gain));
    // We don't use Tone.Transport: the song clock is the only clock. Notes are scheduled at
    // most ~150ms ahead on the AudioContext, so a pause or seek can only leak a tiny tail.
    try {
      v.triggerAttackRelease(freq, Math.max(0.05, durationSec), when, vel);
    } catch (e) {
      console.warn('note failed', e);
    }
  }

  scheduleClick(accent: boolean, delaySec: number): void {
    this.playClick(Tone.now() + delaySec, accent, accent ? 1 : 0.6);
  }

  /** The click synth is monophonic: Tone throws unless each start is later than the last one. */
  private playClick(when: number, accent: boolean, vel: number) {
    const t = Math.max(when, this.lastClickAt + 0.005);
    this.lastClickAt = t;
    try {
      this.click?.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, t, vel);
    } catch (e) {
      console.warn('click failed', e);
    }
    return t;
  }

  cancelScheduled(): void {
    // Silence anything already scheduled ahead (seek, pause, speed change).
    this.voice()?.releaseAll();
    this.fallback?.releaseAll();
  }

  keyDown(pitch: number, velocity: number) {
    if (!this.keySoundOn) return;
    const v = this.voice();
    if (!v) return;
    const note = Tone.Frequency(pitch, 'midi').toNote();
    // Pressing a key that's still sounding: release it first so it can't get stuck.
    this.held.get(pitch)?.triggerRelease(note, Tone.now());
    v.triggerAttack(note, Tone.now(), Math.max(0.1, velocity / 127));
    this.held.set(pitch, v);
  }

  keyUp(pitch: number) {
    // Release on the voice that started the note (the instrument may have finished loading, or
    // been changed, while the key was down).
    const v = this.held.get(pitch) ?? this.voice();
    this.held.delete(pitch);
    v?.triggerRelease(Tone.Frequency(pitch, 'midi').toNote(), Tone.now());
  }

  /** Stop every sound from every voice (instrument change, leaving a screen). */
  releaseEverything() {
    for (const e of this.voices.values()) if (e.ok) e.voice.releaseAll();
    this.fallback?.releaseAll();
    this.held.clear();
  }

  /** Schedule a click `delaySec` from now (used by calibration). Returns its performance.now() time. */
  clickIn(delaySec: number, accent = false): number {
    const t = this.playClick(Tone.now() + delaySec, accent, 1);
    return this.contextTimeToPerf(t);
  }

  /** Map an AudioContext time to performance.now() milliseconds. */
  contextTimeToPerf(ctxTime: number): number {
    const raw = Tone.getContext().rawContext as AudioContext;
    const ts = raw.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined) {
      return ts.performanceTime + (ctxTime - ts.contextTime) * 1000;
    }
    return performance.now() + (ctxTime - raw.currentTime) * 1000;
  }
}

export const piano = new PianoAudio();

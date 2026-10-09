import { measureAt, type Hand, type Note, type Song } from '../model/song';
import { SongClock } from './clock';
import { gradeFor, Judge, Scorer, type Grade, type NoteState } from './judge';
import { activeHands, type PlaySettings } from './settings';

/** What the session needs from the audio layer. Delays are real seconds from now. */
export interface AudioSink {
  scheduleNote(pitch: number, durationSec: number, velocity: number, delaySec: number, gain: number): void;
  scheduleClick(accent: boolean, delaySec: number): void;
  cancelScheduled(): void;
}

/** 'now' = play this next; 'next' = the note after that. Same meaning on screen and on the LUMI. */
export type LightRole = 'now' | 'next';
export interface LightsSink {
  setTargets(targets: Map<number, { hand: Hand; role: LightRole }>): void;
  flash(pitch: number, kind: 'hit' | 'wrong'): void;
}

export interface Feedback {
  pitch: number;
  kind: Exclude<Grade, 'miss'> | 'miss' | 'wrong';
  perf: number;
  hand?: Hand;
}

export interface SessionResults {
  songId: string;
  title: string;
  date: number;
  mode: PlaySettings['mode'];
  hands: PlaySettings['hands'];
  speed: number;
  score: number;
  maxCombo: number;
  accuracy: number;
  accuracyL: number | null;
  accuracyR: number | null;
  stars: number;
  counts: Record<Hand, { perfect: number; great: number; good: number; miss: number; wrong: number }>;
  /** Printed bar numbers with the most errors. */
  worstMeasures: { bar: number; errors: number }[];
  loopPasses: number;
  section: string;
  /** The player skipped or replayed bars during this run. */
  seeked?: boolean;
  /** Real seconds the song was running (practice time). */
  playedSec?: number;
  /** Per printed bar: how many notes you had to play there, and how many went wrong (misses + wrong keys). */
  barStats?: { bar: number; notes: number; errors: number }[];
}

interface Chord {
  time: number;
  notes: Note[];
}

interface Beat {
  time: number;
  accent: boolean;
}

const LOOKAHEAD_SEC = 0.15;
export const MAX_INPUT_LATENCY_MS = 150;

export interface SessionDeps {
  audio?: AudioSink;
  lights?: LightsSink;
  perfNow?: () => number;
  inputLatencyMs?: number;
  audioLatencyMs?: number;
  /** Don't synthesise the score: an original recording is playing instead. */
  muteScore?: boolean;
  /** "Listen first": nothing to play, every note sounds (the demo before you try). */
  demo?: boolean;
  /** Jump over long stretches where you have nothing to play (e.g. the other hand's solo). */
  skipGaps?: boolean;
  onFinish?: (r: SessionResults) => void;
  onLoop?: (pass: number, clean: boolean, newSpeed: number) => void;
}

export class GameSession {
  readonly clock: SongClock;
  readonly scorer = new Scorer();
  readonly judge: Judge;
  readonly held = new Set<number>();
  readonly feedback: Feedback[] = [];
  readonly active: Set<Hand>;
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly leadIn: number;
  finished = false;
  loopPasses = 0;
  /** True once the player has jumped around; such runs don't count as personal bests. */
  seeked = false;
  private seekTarget?: number;
  /** When looping: the results up to the end of the last completed pass (saved if you exit mid-loop). */
  completedPassResults?: SessionResults;
  /** Practice time: real seconds the clock was running. */
  playedSec = 0;
  private lastTickPerf?: number;

  private readonly perfNow: () => number;
  private readonly playable: Note[]; // notes the player must play, in range
  private readonly chords: Chord[];
  private waitIdx = 0;
  private chordPresses = new Map<number, number>(); // pitch -> perf time, for the current chord
  private readonly beats: Beat[];
  private audioNoteCursor = 0;
  private beatCursor = 0;
  private scheduledUntil = -Infinity;
  private passErrors = 0;
  private started = false;

  constructor(
    readonly song: Song,
    readonly settings: PlaySettings,
    private readonly deps: SessionDeps = {},
  ) {
    this.perfNow = deps.perfNow ?? (() => performance.now());
    this.clock = new SongClock(this.perfNow);
    this.clock.setRate(settings.speed);
    this.active = deps.demo ? new Set<Hand>() : activeHands(settings.hands);

    const ms = song.measures;
    const sec = settings.section;
    const from = sec ? Math.max(0, Math.min(sec.fromMeasure, ms.length - 1)) : 0;
    const to = sec ? Math.max(from, Math.min(sec.toMeasure, ms.length - 1)) : ms.length - 1;
    this.rangeStart = sec && ms.length ? ms[from].start : 0;
    this.rangeEnd = sec && ms.length ? ms[to].start + ms[to].duration : song.duration;

    this.playable = song.notes.filter(
      (n) => !n.backing && this.active.has(n.hand) && n.start >= this.rangeStart - 1e-6 && n.start < this.rangeEnd - 1e-6,
    );
    this.judge = new Judge(this.playable, settings.windows);
    for (const n of song.notes) {
      if (!this.judge.states.has(n.id)) this.judge.states.set(n.id, { status: 'auto' });
    }
    this.chords = groupChords(this.playable);

    const startMeasure = ms.length ? ms[measureAt(song, this.rangeStart)] : undefined;
    // A full bar at the song's tempo (not the bar's own length, which is short for a pickup).
    const barLen = startMeasure ? beatSeconds(song, startMeasure.start, startMeasure.beatType) * startMeasure.beats : 2;
    this.leadIn = settings.countIn ? barLen : Math.min(2, barLen);
    this.beats = buildBeats(song, this.rangeStart - this.leadIn, this.rangeEnd, startMeasure);
    this.seekTo(this.rangeStart - this.leadIn);
  }

  // ------------------------------------------------------------ transport

  get songTime(): number {
    return this.clock.now();
  }
  get rate(): number {
    return this.clock.rate;
  }
  get running(): boolean {
    return this.clock.running;
  }
  /** True while Wait mode is holding for the player. */
  get waiting(): boolean {
    return this.settings.mode === 'wait' && this.clock.isHeld();
  }
  get currentChord(): Chord | undefined {
    return this.settings.mode === 'wait' ? this.chords[this.waitIdx] : undefined;
  }

  noteState(id: number): NoteState {
    return this.judge.states.get(id) ?? { status: 'auto' };
  }

  start() {
    if (this.finished) return;
    this.started = true;
    this.clock.start();
    this.scheduledUntil = this.clock.now();
  }

  pause() {
    this.clock.pause();
    this.deps.audio?.cancelScheduled();
  }

  toggle() {
    if (this.clock.running) this.pause();
    else this.start();
  }

  setSpeed(speed: number) {
    const s = Math.max(0.25, Math.min(1.5, speed));
    this.settings.speed = s;
    this.clock.setRate(s);
    this.rescheduleFrom(this.clock.now());
  }

  /** Jump to a song time. Notes after it become pending again. */
  seekTo(t: number) {
    this.seekTarget = undefined;
    this.clock.seek(t);
    this.judge.reset(t - 1e-6, this.rangeEnd);
    this.waitIdx = this.chords.findIndex((c) => c.time >= t - 1e-6);
    if (this.waitIdx < 0) this.waitIdx = this.chords.length;
    this.chordPresses.clear();
    this.finished = false;
    this.rescheduleFrom(t);
    this.applyWaitLimit();
  }

  restart() {
    this.seekTo(this.rangeStart - this.leadIn);
    this.seeked = false;
  }

  /** Index of the bar being played (0-based), clamped to the practice range. */
  get currentMeasure(): number {
    const t = Math.max(this.rangeStart, Math.min(this.songTime, this.rangeEnd - 1e-3));
    // During the run-up after a jump, we're "in" the bar we jumped to.
    const target = this.seekTarget;
    if (target !== undefined && this.songTime < this.song.measures[target].start) return target;
    return measureAt(this.song, t);
  }

  get firstMeasure(): number {
    return measureAt(this.song, this.rangeStart);
  }

  get lastMeasure(): number {
    return measureAt(this.song, this.rangeEnd - 1e-3);
  }

  /** Jump to the start of a bar (with a short run-up so you can get ready). */
  seekToMeasure(index: number) {
    const i = Math.max(this.firstMeasure, Math.min(this.lastMeasure, index));
    const m = this.song.measures[i];
    if (!m) return;
    const runUp = Math.min(1.2 * this.clock.rate, m.duration / 2);
    this.seekTo(Math.max(this.rangeStart - this.leadIn, m.start - runUp));
    this.seekTarget = i;
    this.seeked = true;
  }

  /** Move by whole bars. Going back from early in a bar goes to the previous one. */
  seekBars(delta: number) {
    const cur = this.currentMeasure;
    const m = this.song.measures[cur];
    const intoBar = m ? this.songTime - m.start : 0;
    let target = cur + delta;
    if (delta < 0 && m && intoBar > m.duration * 0.35) target = cur + delta + 1; // first "back" = start of this bar
    this.seekToMeasure(target);
  }

  private rescheduleFrom(t: number) {
    this.deps.audio?.cancelScheduled();
    this.scheduledUntil = t - 1e-6;
    this.audioNoteCursor = lowerBound(this.song.notes, t - 1e-6);
    this.beatCursor = this.beats.findIndex((b) => b.time >= t - 1e-6);
    if (this.beatCursor < 0) this.beatCursor = this.beats.length;
  }

  private applyWaitLimit() {
    if (this.settings.mode !== 'wait') {
      this.clock.setLimit(Infinity);
      return;
    }
    const c = this.chords[this.waitIdx];
    this.clock.setLimit(c ? c.time : Infinity);
  }

  // ------------------------------------------------------------ input

  /** Calibrated input latency, clamped: a bad calibration must never make presses unplayable. */
  get inputLatencyMs(): number {
    return Math.max(0, Math.min(MAX_INPUT_LATENCY_MS, this.deps.inputLatencyMs ?? 0));
  }

  private songTimeOfPress(perfTs: number) {
    return this.clock.songTimeAt(perfTs - this.inputLatencyMs);
  }

  noteOn(pitch: number, perfTs = this.perfNow()) {
    this.held.add(pitch);
    if (!this.started || !this.clock.running || this.finished) return;
    const t = this.songTimeOfPress(perfTs);
    if (this.settings.mode === 'wait') this.waitPress(pitch, perfTs, t);
    else this.performancePress(pitch, perfTs, t);
  }

  noteOff(pitch: number) {
    this.held.delete(pitch);
  }

  private performancePress(pitch: number, perf: number, t: number) {
    const r = this.judge.press(pitch, t, this.clock.rate);
    if (r.kind === 'hit') {
      this.scorer.hit(r.grade, r.note.hand);
      this.pushFeedback({ pitch, kind: r.grade, perf, hand: r.note.hand });
      this.deps.lights?.flash(pitch, 'hit');
    } else {
      this.registerWrong(pitch, perf, t, true);
    }
  }

  private waitPress(pitch: number, perf: number, t: number) {
    const chord = this.chords[this.waitIdx];
    // While the clock is holding for this chord, any press of its notes counts, whatever its timestamp says.
    if (chord && this.clock.isHeld(this.perfNow())) t = Math.max(t, chord.time);
    const earlySong = 0.6 * this.clock.rate; // accept chord notes up to 0.6s (real) early
    const target = chord?.notes.find((n) => n.pitch === pitch);
    if (!chord || !target || t < chord.time - earlySong) {
      // Pressing a note of the current chord again is harmless; anything else is wrong.
      if (!target) this.registerWrong(pitch, perf, t, false);
      return;
    }
    if (this.chordPresses.has(pitch)) return;
    this.chordPresses.set(pitch, perf);
    const arrivalPerf = this.clock.perfAt(chord.time);
    const deltaMs = perf - arrivalPerf;
    const grade = gradeFor(deltaMs, this.settings.windows) ?? 'good';
    for (const n of chord.notes) {
      if (n.pitch === pitch && this.noteState(n.id).status === 'pending') {
        this.judge.mark(n.id, { status: 'hit', grade, deltaMs });
        this.scorer.hit(grade, n.hand);
        this.pushFeedback({ pitch, kind: grade, perf, hand: n.hand });
      }
    }
    this.deps.lights?.flash(pitch, 'hit');
    if (chord.notes.every((n) => this.noteState(n.id).status === 'hit')) {
      this.waitIdx++;
      this.chordPresses.clear();
      this.applyWaitLimit();
    }
  }

  private registerWrong(pitch: number, perf: number, t: number, breakCombo: boolean) {
    // Blame the hand whose notes are nearest in pitch around this moment.
    const near = this.playable
      .filter((n) => Math.abs(n.start - t) < 1.5)
      .sort((a, b) => Math.abs(a.pitch - pitch) - Math.abs(b.pitch - pitch))[0];
    const hand: Hand = near?.hand ?? (pitch >= 60 ? 'R' : 'L');
    const m = Math.max(0, measureAt(this.song, Math.max(0, t)));
    this.scorer.wrong(hand, m, breakCombo);
    this.passErrors++;
    this.pushFeedback({ pitch, kind: 'wrong', perf, hand });
    this.deps.lights?.flash(pitch, 'wrong');
  }

  private pushFeedback(f: Feedback) {
    this.feedback.push(f);
    if (this.feedback.length > 64) this.feedback.splice(0, this.feedback.length - 64);
  }

  // ------------------------------------------------------------ frame update

  /** Call once per animation frame. */
  tick() {
    if (!this.clock.running || this.finished) {
      this.lastTickPerf = undefined;
      this.updateLights(this.clock.now());
      return;
    }
    const perf = this.perfNow();
    if (this.lastTickPerf !== undefined) this.playedSec += Math.min(0.5, (perf - this.lastTickPerf) / 1000);
    this.lastTickPerf = perf;
    const t = this.clock.now(perf);
    const rate = this.clock.rate;

    if (this.settings.mode === 'performance') {
      for (const n of this.judge.update(t, rate)) {
        this.scorer.miss(n.hand, n.measure, true);
        this.passErrors++;
        this.pushFeedback({ pitch: n.pitch, kind: 'miss', perf, hand: n.hand });
      }
    }

    if (this.deps.skipGaps) this.skipGap(t);
    this.scheduleAudio(t);
    this.updateLights(t);

    const goodSong = (this.settings.windows.good / 1000) * rate;
    const doneWithRange =
      this.settings.mode === 'wait' ? this.waitIdx >= this.chords.length && t >= this.rangeEnd : t >= this.rangeEnd + goodSong;
    if (!doneWithRange) return;

    if (this.settings.loop) {
      this.loopPasses++;
      const clean = this.passErrors === 0;
      this.completedPassResults = this.results();
      if (clean && this.settings.speedUpOnClean) this.setSpeed(Math.min(1.5, this.clock.rate + 0.05));
      this.passErrors = 0;
      this.deps.onLoop?.(this.loopPasses, clean, this.clock.rate);
      this.seekTo(this.rangeStart - this.leadIn);
      return;
    }
    if (t >= this.rangeEnd + Math.max(goodSong, 0.5)) {
      this.finished = true;
      this.pause();
      this.deps.lights?.setTargets(new Map());
      this.deps.onFinish?.(this.results());
    }
  }

  /** Change the sound mode mid-song. */
  setAudioMode(mode: PlaySettings['audio']) {
    this.settings.audio = mode;
    this.rescheduleFrom(this.clock.now());
  }

  /** Switch the guide (your own part played quietly) on or off mid-song. */
  setHearMyNotes(on: boolean) {
    this.settings.hearMyNotes = on;
    this.rescheduleFrom(this.clock.now());
  }

  /** Your next note to play (the first one not yet played, from now on). */
  nextPlayable(t = this.songTime): Note | undefined {
    const late = (this.settings.windows.good / 1000) * this.clock.rate;
    return this.playable.find((n) => n.start >= t - late && this.noteState(n.id).status === 'pending');
  }

  /** Real seconds until your next note (Infinity if there is none). */
  secondsToNextNote(): number {
    const t = this.songTime;
    const n = this.nextPlayable(t);
    return n ? (n.start - t) / this.clock.rate : Infinity;
  }

  /** Jump to just before your next note (keeps a short run-up). */
  skipToNextNote() {
    const t = this.songTime;
    const n = this.nextPlayable(t);
    if (!n) return;
    const runUp = 1.5 * this.clock.rate;
    if (n.start - runUp > t) this.seekTo(n.start - runUp);
  }

  private skipGap(t: number) {
    // Only when you'd be sitting in silence: practising one hand without hearing the other.
    const hearsOther = this.settings.audio === 'full';
    if (this.settings.hands === 'both' || hearsOther) return;
    // ... and the gap is long: more than 4 real seconds with nothing for you to play.
    if (t < this.rangeStart) return;
    const n = this.nextPlayable(t);
    if (n && (n.start - t) / this.clock.rate > 4) this.skipToNextNote();
    // Nothing left for you: finish instead of listening to the other hand to the end.
    else if (!n && this.playable.length && (this.rangeEnd - t) / this.clock.rate > 4) {
      this.clock.seek(this.rangeEnd);
    }
  }

  private scheduleAudio(t: number) {
    const audio = this.deps.audio;
    if (!audio) return;
    const rate = this.clock.rate;
    const mode = this.settings.audio;
    const lat = (this.deps.audioLatencyMs ?? 0) / 1000;
    // In Wait mode the clock can stop at any chord, so don't schedule past the hold point.
    const horizon = Math.min(t + LOOKAHEAD_SEC * rate, this.clock.limit);
    if (horizon <= this.scheduledUntil) return;
    const delayOf = (time: number) => Math.max(0, (time - t) / rate - lat);

    if (mode !== 'silent') {
      const notes = this.song.notes;
      while (this.audioNoteCursor < notes.length && notes[this.audioNoteCursor].start <= horizon) {
        const n = notes[this.audioNoteCursor++];
        if (n.start <= this.scheduledUntil || n.start < this.rangeStart - 1e-6 || n.start >= this.rangeEnd) continue;
        const gain = this.gainFor(n);
        // Play what you play: a note moved an octave to fit your keyboard sounds where you play it.
        if (gain > 0) audio.scheduleNote(n.pitch, n.duration / rate, n.velocity, delayOf(n.start), gain);
      }
      while (this.beatCursor < this.beats.length && this.beats[this.beatCursor].time <= horizon) {
        const b = this.beats[this.beatCursor++];
        if (b.time <= this.scheduledUntil) continue;
        const isCountIn = b.time < this.rangeStart - 1e-6;
        if (mode === 'metronome' || (isCountIn && this.settings.countIn)) audio.scheduleClick(b.accent, delayOf(b.time));
      }
    }
    this.scheduledUntil = horizon;
  }

  /** How loud a score note plays, given the audio mode. 0 = don't play. */
  private gainFor(n: Note): number {
    const mode = this.settings.audio;
    if (this.deps.muteScore) return 0;
    if (this.deps.demo) return 0.8;
    // Other instruments' parts (e.g. a voice): part of the full sound only.
    if (n.backing) return mode === 'full' ? 0.6 : 0;
    const mine = this.active.has(n.hand);
    // Full: the whole song, so the hand you're not practising plays at full volume.
    if (!mine) return mode === 'full' ? 0.8 : 0;
    // Your own part plays quietly as a guide in Full and "My hand" (in Wait mode, as the
    // music reaches each note, so you hear what to play next).
    if (this.settings.hearMyNotes === false) return 0;
    if (mode === 'full' || mode === 'mine') return this.settings.mode === 'wait' ? 0.3 : 0.35;
    return 0;
  }

  private updateLights(_t: number) {
    const lights = this.deps.lights;
    if (!lights) return;
    lights.setTargets(this.keyTargets());
  }

  /**
   * The notes to play now and the ones after them, per hand. This one definition drives
   * the on-screen keyboard, the sheet-music highlights and the LUMI lights, so they agree.
   *  - Wait mode: "now" is the chord being waited for, "next" is the chord after it.
   *  - Performance: for each hand, "now" is its next pending chord (always shown),
   *    "next" is the chord after that (within 4 s).
   */
  targetNotes(): { now: Note[]; next: Note[] } {
    if (this.settings.mode === 'wait') {
      const now = (this.chords[this.waitIdx]?.notes ?? []).filter((n) => this.noteState(n.id).status === 'pending');
      const next = this.settings.showNextNotes === false ? [] : (this.chords[this.waitIdx + 1]?.notes ?? []);
      return { now, next };
    }
    const t = this.songTime;
    const rate = this.clock.rate;
    const late = (this.settings.windows.good / 1000) * rate;
    const now: Note[] = [];
    const next: Note[] = [];
    for (const hand of this.active) {
      let group = 0;
      let groupStart = -Infinity;
      for (const n of this.playable) {
        if (n.hand !== hand || n.start < t - late || this.noteState(n.id).status !== 'pending') continue;
        if (n.start - groupStart > 0.03) {
          group++;
          groupStart = n.start;
        }
        // The next chord is always shown, however far away; the one after once it's within 4 s.
        if (group === 1) now.push(n);
        else if (group === 2 && n.start <= t + 4 * rate && this.settings.showNextNotes !== false) next.push(n);
        else if (group > 2) break;
      }
    }
    return { now, next };
  }

  /** Keys to light, by pitch. A key that's both "now" and "next" shows as "now". */
  keyTargets(): Map<number, { hand: Hand; role: LightRole }> {
    const { now, next } = this.targetNotes();
    const out = new Map<number, { hand: Hand; role: LightRole }>();
    for (const n of next) out.set(n.pitch, { hand: n.hand, role: 'next' });
    for (const n of now) out.set(n.pitch, { hand: n.hand, role: 'now' });
    return out;
  }

  private barStats(): { bar: number; notes: number; errors: number }[] {
    const byBar = new Map<number, { notes: number; errors: number }>();
    const get = (bar: number) => {
      if (!byBar.has(bar)) byBar.set(bar, { notes: 0, errors: 0 });
      return byBar.get(bar)!;
    };
    for (const n of this.playable) get(this.song.measures[n.measure]?.number ?? n.measure + 1).notes++;
    for (const [m, errors] of this.scorer.measureErrors) get(this.song.measures[m]?.number ?? m + 1).errors += errors;
    return [...byBar.entries()].map(([bar, v]) => ({ bar, ...v })).sort((a, b) => a.bar - b.bar);
  }

  results(): SessionResults {
    const s = this.scorer;
    const has = (h: Hand) => s.judged(h) > 0 || s.byHand[h].wrong > 0;
    const sec = this.settings.section;
    return {
      songId: this.song.id,
      title: this.song.title,
      date: Date.now(),
      mode: this.settings.mode,
      hands: this.settings.hands,
      speed: this.clock.rate,
      score: s.score,
      maxCombo: s.maxCombo,
      accuracy: s.accuracy(),
      accuracyL: has('L') ? s.accuracy('L') : null,
      accuracyR: has('R') ? s.accuracy('R') : null,
      stars: s.stars(),
      counts: { L: { ...s.byHand.L }, R: { ...s.byHand.R } },
      // By printed bar number (a repeated bar's passes are added together).
      worstMeasures: [
        ...[...s.measureErrors.entries()]
          .reduce((acc, [m, errors]) => {
            const bar = this.song.measures[m]?.number ?? m + 1;
            acc.set(bar, (acc.get(bar) ?? 0) + errors);
            return acc;
          }, new Map<number, number>())
          .entries(),
      ]
        .map(([bar, errors]) => ({ bar, errors }))
        .sort((a, b) => b.errors - a.errors || a.bar - b.bar)
        .slice(0, 5),
      loopPasses: this.loopPasses,
      seeked: this.seeked,
      playedSec: Math.round(this.playedSec),
      barStats: this.barStats(),
      section: sec
        ? `bars ${this.song.measures[sec.fromMeasure]?.number ?? sec.fromMeasure + 1}–${this.song.measures[sec.toMeasure]?.number ?? sec.toMeasure + 1}`
        : 'whole song',
    };
  }
}

// ------------------------------------------------------------ helpers

export function groupChords(notes: Note[]): Chord[] {
  const chords: Chord[] = [];
  for (const n of notes) {
    const last = chords[chords.length - 1];
    if (last && n.start - last.time < 0.03) last.notes.push(n);
    else chords.push({ time: n.start, notes: [n] });
  }
  return chords;
}

/** Seconds per beat at time t (a beat = one `beatType` note, e.g. a quarter in 4/4). */
function beatSeconds(song: Song, t: number, beatType: number): number {
  let bpm = song.tempos[0]?.bpm ?? 100;
  for (const tp of song.tempos) if (tp.time <= t + 1e-6) bpm = tp.bpm;
  return (60 / bpm) * (4 / beatType);
}

/**
 * Metronome clicks, spaced by the tempo (never squeezed to fit a bar): so a pickup or a bar
 * with a missing rest doesn't make the clicks speed up. A pickup's clicks line up with the
 * bar that follows it.
 */
function buildBeats(song: Song, from: number, to: number, countInMeasure?: Song['measures'][number]): Beat[] {
  const beats: Beat[] = [];
  const ms = song.measures;
  // Count-in: one full bar's worth of beats before the start.
  if (countInMeasure) {
    const beatLen = beatSeconds(song, countInMeasure.start, countInMeasure.beatType);
    const n = Math.max(1, Math.round(countInMeasure.beats));
    for (let k = 1; k <= n * 2; k++) {
      const time = countInMeasure.start - k * beatLen;
      if (time < from - 1e-6) break;
      beats.push({ time, accent: k % n === 0 });
    }
  }
  ms.forEach((m, i) => {
    if (m.start + m.duration < from || m.start > to) return;
    const beatLen = beatSeconds(song, m.start, m.beatType);
    const end = m.start + m.duration;
    const nominal = beatLen * m.beats;
    const pickup = i === 0 && m.duration < nominal - 1e-3;
    if (pickup) {
      // Count back from the next downbeat, so the clicks stay on the beat.
      for (let time = end - beatLen; time >= m.start - 1e-6; time -= beatLen) {
        if (time >= from - 1e-6 && time <= to) beats.push({ time, accent: false });
      }
      return;
    }
    for (let k = 0; m.start + k * beatLen < end - 1e-3; k++) {
      const time = m.start + k * beatLen;
      if (time >= from - 1e-6 && time <= to) beats.push({ time, accent: k === 0 });
    }
  });
  // Drop count-in clicks that would land on or after the first real beat.
  return beats.sort((a, b) => a.time - b.time).filter((b, i, arr) => i === 0 || b.time - arr[i - 1].time > 0.02);
}

function lowerBound(notes: Note[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

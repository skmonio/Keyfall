/**
 * Audio import (MP3, WAV, M4A, OGG, FLAC) by automatic music transcription.
 *
 * Uses Spotify's Basic Pitch model (Apache-2.0), which runs in the browser with
 * TensorFlow.js. It turns a recording into notes. We then guess the tempo and bar lines
 * from the note onsets and split the hands at middle C. Transcription is never perfect,
 * so the result goes through a review screen.
 *
 * Works best on a clean recording of solo piano. Full band mixes, vocals and reverb-heavy
 * recordings give messy results.
 */
import { finalizeSong, type Measure, type Note, type Song } from '../model/song';
import { ImportError } from './musicxml';

export interface RawNote {
  pitch: number;
  start: number;
  duration: number;
  /** 0..1 */
  amplitude: number;
}

const MODEL_URL = `${import.meta.env?.BASE_URL ?? '/'}models/basic-pitch/model.json`;
const SAMPLE_RATE = 22050;

/** Decode any browser-supported audio file and resample it to mono 22.05 kHz for the model. */
async function decodeForModel(data: ArrayBuffer): Promise<{ samples: Float32Array; duration: number }> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(data.slice(0));
  } catch {
    throw new ImportError("The browser couldn't decode this audio file. Try MP3, WAV, M4A, OGG or FLAC.");
  } finally {
    ctx.close();
  }
  const length = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), duration: decoded.duration };
}

/** Run Basic Pitch on an audio file. `onProgress` gets 0..1. */
export async function transcribeAudio(data: ArrayBuffer, onProgress?: (p: number) => void): Promise<{ notes: RawNote[]; duration: number }> {
  const { samples, duration } = await decodeForModel(data);
  if (duration > 15 * 60) throw new ImportError('That recording is over 15 minutes. Please trim it to the part you want to practise.');
  // Loaded on demand: TensorFlow.js and the model are large.
  const bp = await import('@spotify/basic-pitch');
  const tf = await import('@tensorflow/tfjs');
  const model = tf.loadGraphModel(MODEL_URL);
  const basicPitch = new bp.BasicPitch(model);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await basicPitch.evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );
  const events = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.5, 0.3, 11)));
  return {
    duration,
    notes: events.map((e) => ({ pitch: e.pitchMidi, start: e.startTimeSeconds, duration: e.durationSeconds, amplitude: e.amplitude })),
  };
}

/** Drop what is almost certainly noise: very short or very quiet notes, and notes off the piano. */
export function cleanNotes(notes: RawNote[]): RawNote[] {
  const loud = notes.filter((n) => n.pitch >= 21 && n.pitch <= 108 && n.duration >= 0.06);
  if (!loud.length) return [];
  const amps = loud.map((n) => n.amplitude).sort((a, b) => a - b);
  const floor = amps[Math.floor(amps.length * 0.1)] * 0.8;
  return loud.filter((n) => n.amplitude >= floor).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * Estimate tempo (bpm) and the time of the first beat from note onsets, by finding the
 * beat grid that the onsets line up with best.
 */
export function estimateTempo(onsets: number[], minBpm = 60, maxBpm = 180): { bpm: number; phase: number } {
  if (onsets.length < 4) return { bpm: 100, phase: onsets[0] ?? 0 };
  const sorted = [...onsets].sort((a, b) => a - b).slice(0, 600); // plenty to find the beat, and keeps it fast
  // Collapse chords into single onsets.
  const ons: number[] = [];
  for (const t of sorted) if (!ons.length || t - ons[ons.length - 1] > 0.05) ons.push(t);
  const sigma = 0.035;
  let best = { bpm: 100, phase: ons[0], score: -Infinity };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const beat = 60 / bpm;
    for (let ph = 0; ph < beat; ph += 0.01) {
      let score = 0;
      const hitBeats = new Set<number>();
      for (const t of ons) {
        const k = Math.round((t - ph) / beat);
        const d = t - ph - k * beat;
        if (Math.abs(d) < 0.07) hitBeats.add(k);
        score += Math.exp(-(d * d) / (2 * sigma * sigma));
        // Off-beat eighths are common; give them a little credit so tempo isn't doubled.
        const d2 = Math.abs(Math.abs(d) - beat / 2);
        score += 0.35 * Math.exp(-(d2 * d2) / (2 * sigma * sigma));
      }
      // A doubled tempo fits every note but leaves many beats empty; penalise empty beats.
      const spanned = Math.round((ons[ons.length - 1] - ons[0]) / beat) + 1;
      score -= 0.4 * Math.max(0, spanned - hitBeats.size);
      // Slight preference for moderate tempi, so e.g. 70 isn't read as 140.
      score *= 1 - Math.abs(bpm - 100) / 400;
      if (score > best.score) best = { bpm, phase: ph, score };
    }
  }
  const beat = 60 / best.bpm;
  // Snap the phase to the first beat at or after the first onset, minus whole beats.
  let phase = best.phase;
  while (phase > ons[0] + 1e-6) phase -= beat;
  while (phase + beat <= ons[0] - 0.05) phase += beat;
  return { bpm: Math.round(best.bpm * 2) / 2, phase: Math.max(0, phase) };
}

/** Bar lines at `bpm`, with bar 1 starting at `firstBeat` (and a pickup bar before it if needed). */
export function measuresFor(duration: number, bpm: number, firstBeat: number, beats = 4): Measure[] {
  const barLen = (60 / bpm) * beats;
  const measures: Measure[] = [];
  let start = firstBeat;
  if (firstBeat > 0.05) measures.push({ index: 0, number: 0, start: 0, duration: firstBeat, beats, beatType: 4 });
  while (start < duration - 0.01 || measures.length === 0) {
    measures.push({ index: measures.length, number: measures.length + (firstBeat > 0.05 ? 0 : 1), start, duration: barLen, beats, beatType: 4 });
    start += barLen;
  }
  return measures;
}

/**
 * Remove "octave echoes": transcription often adds a ghost note an octave (or two) above a
 * real one, from its overtones. A note that starts together with a clearly louder note
 * 12 or 24 semitones below is dropped. Real played octaves are usually similar in loudness,
 * so most of them survive, but this can be switched off.
 */
export function removeOctaveEchoes(notes: RawNote[], ratio = 0.9): RawNote[] {
  return notes.filter(
    (n) =>
      !notes.some(
        (m) =>
          (n.pitch - m.pitch === 12 || n.pitch - m.pitch === 24) &&
          Math.abs(n.start - m.start) < 0.06 &&
          n.amplitude < m.amplitude * ratio,
      ),
  );
}

export interface AudioSongOptions {
  title: string;
  bpm?: number;
  firstBeat?: number;
  beats?: number;
  split?: number;
  /** Drop likely overtone ghosts (default true). */
  removeEchoes?: boolean;
}

/** Build a Song from transcribed notes. */
export function songFromTranscription(raw: RawNote[], duration: number, opts: AudioSongOptions): Song {
  const cleaned = cleanNotes(raw);
  const notes = opts.removeEchoes === false ? cleaned : removeOctaveEchoes(cleaned);
  if (notes.length < 3) throw new ImportError('Hardly any notes were recognised. Is it a clear piano recording?');
  const est = opts.bpm !== undefined && opts.firstBeat !== undefined ? { bpm: opts.bpm, phase: opts.firstBeat } : estimateTempo(notes.map((n) => n.start));
  const bpm = opts.bpm ?? est.bpm;
  const firstBeat = opts.firstBeat ?? est.phase;
  const measures = measuresFor(Math.max(duration, notes[notes.length - 1].start + 0.5), bpm, firstBeat, opts.beats ?? 4);
  const measureOf = (t: number) => {
    let i = 0;
    while (i + 1 < measures.length && measures[i + 1].start <= t + 1e-6) i++;
    return i;
  };
  const split = opts.split ?? 60;
  const out: Note[] = notes.map((n) => ({
    id: 0,
    pitch: n.pitch,
    start: n.start,
    duration: n.duration,
    hand: n.pitch >= split ? 'R' : 'L',
    velocity: Math.max(20, Math.min(127, Math.round(40 + n.amplitude * 87))),
    measure: measureOf(n.start),
  }));
  return finalizeSong({
    id: crypto.randomUUID(),
    title: opts.title,
    notes: out,
    measures,
    tempos: [{ time: 0, bpm }],
    sourceKind: 'audio',
    addedAt: Date.now(),
  });
}

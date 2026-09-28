/**
 * Instrument sounds for your keys and the backing track.
 *
 *  - Grand piano: Salamander Grand Piano (Alexander Holm, CC-BY 3.0), hosted by Tone.js.
 *  - Sampled instruments: tonejs-instruments by Nicholas Brosowsky (samples CC-BY 3.0,
 *    from public-domain sources), https://github.com/nbrosowsky/tonejs-instruments
 *    These download the first time you pick them (a few MB), then the browser caches them.
 *  - Synth voices: built with Tone.js synthesis, so they work offline and load instantly.
 */
import * as Tone from 'tone';

export type InstrumentKind = 'piano' | 'sampled' | 'synth';

export interface InstrumentInfo {
  id: string;
  name: string;
  kind: InstrumentKind;
  /** Short description shown in the picker. */
  note: string;
}

export const INSTRUMENTS: InstrumentInfo[] = [
  { id: 'piano', name: 'Grand piano', kind: 'piano', note: 'Salamander Grand' },
  { id: 'harp', name: 'Harp', kind: 'sampled', note: 'sampled' },
  { id: 'guitar-nylon', name: 'Nylon guitar', kind: 'sampled', note: 'sampled' },
  { id: 'violin', name: 'Violin', kind: 'sampled', note: 'sampled' },
  { id: 'cello', name: 'Cello', kind: 'sampled', note: 'sampled' },
  { id: 'flute', name: 'Flute', kind: 'sampled', note: 'sampled' },
  { id: 'organ', name: 'Organ', kind: 'sampled', note: 'sampled' },
  { id: 'xylophone', name: 'Xylophone', kind: 'sampled', note: 'sampled' },
  { id: 'epiano', name: 'Electric piano', kind: 'synth', note: 'synth · works offline' },
  { id: 'musicbox', name: 'Music box', kind: 'synth', note: 'synth · works offline' },
  { id: 'pad', name: 'Soft pad', kind: 'synth', note: 'synth · works offline' },
  { id: 'chiptune', name: '8-bit', kind: 'synth', note: 'synth · works offline' },
];

const SALAMANDER_URL = 'https://tonejs.github.io/audio/salamander/';
const SALAMANDER_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];
const TI_URL = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

// Sample notes available for each instrument (from the tonejs-instruments library).
const TI_NOTES: Record<string, string[]> = {
  harp: ['C3', 'C5', 'D2', 'D4', 'D6', 'D7', 'E1', 'E3', 'E5', 'F2', 'F4', 'F6', 'F7', 'G1', 'G3', 'G5', 'A2', 'A4', 'A6', 'B1', 'B3', 'B5', 'B6'],
  'guitar-nylon': ['A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'D2', 'D3', 'D5', 'E2', 'E3', 'E4', 'E5', 'G3'],
  violin: ['A3', 'A4', 'A5', 'A6', 'C4', 'C5', 'C6', 'C7', 'E4', 'E5', 'E6', 'G4', 'G5', 'G6'],
  cello: ['C2', 'C3', 'C4', 'C5', 'D2', 'D3', 'D4', 'E2', 'E3', 'E4', 'F2', 'F3', 'F4', 'G2', 'G3', 'G4', 'A2', 'A3', 'A4', 'B2', 'B3', 'B4'],
  flute: ['C4', 'C5', 'C6', 'C7', 'E4', 'E5', 'E6', 'A4', 'A5', 'A6'],
  organ: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'A1', 'A2', 'A3', 'A4', 'A5'],
  xylophone: ['G4', 'G5', 'G6', 'G7', 'C5', 'C6', 'C7', 'C8'],
};

/** Anything that can play notes: a Sampler or a PolySynth. */
export interface Voice {
  triggerAttack(note: string, time?: number, velocity?: number): unknown;
  triggerRelease(note: string, time?: number): unknown;
  triggerAttackRelease(note: string, duration: number, time?: number, velocity?: number): unknown;
  releaseAll(time?: number): unknown;
  dispose(): unknown;
}

function synthVoice(id: string, out: Tone.ToneAudioNode): Voice {
  switch (id) {
    case 'epiano':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.002, decay: 1.4, sustain: 0.15, release: 0.9 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.1, release: 0.5 },
        volume: -10,
      }).connect(out);
    case 'musicbox':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 7,
        modulationIndex: 4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 1.8, sustain: 0, release: 1.2 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
        volume: -12,
      }).connect(out);
    case 'pad': {
      const filter = new Tone.Filter(1800, 'lowpass').connect(out);
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
        envelope: { attack: 0.25, decay: 0.3, sustain: 0.7, release: 1.5 },
        volume: -20,
      }).connect(filter);
    }
    case 'chiptune':
    default:
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.002, decay: 0.12, sustain: 0.35, release: 0.08 },
        volume: -18,
      }).connect(out);
  }
}

/** Create the voice for an instrument. `onLoad` fires when samples are ready (immediately for synths). */
export function createVoice(id: string, out: Tone.ToneAudioNode, onLoad: (ok: boolean) => void): Voice {
  const info = INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
  if (info.kind === 'synth') {
    const v = synthVoice(info.id, out);
    queueMicrotask(() => onLoad(true));
    return v;
  }
  const urls: Record<string, string> = {};
  let baseUrl: string;
  if (info.kind === 'piano') {
    for (const n of SALAMANDER_NOTES) urls[n] = `${n.replace('#', 's')}.mp3`;
    baseUrl = SALAMANDER_URL;
  } else {
    for (const n of TI_NOTES[info.id]) urls[n] = `${n}.mp3`;
    baseUrl = `${TI_URL}${info.id}/`;
  }
  let settled = false;
  const done = (ok: boolean) => {
    if (settled) return;
    settled = true;
    onLoad(ok);
  };
  setTimeout(() => done(false), 20000);
  return new Tone.Sampler({
    urls,
    baseUrl,
    release: info.id === 'organ' || info.id === 'violin' || info.id === 'cello' || info.id === 'flute' ? 0.4 : 1,
    onload: () => done(true),
    onerror: () => done(false),
  }).connect(out);
}

import { Midi } from '@tonejs/midi';
import { parseMidi as parseMidiFile } from 'midi-file';
import { finalizeSong, type Hand, type Measure, type Note, type Song } from '../model/song';
import { ImportError } from './musicxml';

interface Group {
  key: string;
  notes: { pitch: number; start: number; duration: number; velocity: number }[];
  avgPitch: number;
  name: string;
}

/**
 * Decide which groups (tracks, or channels within one track) are the left and right hands.
 * - Track/channel names containing "left"/"LH"/"bass" or "right"/"RH"/"treble" win.
 * - Otherwise the group with the higher average pitch is the right hand.
 * - With only one group, split at middle C.
 */
function assignHands(groups: Group[]): Map<string, Hand | 'split'> {
  const out = new Map<string, Hand | 'split'>();
  if (groups.length === 1) {
    out.set(groups[0].key, 'split');
    return out;
  }
  const named = (g: Group): Hand | undefined => {
    const n = g.name.toLowerCase();
    if (/\b(left|lh|bass|l\.h\.)\b|left hand/.test(n)) return 'L';
    if (/\b(right|rh|treble|melody|r\.h\.)\b|right hand/.test(n)) return 'R';
    return undefined;
  };
  const byPitch = [...groups].sort((a, b) => b.avgPitch - a.avgPitch);
  const highest = byPitch[0];
  for (const g of groups) out.set(g.key, named(g) ?? (g === highest ? 'R' : 'L'));
  // If names put everything on one hand, fall back to pitch.
  const hands = new Set(out.values());
  if (hands.size === 1) for (const g of groups) out.set(g.key, g === highest ? 'R' : 'L');
  return out;
}

function groupsByChannel(data: ArrayBuffer | Uint8Array, midi: Midi, name: string): Group[] {
  const raw = parseMidiFile(data instanceof Uint8Array ? data : new Uint8Array(data));
  const channels = new Map<number, Group>();
  for (const track of raw.tracks) {
    let tick = 0;
    const open = new Map<string, { tick: number; velocity: number }>();
    for (const ev of track) {
      tick += ev.deltaTime;
      if (ev.type !== 'noteOn' && ev.type !== 'noteOff') continue;
      if (ev.channel === 9) continue;
      const k = `${ev.channel}/${ev.noteNumber}`;
      if (ev.type === 'noteOn' && ev.velocity > 0) {
        open.set(k, { tick, velocity: ev.velocity });
        continue;
      }
      const on = open.get(k);
      if (!on) continue;
      open.delete(k);
      if (!channels.has(ev.channel)) channels.set(ev.channel, { key: `c${ev.channel}`, name, avgPitch: 0, notes: [] });
      const start = midi.header.ticksToSeconds(on.tick);
      channels.get(ev.channel)!.notes.push({
        pitch: ev.noteNumber,
        start,
        duration: midi.header.ticksToSeconds(tick) - start,
        velocity: on.velocity / 127,
      });
    }
  }
  return [...channels.values()].filter((g) => g.notes.length);
}

export function parseMidi(data: ArrayBuffer | Uint8Array, fallbackTitle = 'Untitled'): Song {
  let midi: Midi;
  try {
    midi = new Midi(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch (e) {
    throw new ImportError(`Could not read MIDI file: ${(e as Error).message}`);
  }

  // Drop percussion (channel 10) and empty tracks.
  const tracks = midi.tracks.filter((t) => t.notes.length && t.channel !== 9);
  if (!tracks.length) throw new ImportError('The MIDI file has no piano notes.');

  let groups: Group[] = [];
  if (tracks.length === 1) {
    // One track (e.g. a type-0 file): @tonejs/midi merges its channels, so split them
    // back out from the raw events. One channel ends up as a single group (split at C4).
    groups = groupsByChannel(data, midi, tracks[0].name);
  } else {
    groups = tracks.map((t, i) => ({
      key: `t${i}`,
      name: t.name || t.instrument?.name || '',
      avgPitch: 0,
      notes: t.notes.map((n) => ({ pitch: n.midi, start: n.time, duration: n.duration, velocity: n.velocity })),
    }));
  }
  for (const g of groups) g.avgPitch = g.notes.reduce((s, n) => s + n.pitch, 0) / g.notes.length;
  const handMap = assignHands(groups);

  // Measures from the header's time signatures and tempo map.
  const ppq = midi.header.ppq;
  const lastTick = Math.max(...tracks.map((t) => t.endOfTrackTicks ?? t.durationTicks));
  const sigs = midi.header.timeSignatures.length
    ? midi.header.timeSignatures
    : [{ ticks: 0, timeSignature: [4, 4] as number[], measures: 0 }];
  const measures: Measure[] = [];
  let tick = 0;
  let sigIdx = 0;
  while (tick < lastTick - 1 || measures.length === 0) {
    while (sigIdx + 1 < sigs.length && sigs[sigIdx + 1].ticks <= tick) sigIdx++;
    const [beats, beatType] = sigs[sigIdx].timeSignature;
    const len = Math.round(beats * ppq * (4 / beatType));
    const start = midi.header.ticksToSeconds(tick);
    const end = midi.header.ticksToSeconds(tick + len);
    measures.push({ index: measures.length, number: measures.length + 1, start, duration: end - start, beats, beatType });
    tick += len;
    if (measures.length > 5000) break;
  }
  const measureOf = (t: number) => {
    let i = 0;
    while (i + 1 < measures.length && measures[i + 1].start <= t + 1e-6) i++;
    return i;
  };

  const notes: Note[] = [];
  for (const g of groups) {
    const h = handMap.get(g.key)!;
    for (const n of g.notes) {
      notes.push({
        id: 0,
        pitch: n.pitch,
        start: n.start,
        duration: Math.max(0.02, n.duration),
        hand: h === 'split' ? (n.pitch >= 60 ? 'R' : 'L') : h,
        velocity: Math.round(n.velocity * 127),
        measure: measureOf(n.start),
      });
    }
  }

  const tempos = midi.header.tempos.length
    ? midi.header.tempos.map((t) => ({ time: t.time ?? midi.header.ticksToSeconds(t.ticks), bpm: t.bpm }))
    : [{ time: 0, bpm: 120 }];

  return finalizeSong({
    id: crypto.randomUUID(),
    title: midi.name || fallbackTitle,
    notes,
    measures,
    tempos,
    sourceKind: 'midi',
    addedAt: Date.now(),
  });
}

export async function importMidiFile(file: File): Promise<Song> {
  return parseMidi(await file.arrayBuffer(), file.name.replace(/\.midi?$/i, ''));
}

/**
 * Generate readable MusicXML (a grand staff) from a Song's notes.
 *
 * MIDI files and audio transcriptions have no notation, but the sheet-music practice view
 * needs a score. This quantises notes to a 16th-note grid, puts the right hand on the
 * treble staff and the left hand on the bass staff, estimates the key signature, spells
 * accidentals to suit it, and fills gaps with rests. Each staff is written as one voice
 * (chords allowed), so a note held while the same hand plays other notes is shortened.
 * That keeps it readable, which is the point.
 */
import type { Hand, Song } from '../model/song';
import { secToQuarter } from '../model/time';

const DIV = 4; // divisions per quarter: 16th-note grid

// Krumhansl–Kessler key profiles
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// Tonic pitch class -> fifths, for major keys
const MAJOR_FIFTHS: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };

function correlate(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / 12;
  const mb = b.reduce((s, x) => s + x, 0) / 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Estimate the key signature (in fifths, −6..+6) from a duration-weighted pitch-class histogram. */
export function estimateFifths(notes: { pitch: number; duration: number }[]): number {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[n.pitch % 12] += Math.max(0.1, n.duration);
  let best = { r: -Infinity, fifths: 0 };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - tonic + 12) % 12]);
    const rMaj = correlate(hist, rot(MAJOR));
    if (rMaj > best.r) best = { r: rMaj, fifths: MAJOR_FIFTHS[tonic] };
    const rMin = correlate(hist, rot(MINOR));
    // A minor key shares the signature of the major key 3 semitones up.
    if (rMin > best.r) best = { r: rMin, fifths: MAJOR_FIFTHS[(tonic + 3) % 12] };
  }
  return best.fifths === -6 ? 6 : best.fifths;
}

const SHARP_NAMES: [string, number][] = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_NAMES: [string, number][] = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

export function spell(pitch: number, fifths: number): { step: string; alter: number; octave: number } {
  const [step, alter] = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[pitch % 12];
  // B# / Cb never occur with these tables, so the octave is simply floor(pitch / 12) - 1.
  return { step, alter, octave: Math.floor(pitch / 12) - 1 };
}

const TYPES: [number, string, boolean][] = [
  [16, 'whole', false],
  [12, 'half', true],
  [8, 'half', false],
  [6, 'quarter', true],
  [4, 'quarter', false],
  [3, 'eighth', true],
  [2, 'eighth', false],
  [1, '16th', false],
];

/** Split a duration (in 16ths) into written note values, aligned to the beat where possible. */
export function splitDuration(start: number, dur: number): number[] {
  const out: number[] = [];
  let pos = start;
  let left = dur;
  while (left > 0) {
    // Off the beat, don't write across the next beat (show the beat); on the beat, anything that fits.
    const room = pos % 4 === 0 ? left : Math.min(left, 4 - (pos % 4));
    const v = TYPES.find(([d]) => d <= room)?.[0] ?? 1;
    out.push(v);
    pos += v;
    left -= v;
  }
  return out;
}

interface QNote {
  pitch: number;
  start: number; // 16ths from measure start
  dur: number; // 16ths
}

function noteXml(
  pitches: number[] | null,
  dur: number,
  staff: number,
  fifths: number,
  tie: { start: boolean; stop: boolean },
): string {
  const [, type, dot] = TYPES.find(([d]) => d === dur) ?? [dur, 'quarter', false];
  const voice = staff === 1 ? 1 : 5;
  if (!pitches) return `<note><rest/><duration>${dur}</duration><voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}<staff>${staff}</staff></note>`;
  return pitches
    .map((p, i) => {
      const { step, alter, octave } = spell(p, fifths);
      const ties = `${tie.stop ? '<tie type="stop"/>' : ''}${tie.start ? '<tie type="start"/>' : ''}`;
      const tied = tie.start || tie.stop ? `<notations>${tie.stop ? '<tied type="stop"/>' : ''}${tie.start ? '<tied type="start"/>' : ''}</notations>` : '';
      return `<note>${i ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${dur}</duration>${ties}<voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}<staff>${staff}</staff>${tied}</note>`;
    })
    .join('');
}

/** Write one staff of one measure: chords in a single voice, gaps as rests, values split with ties. */
function staffMeasureXml(notes: QNote[], len: number, staff: number, fifths: number, carryIn: QNote[]): { xml: string; carryOut: QNote[] } {
  // Group into chords by start.
  const byStart = new Map<number, QNote[]>();
  for (const n of [...carryIn, ...notes]) {
    if (!byStart.has(n.start)) byStart.set(n.start, []);
    byStart.get(n.start)!.push(n);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const carried = new Set(carryIn);
  let xml = '';
  let pos = 0;
  const carryOut: QNote[] = [];
  starts.forEach((st, i) => {
    if (st > pos) {
      for (const d of splitDuration(pos, st - pos)) {
        xml += noteXml(null, d, staff, fifths, { start: false, stop: false });
      }
      pos = st;
    }
    if (st < pos) return; // overlapped by the previous chord: skip (single voice)
    const chord = byStart.get(st)!;
    const nextStart = starts[i + 1] ?? len;
    let want = Math.max(...chord.map((n) => n.dur));
    // Played notes are usually a little shorter than written: close small gaps (legato).
    const gap = nextStart - (st + want);
    if (gap > 0 && gap <= Math.max(1, Math.round(want * 0.25))) want = nextStart - st;
    const dur = Math.max(1, Math.min(want, nextStart - st, len - st));
    const pitches = [...new Set(chord.map((n) => n.pitch))].sort((a, b) => a - b);
    const isCarry = chord.some((n) => carried.has(n));
    const continues = want > len - st && dur === len - st; // runs past the barline
    const parts = splitDuration(st, dur);
    parts.forEach((d, k) => {
      xml += noteXml(pitches, d, staff, fifths, {
        stop: k > 0 || isCarry,
        start: k < parts.length - 1 || continues,
      });
    });
    if (continues) for (const n of chord) carryOut.push({ pitch: n.pitch, start: 0, dur: n.dur - (len - st) });
    pos = st + dur;
  });
  if (pos < len) for (const d of splitDuration(pos, len - pos)) xml += noteXml(null, d, staff, fifths, { start: false, stop: false });
  return { xml, carryOut };
}

export function generateMusicXml(song: Song): string {
  const fifths = song.keyFifths ?? (song.notes.length ? estimateFifths(song.notes) : 0);
  const bars = song.measures.map((m) => {
    const startQ = secToQuarter(song, m.start);
    const lenQ = secToQuarter(song, m.start + m.duration) - startQ;
    return { m, startQ, len: Math.max(1, Math.round(lenQ * DIV)) };
  });
  // Quantise and bucket notes per bar and hand.
  const buckets = bars.map(() => ({ R: [] as QNote[], L: [] as QNote[] }));
  for (const n of song.notes) {
    const q = secToQuarter(song, n.start);
    const qEnd = secToQuarter(song, n.start + n.duration);
    let bi = bars.findIndex((b, i) => q >= b.startQ - 1e-6 && (i === bars.length - 1 || q < bars[i + 1].startQ - 1e-6));
    if (bi < 0) bi = q < 0 ? 0 : bars.length - 1;
    const b = bars[bi];
    let start = Math.round((q - b.startQ) * DIV);
    if (start >= b.len) {
      if (bi + 1 < bars.length) {
        bi++;
        start = 0;
      } else start = b.len - 1;
    }
    const dur = Math.max(1, Math.round((qEnd - q) * DIV));
    buckets[bi][n.hand as Hand].push({ pitch: n.pitch, start: Math.max(0, start), dur });
  }

  let carry: Record<Hand, QNote[]> = { R: [], L: [] };
  const measuresXml = bars.map((b, i) => {
    const prevBeats = i > 0 ? song.measures[i - 1] : undefined;
    const timeChanged = !prevBeats || prevBeats.beats !== b.m.beats || prevBeats.beatType !== b.m.beatType;
    const nominal = Math.round(((b.m.beats * 4) / b.m.beatType) * DIV);
    let attrs = '';
    if (i === 0 || timeChanged) {
      attrs =
        `<attributes>${i === 0 ? `<divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key>` : ''}` +
        `<time><beats>${b.m.beats}</beats><beat-type>${b.m.beatType}</beat-type></time>` +
        (i === 0 ? `<staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>` : '') +
        `</attributes>`;
    }
    const tempo = i === 0 ? `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(song.tempos[0]?.bpm ?? 100)}</per-minute></metronome></direction-type><sound tempo="${song.tempos[0]?.bpm ?? 100}"/></direction>` : '';
    const r = staffMeasureXml(buckets[i].R, b.len, 1, fifths, carry.R);
    const l = staffMeasureXml(buckets[i].L, b.len, 2, fifths, carry.L);
    carry = { R: r.carryOut, L: l.carryOut };
    const implicit = b.len < nominal ? ' implicit="yes"' : '';
    return `<measure number="${b.m.number}"${implicit}>${attrs}${tempo}${r.xml}<backup><duration>${b.len}</duration></backup>${l.xml}</measure>`;
  });

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
<work><work-title>${esc(song.title)}</work-title></work>
<identification>${song.composer ? `<creator type="composer">${esc(song.composer)}</creator>` : ''}<encoding><software>${song.sourceKind === 'written' ? 'KeyFall' : `KeyFall (generated from ${song.sourceKind.toUpperCase()})`}</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${measuresXml.join('\n')}
</part>
</score-partwise>
`;
}

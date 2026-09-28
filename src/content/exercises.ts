/**
 * Built-in exercises: five-finger patterns, scales, arpeggios and chord progressions.
 * Each one is generated as a normal Song, so it works with every mode, the sheet-music
 * view, finger numbers, progress tracking and guided practice.
 *
 * Fingerings are the standard textbook ones and are marked as coming from the "score".
 */
import { buildMeasureGrid, finalizeSong, type Finger, type Hand, type Note, type Song } from '../model/song';

/** Bump when exercises change, so copies saved in the library are rebuilt. */
export const EXERCISE_VERSION = 2;

export interface ExerciseInfo {
  id: string;
  title: string;
  category: 'Five-finger' | 'Major scales' | 'Minor scales' | 'Other scales' | 'Arpeggios' | 'Chords' | 'Technique';
  level: 'Beginner' | 'Early intermediate';
  description: string;
}

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pc = (name: string) => NAMES[name[0]] + (name.includes('#') ? 1 : name.includes('b') && name.length > 1 ? -1 : 0);

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const NAT_MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11, 12];
const MEL_MINOR_UP = [0, 2, 3, 5, 7, 9, 11, 12];

// Standard one-octave fingerings, up then down.
const RH_CGDAE = [1, 2, 3, 1, 2, 3, 4, 5];
const LH_CGDAE = [5, 4, 3, 2, 1, 3, 2, 1];
const RH_F = [1, 2, 3, 4, 1, 2, 3, 4];
// Black-key and flat keys (one octave, ascending; descending uses the same fingers reversed).
const FINGERS: Record<string, [number[], number[]]> = {
  B: [[1, 2, 3, 1, 2, 3, 4, 5], [4, 3, 2, 1, 4, 3, 2, 1]],
  'F#': [[2, 3, 4, 1, 2, 3, 1, 2], [4, 3, 2, 1, 3, 2, 1, 4]],
  Bb: [[2, 1, 2, 3, 1, 2, 3, 4], [3, 2, 1, 4, 3, 2, 1, 3]],
  Eb: [[3, 1, 2, 3, 4, 1, 2, 3], [3, 2, 1, 4, 3, 2, 1, 3]],
  Ab: [[3, 4, 1, 2, 3, 1, 2, 3], [3, 2, 1, 4, 3, 2, 1, 3]],
  Db: [[2, 3, 1, 2, 3, 4, 1, 2], [3, 2, 1, 4, 3, 2, 1, 3]],
};

interface Ev {
  hand: Hand;
  pitches: number[];
  fingers?: Finger[];
  beats: number;
}

function build(id: string, title: string, bpm: number, lines: Ev[][], beatsPerBar = 4): Song {
  const q = 60 / bpm;
  const notes: Note[] = [];
  let end = 0;
  for (const line of lines) {
    let t = 0;
    for (const ev of line) {
      ev.pitches.forEach((p, i) =>
        notes.push({
          id: 0,
          pitch: p,
          start: t * q,
          duration: ev.beats * q * 0.95,
          hand: ev.hand,
          finger: ev.fingers?.[i],
          fingerSource: ev.fingers?.[i] ? 'score' : undefined,
          velocity: 80,
          measure: Math.floor(t / beatsPerBar),
          staff: ev.hand === 'R' ? 1 : 2,
        }),
      );
      t += ev.beats;
    }
    end = Math.max(end, t);
  }
  const measures = buildMeasureGrid(end * q, bpm, beatsPerBar, 4);
  return finalizeSong({ id: `exercise:${id}`, title, notes, measures, tempos: [{ time: 0, bpm }], sourceKind: 'exercise', addedAt: Date.now(), importerVersion: EXERCISE_VERSION });
}

/**
 * Up and back down, both hands (LH an octave lower, or mirrored for contrary motion). Ends on a
 * half note. `downSteps` differ from the way up for melodic minor; `lhSteps` for contrary motion.
 */
function scale(
  id: string,
  title: string,
  rootName: string,
  steps: number[],
  rh: number[],
  lh: number[],
  opts: { downSteps?: number[]; lhSteps?: number[]; lhRootOffset?: number; bpm?: number } = {},
): Song {
  const rootR = 60 + (pc(rootName) + 12) % 12;
  const rootL = rootR + (opts.lhRootOffset ?? -12);
  const lineFor = (hand: Hand, root: number, upSteps: number[], downSteps: number[], fingers: number[]): Ev[] => {
    const down = [...downSteps].reverse().slice(1);
    const downF = [...fingers].reverse().slice(1);
    return [
      ...upSteps.map((s, i) => ({ hand, pitches: [root + s], fingers: [fingers[i] as Finger], beats: 1 })),
      ...down.map((s, k) => ({ hand, pitches: [root + s], fingers: [downF[k] as Finger], beats: k === down.length - 1 ? 2 : 1 })),
    ];
  };
  const lhUp = opts.lhSteps ?? steps;
  const lhDown = opts.lhSteps ?? opts.downSteps ?? steps;
  return build(id, title, opts.bpm ?? 80, [lineFor('R', rootR, steps, opts.downSteps ?? steps, rh), lineFor('L', rootL, lhUp, lhDown, lh)]);
}

function flatMajor(key: string, name: string): Song {
  const [rh, lh] = FINGERS[key];
  return scale(`scale-${key}`, `${name} major scale`, key, MAJOR, rh, lh);
}

/** Chromatic scale: one octave up and down, every key. */
function chromatic(): Song {
  const steps = Array.from({ length: 13 }, (_, i) => i);
  // RH: 1 on white keys (2 on F and top C), 3 on black. LH: 1 on white keys (2 on E and B), 3 on black.
  const rh = [1, 3, 1, 3, 1, 2, 3, 1, 3, 1, 3, 1, 2];
  const lh = [1, 3, 1, 3, 2, 1, 3, 1, 3, 1, 3, 2, 1];
  const line = (hand: Hand, root: number, f: number[]): Ev[] => {
    const down = [...steps].reverse().slice(1);
    const downF = [...f].reverse().slice(1);
    // Eighth notes, the last one held: 13 up + 12 down = 4 bars of 4/4.
    return [
      ...steps.map((s, i) => ({ hand, pitches: [root + s], fingers: [f[i] as Finger], beats: 0.5 })),
      ...down.map((s, k) => ({ hand, pitches: [root + s], fingers: [downF[k] as Finger], beats: k === down.length - 1 ? 4 : 0.5 })),
    ];
  };
  return build('chromatic-C', 'Chromatic scale from C', 72, [line('R', 60, rh), line('L', 48, lh)]);
}

function twoOctaveC(): Song {
  const steps = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  const rh = [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5];
  const lh = [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1];
  const line = (hand: Hand, root: number, f: number[]): Ev[] => {
    const down = [...steps].reverse().slice(1);
    const downF = [...f].reverse().slice(1);
    return [
      ...steps.map((s, i) => ({ hand, pitches: [root + s], fingers: [f[i] as Finger], beats: 0.5 })),
      ...down.map((s, k) => ({ hand, pitches: [root + s], fingers: [downF[k] as Finger], beats: k === down.length - 1 ? 2 : 0.5 })),
    ];
  };
  return build('scale-C-2oct', 'C major scale, two octaves', 72, [line('R', 60, rh), line('L', 48, lh)]);
}

function fiveFinger(id: string, rootName: string): Song {
  const r = 60 + pc(rootName);
  const pat = [0, 2, 4, 5, 7, 5, 4, 2, 0];
  // Both hands together (LH an octave lower), so there's always something to play with either hand.
  const R: Ev[] = pat.map((s, i) => ({ hand: 'R', pitches: [r + s], fingers: [([1, 2, 3, 4, 5, 4, 3, 2, 1][i]) as Finger], beats: i === pat.length - 1 ? 4 : 1 }));
  const L: Ev[] = pat.map((s, i) => ({ hand: 'L', pitches: [r - 12 + s], fingers: [([5, 4, 3, 2, 1, 2, 3, 4, 5][i]) as Finger], beats: i === pat.length - 1 ? 4 : 1 }));
  return build(id, `${rootName} five-finger position`, 90, [R, L]);
}

function arpeggio(id: string, rootName: string, minor = false): Song {
  const r = 60 + pc(rootName);
  const shape = minor ? [0, 3, 7, 12, 7, 3, 0] : [0, 4, 7, 12, 7, 4, 0];
  const rhF = [1, 2, 3, 5, 3, 2, 1];
  const lhF = [5, 4, 2, 1, 2, 4, 5];
  const line = (hand: Hand, root: number, f: number[]): Ev[] => shape.map((s, i) => ({ hand, pitches: [root + s], fingers: [f[i] as Finger], beats: i === shape.length - 1 ? 2 : 1 }));
  // 6 quarters + a half = 8 beats = 2 bars
  return build(id, `${rootName} ${minor ? 'minor' : 'major'} arpeggio`, 80, [line('R', r, rhF), line('L', r - 12, lhF)]);
}

/** Block chords in the right hand over roots in the left, one chord per bar. */
function chords(id: string, title: string, bpm: number, bars: { rh: number[]; f: Finger[]; bass: number; lf?: Finger }[]): Song {
  const R: Ev[] = bars.map((b) => ({ hand: 'R', pitches: b.rh, fingers: b.f, beats: 4 }));
  const L: Ev[] = bars.map((b) => ({ hand: 'L', pitches: [b.bass], fingers: [b.lf ?? 5], beats: 4 }));
  return build(id, title, bpm, [R, L]);
}

/** 12-bar blues in C: boogie bass (root–5th–6th–5th) and a chord per bar. */
function blues(): Song {
  const bass = (root: number): Ev[] => [0, 7, 9, 7].map((s, i) => ({ hand: 'L' as Hand, pitches: [root + s], fingers: [([5, 2, 1, 2][i]) as Finger], beats: 1 }));
  const C = { rh: [60, 64, 67], f: [1, 3, 5] as Finger[], root: 48 };
  const F = { rh: [60, 65, 69], f: [1, 3, 5] as Finger[], root: 41 };
  const G = { rh: [59, 62, 67], f: [1, 2, 5] as Finger[], root: 43 };
  const form = [C, C, C, C, F, F, C, C, G, F, C, C];
  return build('blues-C', '12-bar blues in C', 100, [form.map((c) => ({ hand: 'R', pitches: c.rh, fingers: c.f, beats: 4 })), form.flatMap((c) => bass(c.root))]);
}

/** Alberti bass (low–high–middle–high) under a simple melody: C, F, G, C. */
function alberti(): Song {
  const pattern = (lo: number, mid: number, hi: number): Ev[] =>
    [lo, hi, mid, hi, lo, hi, mid, hi].map((p, i) => ({ hand: 'L' as Hand, pitches: [p], fingers: [([5, 1, 3, 1][i % 4]) as Finger], beats: 0.5 }));
  const L = [...pattern(48, 52, 55), ...pattern(48, 53, 57), ...pattern(47, 50, 55), ...pattern(48, 52, 55)];
  const R: Ev[] = [
    { hand: 'R', pitches: [64], fingers: [3], beats: 4 },
    { hand: 'R', pitches: [65], fingers: [4], beats: 4 },
    { hand: 'R', pitches: [62], fingers: [2], beats: 4 },
    { hand: 'R', pitches: [60], fingers: [1], beats: 4 },
  ];
  return build('alberti-C', 'Alberti bass in C', 80, [R, L]);
}

/** Hanon, The Virtuoso Pianist, No. 1 (1873, public domain): the first eight groups, going up. */
function hanon1(): Song {
  const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const deg = (d: number) => Math.floor(d / 7) * 12 + C_MAJOR[((d % 7) + 7) % 7];
  const group = [0, 2, 3, 4, 5, 4, 3, 2];
  const line = (hand: Hand, root: number, f: number[]): Ev[] => [
    ...Array.from({ length: 8 }, (_, g) => group.map((x, i) => ({ hand, pitches: [root + deg(g + x)], fingers: [f[i] as Finger], beats: 0.25 }))).flat(),
    { hand, pitches: [root + 12], fingers: [(hand === 'R' ? 1 : 5) as Finger], beats: 4 },
  ];
  return build('hanon-1', 'Hanon No. 1 (first groups)', 60, [line('R', 60, [1, 2, 3, 4, 5, 4, 3, 2]), line('L', 48, [5, 4, 3, 2, 1, 2, 3, 4])]);
}

/** I – IV – V – I with close voicings in the right hand and the roots in the left. */
function progression(id: string, rootName: string): Song {
  const r = 60 + pc(rootName);
  // I (root position), IV (second inversion), V (first inversion), I
  const rh: [number[], Finger[]][] = [
    [[r, r + 4, r + 7], [1, 3, 5]],
    [[r, r + 5, r + 9], [1, 3, 5]],
    [[r - 1, r + 2, r + 7], [1, 2, 5]],
    [[r, r + 4, r + 7], [1, 3, 5]],
  ];
  const bass = [r - 12, r - 7, r - 5, r - 12];
  const lhF: Finger[] = [5, 2, 1, 5];
  const R: Ev[] = rh.map(([p, f]) => ({ hand: 'R', pitches: p, fingers: f, beats: 4 }));
  const L: Ev[] = bass.map((p, i) => ({ hand: 'L', pitches: [p], fingers: [lhF[i]], beats: 4 }));
  return build(id, `I–IV–V–I in ${rootName} major`, 72, [R, L]);
}

const MAKERS: Record<string, () => Song> = {
  'five-C': () => fiveFinger('five-C', 'C'),
  'five-G': () => fiveFinger('five-G', 'G'),
  'scale-C': () => scale('scale-C', 'C major scale', 'C', MAJOR, RH_CGDAE, LH_CGDAE),
  'scale-G': () => scale('scale-G', 'G major scale', 'G', MAJOR, RH_CGDAE, LH_CGDAE),
  'scale-D': () => scale('scale-D', 'D major scale', 'D', MAJOR, RH_CGDAE, LH_CGDAE),
  'scale-A': () => scale('scale-A', 'A major scale', 'A', MAJOR, RH_CGDAE, LH_CGDAE),
  'scale-E': () => scale('scale-E', 'E major scale', 'E', MAJOR, RH_CGDAE, LH_CGDAE),
  'scale-F': () => scale('scale-F', 'F major scale', 'F', MAJOR, RH_F, LH_CGDAE),
  'minor-A': () => scale('minor-A', 'A natural minor scale', 'A', NAT_MINOR, RH_CGDAE, LH_CGDAE),
  'minor-E': () => scale('minor-E', 'E natural minor scale', 'E', NAT_MINOR, RH_CGDAE, LH_CGDAE),
  'minor-D': () => scale('minor-D', 'D natural minor scale', 'D', NAT_MINOR, RH_CGDAE, LH_CGDAE),
  'scale-B': () => flatMajor('B', 'B'),
  'scale-F#': () => flatMajor('F#', 'F♯'),
  'scale-Bb': () => flatMajor('Bb', 'B♭'),
  'scale-Eb': () => flatMajor('Eb', 'E♭'),
  'scale-Ab': () => flatMajor('Ab', 'A♭'),
  'scale-Db': () => flatMajor('Db', 'D♭'),
  'harm-A': () => scale('harm-A', 'A harmonic minor scale', 'A', HARM_MINOR, RH_CGDAE, LH_CGDAE),
  'harm-D': () => scale('harm-D', 'D harmonic minor scale', 'D', HARM_MINOR, RH_CGDAE, LH_CGDAE),
  'harm-E': () => scale('harm-E', 'E harmonic minor scale', 'E', HARM_MINOR, RH_CGDAE, LH_CGDAE),
  'harm-G': () => scale('harm-G', 'G harmonic minor scale', 'G', HARM_MINOR, RH_CGDAE, LH_CGDAE),
  'harm-C': () => scale('harm-C', 'C harmonic minor scale', 'C', HARM_MINOR, RH_CGDAE, LH_CGDAE),
  'mel-A': () => scale('mel-A', 'A melodic minor scale', 'A', MEL_MINOR_UP, RH_CGDAE, LH_CGDAE, { downSteps: NAT_MINOR }),
  'chromatic-C': () => chromatic(),
  'scale-C-2oct': () => twoOctaveC(),
  'contrary-C': () =>
    scale('contrary-C', 'C major scale, contrary motion', 'C', MAJOR, RH_CGDAE, [1, 2, 3, 1, 2, 3, 4, 5], { lhSteps: [0, -1, -3, -5, -7, -8, -10, -12], lhRootOffset: 0 }),
  'arp-C': () => arpeggio('arp-C', 'C'),
  'arp-G': () => arpeggio('arp-G', 'G'),
  'arp-F': () => arpeggio('arp-F', 'F'),
  'arp-Am': () => arpeggio('arp-Am', 'A', true),
  'arp-Dm': () => arpeggio('arp-Dm', 'D', true),
  'arp-Em': () => arpeggio('arp-Em', 'E', true),
  'pop-C': () =>
    chords('pop-C', 'I–V–vi–IV in C (pop progression)', 80, [
      { rh: [60, 64, 67], f: [1, 3, 5], bass: 48 },
      { rh: [59, 62, 67], f: [1, 2, 5], bass: 43 },
      { rh: [60, 64, 69], f: [1, 2, 5], bass: 45 },
      { rh: [60, 65, 69], f: [1, 3, 5], bass: 41 },
    ]),
  'pop-G': () =>
    chords('pop-G', 'I–V–vi–IV in G (pop progression)', 80, [
      { rh: [62, 67, 71], f: [1, 3, 5], bass: 43 },
      { rh: [62, 66, 69], f: [1, 2, 4], bass: 50 },
      { rh: [64, 67, 71], f: [1, 2, 4], bass: 52 },
      { rh: [64, 67, 72], f: [1, 2, 5], bass: 48 },
    ]),
  'two-five-one-C': () =>
    chords('two-five-one-C', 'ii–V–I in C', 72, [
      { rh: [62, 65, 69], f: [1, 3, 5], bass: 50 },
      { rh: [62, 67, 71], f: [1, 3, 5], bass: 43 },
      { rh: [60, 64, 67], f: [1, 3, 5], bass: 48 },
      { rh: [60, 64, 67], f: [1, 3, 5], bass: 48 },
    ]),
  'blues-C': () => blues(),
  'alberti-C': () => alberti(),
  'hanon-1': () => hanon1(),
  'prog-C': () => progression('prog-C', 'C'),
  'prog-G': () => progression('prog-G', 'G'),
  'prog-F': () => progression('prog-F', 'F'),
};

export const EXERCISES: ExerciseInfo[] = [
  { id: 'five-C', title: 'C five-finger position', category: 'Five-finger', level: 'Beginner', description: 'One finger per key, C to G, up and back. Each hand alone, then together.' },
  { id: 'five-G', title: 'G five-finger position', category: 'Five-finger', level: 'Beginner', description: 'The same shape starting on G.' },
  { id: 'scale-C', title: 'C major scale', category: 'Major scales', level: 'Beginner', description: 'No sharps or flats. Thumb tucks under after 3.' },
  { id: 'scale-G', title: 'G major scale', category: 'Major scales', level: 'Beginner', description: 'One sharp: F♯.' },
  { id: 'scale-F', title: 'F major scale', category: 'Major scales', level: 'Beginner', description: 'One flat: B♭. Right hand tucks after 4.' },
  { id: 'scale-D', title: 'D major scale', category: 'Major scales', level: 'Early intermediate', description: 'Two sharps: F♯ and C♯.' },
  { id: 'scale-A', title: 'A major scale', category: 'Major scales', level: 'Early intermediate', description: 'Three sharps: F♯, C♯, G♯.' },
  { id: 'scale-E', title: 'E major scale', category: 'Major scales', level: 'Early intermediate', description: 'Four sharps: F♯, C♯, G♯, D♯.' },
  { id: 'scale-B', title: 'B major scale', category: 'Major scales', level: 'Early intermediate', description: 'Five sharps. Left hand starts on 4.' },
  { id: 'scale-F#', title: 'F♯ major scale', category: 'Major scales', level: 'Early intermediate', description: 'Six sharps: almost all black keys.' },
  { id: 'scale-Bb', title: 'B♭ major scale', category: 'Major scales', level: 'Early intermediate', description: 'Two flats: B♭ and E♭.' },
  { id: 'scale-Eb', title: 'E♭ major scale', category: 'Major scales', level: 'Early intermediate', description: 'Three flats: B♭, E♭, A♭.' },
  { id: 'scale-Ab', title: 'A♭ major scale', category: 'Major scales', level: 'Early intermediate', description: 'Four flats: B♭, E♭, A♭, D♭.' },
  { id: 'scale-Db', title: 'D♭ major scale', category: 'Major scales', level: 'Early intermediate', description: 'Five flats. Thumbs on C and F.' },
  { id: 'minor-A', title: 'A natural minor scale', category: 'Minor scales', level: 'Beginner', description: 'The white keys from A to A.' },
  { id: 'minor-E', title: 'E natural minor scale', category: 'Minor scales', level: 'Beginner', description: 'One sharp: F♯.' },
  { id: 'minor-D', title: 'D natural minor scale', category: 'Minor scales', level: 'Beginner', description: 'One flat: B♭.' },
  { id: 'harm-A', title: 'A harmonic minor scale', category: 'Minor scales', level: 'Beginner', description: 'Natural minor with a raised 7th (G♯).' },
  { id: 'harm-D', title: 'D harmonic minor scale', category: 'Minor scales', level: 'Early intermediate', description: 'B♭ and C♯.' },
  { id: 'harm-E', title: 'E harmonic minor scale', category: 'Minor scales', level: 'Early intermediate', description: 'F♯ and D♯.' },
  { id: 'harm-G', title: 'G harmonic minor scale', category: 'Minor scales', level: 'Early intermediate', description: 'B♭, E♭ and F♯.' },
  { id: 'harm-C', title: 'C harmonic minor scale', category: 'Minor scales', level: 'Early intermediate', description: 'E♭, A♭ and B natural.' },
  { id: 'mel-A', title: 'A melodic minor scale', category: 'Minor scales', level: 'Early intermediate', description: 'F♯ and G♯ going up, natural coming down.' },
  { id: 'chromatic-C', title: 'Chromatic scale', category: 'Other scales', level: 'Beginner', description: 'Every key from C to C. 3 on the black keys.' },
  { id: 'scale-C-2oct', title: 'C major, two octaves', category: 'Other scales', level: 'Early intermediate', description: 'The thumb crosses twice each way.' },
  { id: 'contrary-C', title: 'C major, contrary motion', category: 'Other scales', level: 'Beginner', description: 'Thumbs start on middle C; the hands move apart.' },
  { id: 'arp-C', title: 'C major arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'C–E–G–C, up and down.' },
  { id: 'arp-G', title: 'G major arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'G–B–D–G, up and down.' },
  { id: 'arp-F', title: 'F major arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'F–A–C–F, up and down.' },
  { id: 'arp-Am', title: 'A minor arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'A–C–E–A, up and down.' },
  { id: 'arp-Dm', title: 'D minor arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'D–F–A–D, up and down.' },
  { id: 'arp-Em', title: 'E minor arpeggio', category: 'Arpeggios', level: 'Beginner', description: 'E–G–B–E, up and down.' },
  { id: 'prog-C', title: 'I–IV–V–I in C major', category: 'Chords', level: 'Beginner', description: 'C, F, G, C: the most common chords in music.' },
  { id: 'prog-G', title: 'I–IV–V–I in G major', category: 'Chords', level: 'Beginner', description: 'G, C, D, G.' },
  { id: 'prog-F', title: 'I–IV–V–I in F major', category: 'Chords', level: 'Beginner', description: 'F, B♭, C, F.' },
  { id: 'pop-C', title: 'I–V–vi–IV in C', category: 'Chords', level: 'Beginner', description: 'C, G, Am, F: the chords behind countless pop songs.' },
  { id: 'pop-G', title: 'I–V–vi–IV in G', category: 'Chords', level: 'Beginner', description: 'G, D, Em, C.' },
  { id: 'two-five-one-C', title: 'ii–V–I in C', category: 'Chords', level: 'Early intermediate', description: 'Dm, G, C: the core of jazz harmony.' },
  { id: 'blues-C', title: '12-bar blues in C', category: 'Chords', level: 'Early intermediate', description: 'Boogie bass in the left hand, chords in the right.' },
  { id: 'alberti-C', title: 'Alberti bass', category: 'Technique', level: 'Beginner', description: 'The broken-chord accompaniment of Mozart and Haydn.' },
  { id: 'hanon-1', title: 'Hanon No. 1', category: 'Technique', level: 'Early intermediate', description: 'The classic finger exercise: even, independent fingers.' },
];

export function makeExercise(id: string): Song {
  const m = MAKERS[id];
  if (!m) throw new Error(`Unknown exercise ${id}`);
  return m();
}

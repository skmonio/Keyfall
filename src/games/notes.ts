/**
 * Note games.
 *  - Note Reader: a note appears on the staff; play it. Teaches reading.
 *  - Key Finder: a note name appears ("F♯"); play that key in any octave. Teaches the keyboard.
 */
export type Clef = 'treble' | 'bass' | 'both';
export type ReaderLevel = 1 | 2 | 3 | 4;

export interface Spelled {
  step: 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  alter: -1 | 0 | 1;
  octave: number;
}

export interface Question {
  pitch: number;
  spelled: Spelled;
  clef: 'treble' | 'bass';
}

const STEPS: Spelled['step'][] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_PC: Record<Spelled['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchOf(s: Spelled): number {
  return (s.octave + 1) * 12 + STEP_PC[s.step] + s.alter;
}

export function spelledName(s: Spelled): string {
  return `${s.step}${s.alter === 1 ? '♯' : s.alter === -1 ? '♭' : ''}`;
}

/** Natural notes (white keys) from `lo` to `hi`, as "C4"-style names. */
function naturals(lo: string, hi: string): Spelled[] {
  const parse = (x: string): Spelled => ({ step: x[0] as Spelled['step'], alter: 0, octave: Number(x.slice(1)) });
  const out: Spelled[] = [];
  let cur = parse(lo);
  const end = pitchOf(parse(hi));
  while (pitchOf(cur) <= end) {
    out.push(cur);
    const i = STEPS.indexOf(cur.step);
    cur = { step: STEPS[(i + 1) % 7], alter: 0, octave: cur.octave + (i === 6 ? 1 : 0) };
  }
  return out;
}

/** What each level asks, per clef. */
export const READER_LEVELS: Record<ReaderLevel, { name: string; description: string; treble: [string, string]; bass: [string, string]; accidentals: boolean }> = {
  1: { name: 'Around middle C', description: 'The first five notes each hand plays', treble: ['C4', 'G4'], bass: ['C3', 'G3'], accidentals: false },
  2: { name: 'On the staff', description: 'Every line and space', treble: ['E4', 'F5'], bass: ['G2', 'A3'], accidentals: false },
  3: { name: 'Ledger lines', description: 'Above and below the staff too', treble: ['A3', 'C6'], bass: ['C2', 'E4'], accidentals: false },
  4: { name: 'Sharps and flats', description: 'Ledger lines plus ♯ and ♭', treble: ['A3', 'C6'], bass: ['C2', 'E4'], accidentals: true },
};

export function readerPool(level: ReaderLevel, clef: Clef): Question[] {
  const L = READER_LEVELS[level];
  const clefs: ('treble' | 'bass')[] = clef === 'both' ? ['treble', 'bass'] : [clef];
  const out: Question[] = [];
  for (const c of clefs) {
    for (const n of naturals(...L[c])) {
      out.push({ pitch: pitchOf(n), spelled: n, clef: c });
      if (L.accidentals) {
        // Sharps on C D F G A, flats on D E G A B: every black key, spelled both ways.
        if (['C', 'D', 'F', 'G', 'A'].includes(n.step)) out.push({ pitch: pitchOf(n) + 1, spelled: { ...n, alter: 1 }, clef: c });
        if (['D', 'E', 'G', 'A', 'B'].includes(n.step)) out.push({ pitch: pitchOf(n) - 1, spelled: { ...n, alter: -1 }, clef: c });
      }
    }
  }
  return out;
}

/** Pick a question at random, never the same as the last one. */
export function pick<T extends { pitch: number }>(pool: T[], last?: T, rnd = Math.random): T {
  const options = pool.length > 1 && last ? pool.filter((q) => q.pitch !== last.pitch) : pool;
  return options[Math.floor(rnd() * options.length)];
}

export function isCorrect(target: number, played: number, anyOctave: boolean): boolean {
  return anyOctave ? ((played - target) % 12 + 12) % 12 === 0 : played === target;
}

/** Key Finder: note names to find, with or without black keys. */
export function finderPool(withAccidentals: boolean): Question[] {
  const out: Question[] = [];
  for (const step of STEPS) {
    const s: Spelled = { step, alter: 0, octave: 4 };
    out.push({ pitch: pitchOf(s), spelled: s, clef: 'treble' });
    if (withAccidentals) {
      if (['C', 'D', 'F', 'G', 'A'].includes(step)) out.push({ pitch: pitchOf(s) + 1, spelled: { ...s, alter: 1 }, clef: 'treble' });
      if (['D', 'E', 'G', 'A', 'B'].includes(step)) out.push({ pitch: pitchOf(s) - 1, spelled: { ...s, alter: -1 }, clef: 'treble' });
    }
  }
  return out;
}

/** A tiny MusicXML score showing one note on its clef (for the Note Reader). */
export function questionXml(q: Question): string {
  const clef = q.clef === 'treble' ? '<sign>G</sign><line>2</line>' : '<sign>F</sign><line>4</line>';
  const acc = q.spelled.alter === 1 ? '<accidental>sharp</accidental>' : q.spelled.alter === -1 ? '<accidental>flat</accidental>' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name print-object="no">Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time print-object="no"><beats>4</beats><beat-type>4</beat-type></time><clef>${clef}</clef></attributes>
<note><pitch><step>${q.spelled.step}</step>${q.spelled.alter ? `<alter>${q.spelled.alter}</alter>` : ''}<octave>${q.spelled.octave}</octave></pitch><duration>4</duration><type>whole</type>${acc}</note>
</measure></part></score-partwise>`;
}

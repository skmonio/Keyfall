// Generates the bundled public-domain test pieces in public/songs/.
// Run with: npm run make-samples
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '@tonejs/midi';
const { Midi } = pkg;

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'songs');
mkdirSync(OUT, { recursive: true });

// Token format: PITCH[+PITCH...]:DUR[:FINGER[/FINGER...]]  e.g. "E4:q:3", "G2+D3:w", "r:h"
// DUR: w h. h q. q e. e s
const DIV = 4; // divisions per quarter
const DUR = {
  w: [16, 'whole', false],
  'h.': [12, 'half', true],
  h: [8, 'half', false],
  'q.': [6, 'quarter', true],
  q: [4, 'quarter', false],
  'e.': [3, 'eighth', true],
  e: [2, 'eighth', false],
  s: [1, '16th', false],
};
const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parsePitch(p) {
  const m = p.match(/^([A-G])(#|b)?(-?\d)$/);
  if (!m) throw new Error(`bad pitch ${p}`);
  return { step: m[1], alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]) };
}
function midiOf(p) {
  const { step, alter, octave } = parsePitch(p);
  return (octave + 1) * 12 + STEPS[step] + alter;
}

function noteXml(token, staff, voice) {
  const [pitches, dur, fingers] = token.split(':');
  const [div, type, dot] = DUR[dur];
  const fs = fingers ? fingers.split('/') : [];
  if (pitches === 'r') {
    return `<note><rest/><duration>${div}</duration><voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}<staff>${staff}</staff></note>`;
  }
  return pitches
    .split('+')
    .map((p, i) => {
      const { step, alter, octave } = parsePitch(p);
      const f = fs[i] ? `<notations><technical><fingering>${fs[i]}</fingering></technical></notations>` : '';
      return `<note>${i ? '<chord/>' : ''}<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>${div}</duration><voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}<staff>${staff}</staff>${f}</note>`;
    })
    .join('');
}

function measureDur(tokens) {
  return tokens.reduce((s, t) => s + DUR[t.split(':')[1]][0], 0);
}

function musicXml({ title, composer, fifths, beats, beatType, bpm, rh, lh, forward = [], backward = [], pickup = false }) {
  const measures = rh.map((r, i) => {
    const rt = r.trim().split(/\s+/);
    const lt = lh[i].trim().split(/\s+/);
    const attrs =
      i === 0
        ? `<attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>` +
          `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`
        : '';
    const fwd = forward.includes(i) ? '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>' : '';
    const back = backward.includes(i) ? '<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>' : '';
    const num = pickup ? i : i + 1;
    const implicit = pickup && i === 0 ? ' implicit="yes"' : '';
    return `<measure number="${num}"${implicit}>${fwd}${attrs}${rt.map((t) => noteXml(t, 1, 1)).join('')}<backup><duration>${measureDur(rt)}</duration></backup>${lt.map((t) => noteXml(t, 2, 5)).join('')}${back}</measure>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${title}</work-title></work>
<identification><creator type="composer">${composer}</creator><rights>Public domain</rights></identification>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
${measures.join('\n')}
</part>
</score-partwise>
`;
}

// ---------------------------------------------------------------- Ode to Joy
// Right-hand fingering from the score for bars 1–8; bars 9–16 are left for the app to estimate.
const odeRh = [
  'E4:q:3 E4:q:3 F4:q:4 G4:q:5', 'G4:q:5 F4:q:4 E4:q:3 D4:q:2', 'C4:q:1 C4:q:1 D4:q:2 E4:q:3', 'E4:q.:3 D4:e:2 D4:h:2',
  'E4:q:3 E4:q:3 F4:q:4 G4:q:5', 'G4:q:5 F4:q:4 E4:q:3 D4:q:2', 'C4:q:1 C4:q:1 D4:q:2 E4:q:3', 'D4:q.:2 C4:e:1 C4:h:1',
  'D4:q D4:q E4:q C4:q', 'D4:q E4:e F4:e E4:q C4:q', 'D4:q E4:e F4:e E4:q D4:q', 'C4:q D4:q G3:h',
  'E4:q E4:q F4:q G4:q', 'G4:q F4:q E4:q D4:q', 'C4:q C4:q D4:q E4:q', 'D4:q. C4:e C4:h',
];
const odeLh = [
  'C3:h G3:h', 'B2:h G3:h', 'C3:h G3:h', 'G2:w', 'C3:h G3:h', 'B2:h G3:h', 'C3:h G3:h', 'G2:h C3:h',
  'G2:w', 'C3:w', 'G2:w', 'G2+D3:w', 'C3:h G3:h', 'B2:h G3:h', 'C3:h G3:h', 'G2:h C3:h',
];
writeFileSync(join(OUT, 'ode-to-joy.musicxml'), musicXml({ title: 'Ode to Joy', composer: 'Ludwig van Beethoven', fifths: 0, beats: 4, beatType: 4, bpm: 100, rh: odeRh, lh: odeLh }));

// ---------------------------------------------------------------- Minuet in G
const minRh = [
  'D5:q G4:e A4:e B4:e C5:e', 'D5:q G4:q G4:q', 'E5:q C5:e D5:e E5:e F#5:e', 'G5:q G4:q G4:q',
  'C5:q D5:e C5:e B4:e A4:e', 'B4:q C5:e B4:e A4:e G4:e', 'F#4:q G4:e A4:e B4:e G4:e', 'A4:h.',
  'D5:q G4:e A4:e B4:e C5:e', 'D5:q G4:q G4:q', 'E5:q C5:e D5:e E5:e F#5:e', 'G5:q G4:q G4:q',
  'C5:q D5:e C5:e B4:e A4:e', 'B4:q C5:e B4:e A4:e G4:e', 'A4:q B4:e A4:e G4:e F#4:e', 'G4:h.',
];
// Simplified left hand (one note per bar) to keep it approachable.
const minLh = [
  'G3:h.', 'B3:h.', 'C4:h.', 'B3:h.', 'A3:h.', 'G3:h.', 'D4:q B3:q G3:q', 'D3:h.',
  'G3:h.', 'B3:h.', 'C4:h.', 'B3:h.', 'A3:h.', 'G3:h.', 'D3:h.', 'G2:h.',
];
writeFileSync(join(OUT, 'minuet-in-g.musicxml'), musicXml({ title: 'Minuet in G (simplified)', composer: 'Christian Petzold', fifths: 1, beats: 3, beatType: 4, bpm: 108, rh: minRh, lh: minLh }));

// ---------------------------------------------------------------- Au clair de la lune (with a repeat)
// |: phrase A :| phrase B | phrase A
const aRh = ['C4:q:1 C4:q:1 C4:q:1 D4:q:2', 'E4:h:3 D4:h:2', 'C4:q:1 E4:q:3 D4:q:2 D4:q:2', 'C4:w:1'];
const bRh = ['D4:q:2 D4:q:2 D4:q:2 D4:q:2', 'A3:h D4:h', 'D4:q C4:q B3:q A3:q', 'G3:w'];
const aLh = ['C3:w', 'G2:h G2:h', 'C3:h G2:h', 'C3:w'];
const bLh = ['G2:w', 'F2:h F2:h', 'G2:h G2:h', 'G2:w'];
writeFileSync(
  join(OUT, 'au-clair-de-la-lune.musicxml'),
  musicXml({ title: 'Au clair de la lune', composer: 'Traditional', fifths: 0, beats: 4, beatType: 4, bpm: 96, rh: [...aRh, ...bRh, ...aRh], lh: [...aLh, ...bLh, ...aLh], forward: [0], backward: [3] }),
);

// ---------------------------------------------------------------- Mary Had a Little Lamb
writeFileSync(
  join(OUT, 'mary-had-a-little-lamb.musicxml'),
  musicXml({
    title: 'Mary Had a Little Lamb',
    composer: 'Traditional',
    fifths: 0,
    beats: 4,
    beatType: 4,
    bpm: 100,
    rh: ['E4:q:3 D4:q:2 C4:q:1 D4:q:2', 'E4:q:3 E4:q:3 E4:h:3', 'D4:q:2 D4:q:2 D4:h:2', 'E4:q:3 G4:q:5 G4:h:5', 'E4:q:3 D4:q:2 C4:q:1 D4:q:2', 'E4:q:3 E4:q:3 E4:q:3 E4:q:3', 'D4:q:2 D4:q:2 E4:q:3 D4:q:2', 'C4:w:1'],
    lh: ['C3:w', 'C3:w', 'G2:w', 'C3:w', 'C3:w', 'C3:w', 'G2:w', 'C3:w'],
  }),
);

// ---------------------------------------------------------------- Jingle Bells (chorus)
writeFileSync(
  join(OUT, 'jingle-bells.musicxml'),
  musicXml({
    title: 'Jingle Bells (chorus)',
    composer: 'James Lord Pierpont',
    fifths: 0,
    beats: 4,
    beatType: 4,
    bpm: 112,
    rh: [
      'E4:q E4:q E4:h', 'E4:q E4:q E4:h', 'E4:q G4:q C4:q. D4:e', 'E4:w',
      'F4:q F4:q F4:q. F4:e', 'F4:q E4:q E4:q E4:e E4:e', 'E4:q D4:q D4:q E4:q', 'D4:h G4:h',
      'E4:q E4:q E4:h', 'E4:q E4:q E4:h', 'E4:q G4:q C4:q. D4:e', 'E4:w',
      'F4:q F4:q F4:q F4:q', 'F4:q E4:q E4:q E4:e E4:e', 'G4:q G4:q F4:q D4:q', 'C4:w',
    ],
    lh: ['C3:w', 'C3:w', 'C3:w', 'C3:w', 'F2:w', 'C3:w', 'G2:w', 'G2:w', 'C3:w', 'C3:w', 'C3:w', 'C3:w', 'F2:w', 'C3:w', 'G2:w', 'C3:w'],
  }),
);

// ---------------------------------------------------------------- Amazing Grace (3/4, pickup)
writeFileSync(
  join(OUT, 'amazing-grace.musicxml'),
  musicXml({
    title: 'Amazing Grace',
    composer: 'Traditional (New Britain)',
    fifths: 1,
    beats: 3,
    beatType: 4,
    bpm: 80,
    pickup: true,
    rh: [
      'D4:q', 'G4:h B4:e G4:e', 'B4:h A4:q', 'G4:h E4:q', 'D4:h D4:q', 'G4:h B4:e G4:e', 'B4:h A4:q', 'D5:h.', 'D5:h B4:q',
      'D5:h B4:e G4:e', 'B4:h A4:q', 'G4:h E4:q', 'D4:h D4:q', 'G4:h B4:e G4:e', 'B4:h A4:q', 'G4:h.',
    ],
    lh: ['r:q', 'G2:h.', 'G2:h.', 'C3:h.', 'G2:h.', 'G2:h.', 'D3:h.', 'D3:h.', 'G2:h.', 'G2:h.', 'G2:h.', 'C3:h.', 'G2:h.', 'E2:h.', 'D3:h.', 'G2:h.'],
  }),
);

// ---------------------------------------------------------------- Canon in D (simplified)
const canonBass = ['D3:h A2:h', 'B2:h F#2:h', 'G2:h D2:h', 'G2:h A2:h'];
writeFileSync(
  join(OUT, 'canon-in-d.musicxml'),
  musicXml({
    title: 'Canon in D (simplified)',
    composer: 'Johann Pachelbel',
    fifths: 2,
    beats: 4,
    beatType: 4,
    bpm: 60,
    rh: ['F#5:h E5:h', 'D5:h C#5:h', 'B4:h A4:h', 'B4:h C#5:h', 'D5:h C#5:h', 'B4:h A4:h', 'G4:h F#4:h', 'G4:h E4:h', 'F#4+A4+D5:w'],
    lh: [...canonBass, ...canonBass, 'D3:w'],
  }),
);

// ---------------------------------------------------------------- Für Elise (opening, 3/8, pickup)
writeFileSync(
  join(OUT, 'fur-elise.musicxml'),
  musicXml({
    title: 'Für Elise (opening)',
    composer: 'Ludwig van Beethoven',
    fifths: 0,
    beats: 3,
    beatType: 8,
    bpm: 70,
    pickup: true,
    rh: [
      'E5:s D#5:s',
      'E5:s D#5:s E5:s B4:s D5:s C5:s',
      'A4:e r:s C4:s E4:s A4:s',
      'B4:e r:s E4:s G#4:s B4:s',
      'C5:e r:s E4:s E5:s D#5:s',
      'E5:s D#5:s E5:s B4:s D5:s C5:s',
      'A4:e r:s C4:s E4:s A4:s',
      'B4:e r:s E4:s C5:s B4:s',
      'A4:q r:e',
    ],
    lh: ['r:e', 'r:q.', 'A2:s E3:s A3:s r:e.', 'E2:s E3:s G#3:s r:e.', 'A2:s E3:s A3:s r:e.', 'r:q.', 'A2:s E3:s A3:s r:e.', 'E2:s E3:s G#3:s r:e.', 'A2:s E3:s A3:s r:e.'],
  }),
);

// ---------------------------------------------------------------- Prelude in C, BWV 846 (bars 1–8)
// Each half bar: two notes in the left hand, then the upper three notes twice in the right.
const prelude = [
  ['C4', 'E4', 'G4', 'C5', 'E5'],
  ['C4', 'D4', 'A4', 'D5', 'F5'],
  ['B3', 'D4', 'G4', 'D5', 'F5'],
  ['C4', 'E4', 'G4', 'C5', 'E5'],
  ['C4', 'E4', 'A4', 'E5', 'A5'],
  ['C4', 'D4', 'F#4', 'A4', 'D5'],
  ['B3', 'D4', 'G4', 'D5', 'G5'],
  ['B3', 'C4', 'E4', 'G4', 'C5'],
];
const halfR = ([, , a, b, c]) => `r:e ${a}:s ${b}:s ${c}:s ${a}:s ${b}:s ${c}:s`;
const halfL = ([x, y]) => `${x}:s ${y}:s r:q.`;
writeFileSync(
  join(OUT, 'prelude-in-c.musicxml'),
  musicXml({
    title: 'Prelude in C (bars 1–8)',
    composer: 'Johann Sebastian Bach',
    fifths: 0,
    beats: 4,
    beatType: 4,
    bpm: 66,
    rh: prelude.map((c) => `${halfR(c)} ${halfR(c)}`),
    lh: prelude.map((c) => `${halfL(c)} ${halfL(c)}`),
  }),
);

// ---------------------------------------------------------------- More traditional tunes (all public domain)
const simple = (file, title, composer, beats, beatType, bpm, rh, lh, fifths = 0) =>
  writeFileSync(join(OUT, file), musicXml({ title, composer, fifths, beats, beatType, bpm, rh, lh }));

simple('hot-cross-buns.musicxml', 'Hot Cross Buns', 'Traditional', 4, 4, 96,
  ['E4:q:3 D4:q:2 C4:h:1', 'E4:q:3 D4:q:2 C4:h:1', 'C4:e:1 C4:e:1 C4:e:1 C4:e:1 D4:e:2 D4:e:2 D4:e:2 D4:e:2', 'E4:q:3 D4:q:2 C4:h:1'],
  ['C3:w', 'C3:w', 'C3:h G2:h', 'C3:w']);

simple('frere-jacques.musicxml', 'Frère Jacques', 'Traditional', 4, 4, 100,
  ['C4:q D4:q E4:q C4:q', 'C4:q D4:q E4:q C4:q', 'E4:q F4:q G4:h', 'E4:q F4:q G4:h', 'G4:e A4:e G4:e F4:e E4:q C4:q', 'G4:e A4:e G4:e F4:e E4:q C4:q', 'C4:q G3:q C4:h', 'C4:q G3:q C4:h'],
  ['C3:w', 'C3:w', 'C3:w', 'C3:w', 'C3:w', 'C3:w', 'C3:h G2:h', 'C3:w']);

simple('london-bridge.musicxml', 'London Bridge', 'Traditional', 4, 4, 100,
  ['G4:q. A4:e G4:q F4:q', 'E4:q F4:q G4:h', 'D4:q E4:q F4:h', 'E4:q F4:q G4:h', 'G4:q. A4:e G4:q F4:q', 'E4:q F4:q G4:h', 'D4:h G4:h', 'E4:h C4:h'],
  ['C3:w', 'C3:w', 'G2:w', 'C3:w', 'C3:w', 'C3:w', 'G2:w', 'C3:w']);

simple('yankee-doodle.musicxml', 'Yankee Doodle', 'Traditional', 4, 4, 112,
  ['C4:q C4:q D4:q E4:q', 'C4:q E4:q D4:q G3:q', 'C4:q C4:q D4:q E4:q', 'C4:h B3:h', 'C4:q C4:q D4:q E4:q', 'F4:q E4:q D4:q C4:q', 'B3:q G3:q A3:q B3:q', 'C4:h C4:h'],
  ['C3:w', 'C3:h G2:h', 'C3:w', 'C3:h G2:h', 'C3:w', 'F2:h C3:h', 'G2:w', 'C3:w']);

simple('old-macdonald.musicxml', 'Old MacDonald Had a Farm', 'Traditional', 4, 4, 112,
  ['C4:q C4:q C4:q G3:q', 'A3:q A3:q G3:h', 'E4:q E4:q D4:q D4:q', 'C4:h. G3:q', 'C4:q C4:q C4:q G3:q', 'A3:q A3:q G3:h', 'E4:q E4:q D4:q D4:q', 'C4:w'],
  ['C3:w', 'F2:h C3:h', 'G2:w', 'C3:w', 'C3:w', 'F2:h C3:h', 'G2:w', 'C3:w']);

// 6/8: one bar = two dotted-quarter beats
simple('row-your-boat.musicxml', 'Row, Row, Row Your Boat', 'Traditional', 6, 8, 100,
  ['C4:q. C4:q.', 'C4:q D4:e E4:q.', 'E4:q D4:e E4:q F4:e', 'G4:h.', 'C5:e C5:e C5:e G4:e G4:e G4:e', 'E4:e E4:e E4:e C4:e C4:e C4:e', 'G4:q F4:e E4:q D4:e', 'C4:h.'],
  ['C3:h.', 'C3:h.', 'C3:h.', 'C3:h.', 'C3:h.', 'C3:h.', 'G2:h.', 'C3:h.']);

// ---------------------------------------------------------------- Twinkle Twinkle (MIDI, two tracks)
const twRh = 'C4:q C4:q G4:q G4:q A4:q A4:q G4:h F4:q F4:q E4:q E4:q D4:q D4:q C4:h G4:q G4:q F4:q F4:q E4:q E4:q D4:h G4:q G4:q F4:q F4:q E4:q E4:q D4:h C4:q C4:q G4:q G4:q A4:q A4:q G4:h F4:q F4:q E4:q E4:q D4:q D4:q C4:h';
const twLh = 'C3:w F3:h C3:h G2:h C3:h G2:h C3:h C3:h G2:h C3:h G2:h C3:h G2:h C3:h G2:h C3:w F3:h C3:h G2:h C3:h G2:h C3:h';
const bpm = 96;
const midi = new Midi();
midi.name = 'Twinkle Twinkle Little Star';
midi.header.setTempo(bpm);
midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
const qSec = 60 / bpm;
function addTrack(name, seq) {
  const tr = midi.addTrack();
  tr.name = name;
  let t = 0;
  for (const tok of seq.split(/\s+/)) {
    const [p, d] = tok.split(':');
    const dur = (DUR[d][0] / DIV) * qSec;
    if (p !== 'r') for (const x of p.split('+')) tr.addNote({ midi: midiOf(x), time: t, duration: dur * 0.95, velocity: 0.7 });
    t += dur;
  }
}
addTrack('Right Hand', twRh);
addTrack('Left Hand', twLh);
writeFileSync(join(OUT, 'twinkle.mid'), Buffer.from(midi.toArray()));

writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify(
    [
      { file: 'ode-to-joy.musicxml', title: 'Ode to Joy', composer: 'Beethoven', level: 'Beginner', format: 'MusicXML (with fingering)' },
      { file: 'twinkle.mid', title: 'Twinkle Twinkle Little Star', composer: 'Traditional', level: 'Beginner', format: 'MIDI (2 tracks)' },
      { file: 'au-clair-de-la-lune.musicxml', title: 'Au clair de la lune', composer: 'Traditional', level: 'Beginner', format: 'MusicXML (with a repeat)' },
      { file: 'hot-cross-buns.musicxml', title: 'Hot Cross Buns', composer: 'Traditional', level: 'First steps', format: 'MusicXML (with fingering)' },
      { file: 'frere-jacques.musicxml', title: 'Frère Jacques', composer: 'Traditional', level: 'Beginner', format: 'MusicXML' },
      { file: 'london-bridge.musicxml', title: 'London Bridge', composer: 'Traditional', level: 'Beginner', format: 'MusicXML' },
      { file: 'yankee-doodle.musicxml', title: 'Yankee Doodle', composer: 'Traditional', level: 'Beginner', format: 'MusicXML' },
      { file: 'old-macdonald.musicxml', title: 'Old MacDonald Had a Farm', composer: 'Traditional', level: 'Beginner', format: 'MusicXML' },
      { file: 'row-your-boat.musicxml', title: 'Row, Row, Row Your Boat', composer: 'Traditional', level: 'Beginner', format: 'MusicXML (6/8)' },
      { file: 'mary-had-a-little-lamb.musicxml', title: 'Mary Had a Little Lamb', composer: 'Traditional', level: 'Beginner', format: 'MusicXML (with fingering)' },
      { file: 'jingle-bells.musicxml', title: 'Jingle Bells (chorus)', composer: 'J. L. Pierpont', level: 'Beginner', format: 'MusicXML' },
      { file: 'amazing-grace.musicxml', title: 'Amazing Grace', composer: 'Traditional', level: 'Beginner', format: 'MusicXML (3/4, pickup)' },
      { file: 'canon-in-d.musicxml', title: 'Canon in D (simplified)', composer: 'Pachelbel', level: 'Beginner', format: 'MusicXML' },
      { file: 'fur-elise.musicxml', title: 'Für Elise (opening)', composer: 'Beethoven', level: 'Early intermediate', format: 'MusicXML (3/8)' },
      { file: 'prelude-in-c.musicxml', title: 'Prelude in C (bars 1–8)', composer: 'J. S. Bach', level: 'Early intermediate', format: 'MusicXML' },
      { file: 'minuet-in-g.musicxml', title: 'Minuet in G (simplified)', composer: 'Petzold', level: 'Early intermediate', format: 'MusicXML' },
    ],
    null,
    2,
  ),
);
console.log('Wrote samples to', OUT);

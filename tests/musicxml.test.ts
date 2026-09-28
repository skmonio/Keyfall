import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { ImportError, parseMusicXml, unzipMxl } from '../src/importers/musicxml';

const wrap = (measures: string, extraParts = '', partList = '<score-part id="P1"><part-name>Piano</part-name></score-part>') => `<?xml version="1.0"?>
<score-partwise version="4.0">
  <work><work-title>Test Piece</work-title></work>
  <identification><creator type="composer">Tester</creator></identification>
  <part-list>${partList}</part-list>
  <part id="P1">${measures}</part>${extraParts}
</score-partwise>`;

const n = (step: string, octave: number, dur: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration>${extra}</note>`;

const attrs = (divisions = 1, beats = 4, staves = 1, tempo = 120) =>
  `<attributes><divisions>${divisions}</divisions><time><beats>${beats}</beats><beat-type>4</beat-type></time><staves>${staves}</staves></attributes><direction><sound tempo="${tempo}"/></direction>`;

describe('MusicXML importer', () => {
  it('reads title, composer, pitches and durations at the given tempo', () => {
    const song = parseMusicXml(wrap(`<measure number="1">${attrs()}${n('C', 4, 1)}${n('E', 4, 1)}${n('G', 4, 2)}</measure>`));
    expect(song.title).toBe('Test Piece');
    expect(song.composer).toBe('Tester');
    expect(song.notes.map((x) => x.pitch)).toEqual([60, 64, 67]);
    // 120 bpm: a quarter is 0.5s
    expect(song.notes.map((x) => x.start)).toEqual([0, 0.5, 1]);
    expect(song.notes[2].duration).toBeCloseTo(1);
    expect(song.measures).toHaveLength(1);
    expect(song.measures[0].duration).toBeCloseTo(2);
    expect(song.sourceKind).toBe('musicxml');
  });

  it('handles alterations, chords, rests and ties', () => {
    const xml = wrap(
      `<measure number="1">${attrs()}` +
        `<note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>1</duration></note>` +
        `${n('C', 4, 1)}${n('E', 4, 1, '<chord/>')}${n('G', 4, 1, '<chord/>')}` +
        `<note><rest/><duration>1</duration></note>` +
        `${n('D', 5, 1, '<tie type="start"/>')}</measure>` +
        `<measure number="2">${n('D', 5, 2, '<tie type="stop"/>')}<note><rest/><duration>2</duration></note></measure>`,
    );
    const song = parseMusicXml(xml);
    expect(song.notes.map((x) => x.pitch)).toEqual([66, 60, 64, 67, 74]);
    const chord = song.notes.filter((x) => Math.abs(x.start - 0.5) < 1e-9);
    expect(chord.map((x) => x.pitch)).toEqual([60, 64, 67]);
    const tied = song.notes.find((x) => x.pitch === 74)!;
    expect(tied.start).toBeCloseTo(1.5);
    expect(tied.duration).toBeCloseTo(1.5); // 1 beat + 2 beats at 0.5s
    expect(song.measures).toHaveLength(2);
    expect(song.measures[1].start).toBeCloseTo(2);
  });

  it('assigns hands by staff and uses backup to align staves', () => {
    const xml = wrap(
      `<measure number="1">${attrs(2, 4, 2)}` +
        `${n('E', 5, 8, '<staff>1</staff>')}` +
        `<backup><duration>8</duration></backup>` +
        `${n('C', 3, 4, '<staff>2</staff>')}${n('G', 2, 4, '<staff>2</staff>')}</measure>`,
    );
    const song = parseMusicXml(xml);
    const rh = song.notes.filter((x) => x.hand === 'R');
    const lh = song.notes.filter((x) => x.hand === 'L');
    expect(rh.map((x) => x.pitch)).toEqual([76]);
    expect(lh.map((x) => x.pitch)).toEqual([48, 43]);
    expect(lh[0].start).toBe(0);
    expect(lh[1].start).toBeCloseTo(1);
    expect(lh.every((x) => x.staff === 2)).toBe(true);
  });

  it('reads fingering marks from the score', () => {
    const song = parseMusicXml(
      wrap(
        `<measure number="1">${attrs()}` +
          `${n('C', 4, 2, '<notations><technical><fingering>1</fingering></technical></notations>')}` +
          `${n('D', 4, 2, '<notations><technical><fingering>2</fingering></technical></notations>')}</measure>`,
      ),
    );
    expect(song.notes.map((x) => [x.finger, x.fingerSource])).toEqual([
      [1, 'score'],
      [2, 'score'],
    ]);
  });

  it('applies tempo changes and metronome marks', () => {
    const xml = wrap(
      `<measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` +
        `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>` +
        `${n('C', 4, 1)}${n('D', 4, 1)}</measure>` +
        `<measure number="2"><direction><sound tempo="120"/></direction>${n('E', 4, 1)}${n('F', 4, 1)}</measure>`,
    );
    const song = parseMusicXml(xml);
    expect(song.notes.map((x) => x.start)).toEqual([0, 1, 2, 2.5]);
    expect(song.tempos.map((t) => t.bpm)).toEqual([60, 120]);
    expect(song.measures[1].duration).toBeCloseTo(1);
  });

  it('uses part order for two single-staff parts (first part = right hand)', () => {
    const xml = wrap(
      `<measure number="1">${attrs()}${n('C', 5, 4)}</measure>`,
      `<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes>${n('C', 3, 4)}</measure></part>`,
      '<score-part id="P1"/><score-part id="P2"/>',
    );
    const song = parseMusicXml(xml);
    expect(song.notes.find((x) => x.pitch === 72)!.hand).toBe('R');
    expect(song.notes.find((x) => x.pitch === 48)!.hand).toBe('L');
  });

  it('skips grace notes and handles pickup bars', () => {
    const xml = wrap(
      `<measure number="0" implicit="yes">${attrs(1, 4)}${n('G', 4, 1)}</measure>` +
        `<measure number="1"><note><grace/><pitch><step>B</step><octave>4</octave></pitch></note>${n('C', 5, 4)}</measure>`,
    );
    const song = parseMusicXml(xml);
    expect(song.notes.map((x) => x.pitch)).toEqual([67, 72]);
    expect(song.measures[0].duration).toBeCloseTo(0.5);
    expect(song.measures[1].start).toBeCloseTo(0.5);
    expect(song.measures[0].number).toBe(0);
    expect(song.notes[1].measure).toBe(1);
  });

  it('rejects files that are not MusicXML', () => {
    expect(() => parseMusicXml('<html></html>')).toThrow(ImportError);
    expect(() => parseMusicXml('not xml <<<')).toThrow(ImportError);
    expect(() => parseMusicXml('<score-timewise/>')).toThrow(/Timewise/);
  });

  it('unzips compressed .mxl files via META-INF/container.xml', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="score/piece.xml"/></rootfiles></container>',
    );
    const xml = wrap(`<measure number="1">${attrs()}${n('A', 4, 4)}</measure>`);
    zip.file('score/piece.xml', xml);
    const buf = await zip.generateAsync({ type: 'uint8array' });
    const out = await unzipMxl(buf);
    expect(parseMusicXml(out).notes[0].pitch).toBe(69);
  });

  it('imports the bundled Ode to Joy with both hands and score fingering', () => {
    const xml = readFileSync('public/songs/ode-to-joy.musicxml', 'utf8');
    const song = parseMusicXml(xml);
    expect(song.measures).toHaveLength(16);
    expect(song.notes.filter((x) => x.hand === 'R')).toHaveLength(62);
    expect(song.notes.some((x) => x.hand === 'L')).toBe(true);
    expect(song.notes[0].start).toBe(0);
    const firstRh = song.notes.filter((x) => x.hand === 'R')[0];
    expect(firstRh.pitch).toBe(64);
    expect(firstRh.finger).toBe(3);
    // 100 bpm, 4/4, 16 bars = 38.4s
    expect(song.duration).toBeCloseTo(38.4, 1);
  });
});

describe('MusicXML repeats', () => {
  const bar = (num: number, step: string, extra = '') =>
    `<measure number="${num}">${num === 1 ? attrs() : ''}${extra}${n(step, 4, 4)}</measure>`;
  const fwd = `<barline location="left"><repeat direction="forward"/></barline>`;

  it('plays repeats with 1st and 2nd endings in the right order', () => {
    // |: C | D | [1. E :| [2. F | G |
    const xml = wrap(
      bar(1, 'C', fwd) +
        bar(2, 'D') +
        `<measure number="3"><barline location="left"><ending number="1" type="start"/></barline>${n('E', 4, 4)}<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure>` +
        `<measure number="4"><barline location="left"><ending number="2" type="start"/></barline>${n('F', 4, 4)}<barline location="right"><ending number="2" type="discontinue"/></barline></measure>` +
        bar(5, 'G'),
    );
    const song = parseMusicXml(xml);
    const names = song.notes.map((x) => ['C', 'D', 'E', 'F', 'G'][[60, 62, 64, 65, 67].indexOf(x.pitch)]);
    expect(names.join('')).toBe('CDECDFG');
    // Bars keep their printed numbers and know which time through they are.
    expect(song.measures.map((m) => `${m.number}${m.pass! > 1 ? "'" : ''}`)).toEqual(['1', '2', '3', "1'", "2'", '4', '5']);
    expect(song.measures.map((m) => m.writtenIndex)).toEqual([0, 1, 2, 0, 1, 3, 4]);
    // 120 bpm, 4/4: each bar 2s, notes 2s apart; tempo applies throughout.
    expect(song.notes.map((x) => x.start)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(song.duration).toBeCloseTo(14);
  });

  it('plays D.C. al Fine', () => {
    // | C | D (Fine) | E (D.C.) |
    const xml = wrap(
      bar(1, 'C') +
        `<measure number="2">${n('D', 4, 4)}<barline location="right"><bar-style>light-heavy</bar-style></barline><direction><direction-type><words>Fine</words></direction-type><sound fine="yes"/></direction></measure>` +
        `<measure number="3">${n('E', 4, 4)}<direction><direction-type><words>D.C. al Fine</words></direction-type><sound dacapo="yes"/></direction></measure>`,
    );
    expect(parseMusicXml(xml).notes.map((x) => x.pitch)).toEqual([60, 62, 64, 60, 62]);
  });

  it('understands "D.C." written as text only', () => {
    const xml = wrap(bar(1, 'C') + `<measure number="2">${n('D', 4, 4)}<direction><direction-type><words>D.C.</words></direction-type></direction></measure>`);
    expect(parseMusicXml(xml).notes.map((x) => x.pitch)).toEqual([60, 62, 60, 62]);
  });
});

describe('bundled Au clair de la lune', () => {
  it('plays its repeated opening twice', () => {
    const song = parseMusicXml(readFileSync('public/songs/au-clair-de-la-lune.musicxml', 'utf8'));
    expect(song.measures.map((m) => m.number)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(song.notes.filter((n) => n.hand === 'R').length).toBe(11 * 4);
  });
});


describe('parts and melody lines', () => {
  it('gives a single melody line (e.g. a voice part) to the right hand, not split at middle C', () => {
    const xml = wrap(`<measure number="1">${attrs()}${n('G', 3, 1)}${n('C', 4, 1)}${n('E', 4, 1)}${n('A', 3, 1)}</measure>`, '', '<score-part id="P1"><part-name>Voice</part-name></score-part>');
    const song = parseMusicXml(xml);
    expect(song.notes.every((x) => x.hand === 'R')).toBe(true);
    expect(song.parts).toEqual([{ name: 'Voice', role: 'melody' }]);
  });

  it('plays only the piano part when a score has a voice part too', () => {
    const voice = `<part id="P1"><measure number="1">${attrs()}${n('E', 4, 4)}</measure></part>`;
    const piano = `<part id="P2"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves></attributes>${n('C', 5, 4, '<staff>1</staff>')}<backup><duration>4</duration></backup>${n('C', 3, 4, '<staff>2</staff>')}</measure></part>`;
    const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part><score-part id="P2"><part-name>Piano</part-name></score-part></part-list>${voice}${piano}</score-partwise>`;
    const song = parseMusicXml(xml);
    expect(song.notes.find((x) => x.pitch === 64)!.backing).toBe(true);
    expect(song.notes.find((x) => x.pitch === 72)).toMatchObject({ hand: 'R' });
    expect(song.notes.find((x) => x.pitch === 48)).toMatchObject({ hand: 'L' });
    expect(song.parts!.map((p) => p.role)).toEqual(['backing', 'piano']);
  });

  it('reads transposing instruments at sounding pitch', () => {
    // A B-flat clarinet written D5 sounds C5.
    const xml = wrap(`<measure number="1"><attributes><divisions>1</divisions><transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose></attributes>${n('D', 5, 4)}</measure>`);
    expect(parseMusicXml(xml).notes[0].pitch).toBe(72);
  });
});

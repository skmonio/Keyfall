import { describe, expect, it } from 'vitest';
import { groupNumbered, mergedTitle, mergeMusicXml, splitNumberedName } from '../src/importers/merge';
import { parseMusicXml } from '../src/importers/musicxml';

const score = (title: string, steps: string[], key = 0) => `<?xml version="1.0"?>
<score-partwise><work><work-title>${title}</work-title></work><part-list><score-part id="P1"/></part-list><part id="P1">
${steps
  .map(
    (st, i) =>
      `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions><key><fifths>${key}</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>` : ''}<note><pitch><step>${st}</step><octave>4</octave></pitch><duration>4</duration></note></measure>`,
  )
  .join('')}
</part></score-partwise>`;

describe('merging numbered MusicXML files', () => {
  it('recognises numbered names', () => {
    expect(splitNumberedName('Mad World 2.mxl')).toEqual({ base: 'mad world', n: 2 });
    expect(splitNumberedName('mad_world-3.musicxml')).toEqual({ base: 'mad world'.replace(' ', '_'), n: 3 });
    expect(splitNumberedName('Song part 10.mxl')).toEqual({ base: 'song', n: 10 });
    expect(splitNumberedName('Song (4).xml')).toEqual({ base: 'song', n: 4 });
    expect(splitNumberedName('Nocturne.mxl').n).toBe(0);
    expect(mergedTitle('Mad World 1.mxl')).toBe('Mad World');
  });

  it('groups files by name and sorts them 1, 2 … 10', () => {
    const files = ['B 10.mxl', 'A 2.mxl', 'B 2.mxl', 'A 1.mxl', 'B 1.mxl', 'Other.mxl'].map((name) => ({ name }));
    const groups = groupNumbered(files).map((g) => g.map((f) => f.name));
    expect(groups).toContainEqual(['A 1.mxl', 'A 2.mxl']);
    expect(groups).toContainEqual(['B 1.mxl', 'B 2.mxl', 'B 10.mxl']);
    expect(groups).toContainEqual(['Other.mxl']);
  });

  it('joins the files in order with bars running on', () => {
    const merged = mergeMusicXml([score('Song', ['C', 'D']), score('Song', ['E', 'F'], 1)]);
    const song = parseMusicXml(merged);
    expect(song.notes.map((n) => n.pitch)).toEqual([60, 62, 64, 65]);
    expect(song.notes.map((n) => n.start)).toEqual([0, 2, 4, 6]);
    expect(song.measures.map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(song.title).toBe('Song');
    // The second file's key signature is kept where it starts.
    expect(merged.match(/<fifths>1<\/fifths>/g)).toHaveLength(1);
  });
});

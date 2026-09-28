import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMusicXml } from '../src/importers/musicxml';

const index: { file: string; title: string }[] = JSON.parse(readFileSync('public/songs/index.json', 'utf8'));

describe('bundled songs', () => {
  for (const s of index.filter((x) => x.file.endsWith('.musicxml'))) {
    it(`${s.title}: every bar has the right number of beats in both hands`, () => {
      const xml = readFileSync(`public/songs/${s.file}`, 'utf8');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const divisions = Number(doc.getElementsByTagName('divisions')[0].textContent);
      const beats = Number(doc.getElementsByTagName('beats')[0].textContent);
      const beatType = Number(doc.getElementsByTagName('beat-type')[0].textContent);
      const barLen = (beats * 4 * divisions) / beatType;
      const measures = Array.from(doc.getElementsByTagName('measure'));
      measures.forEach((m, i) => {
        for (const staff of ['1', '2']) {
          const total = Array.from(m.getElementsByTagName('note'))
            .filter((n) => (n.getElementsByTagName('staff')[0]?.textContent ?? '1') === staff && !n.getElementsByTagName('chord').length)
            .reduce((sum, n) => sum + Number(n.getElementsByTagName('duration')[0].textContent), 0);
          const pickup = i === 0 && m.getAttribute('implicit') === 'yes';
          if (pickup) expect(total, `pickup staff ${staff}`).toBeLessThan(barLen);
          else expect(total, `bar ${m.getAttribute('number')} staff ${staff}`).toBe(barLen);
        }
      });
      const pickup = measures[0].getAttribute('implicit') === 'yes';
      if (pickup) {
        const staffTotal = (st: string) =>
          Array.from(measures[0].getElementsByTagName('note'))
            .filter((n) => (n.getElementsByTagName('staff')[0]?.textContent ?? '1') === st && !n.getElementsByTagName('chord').length)
            .reduce((sum, n) => sum + Number(n.getElementsByTagName('duration')[0].textContent), 0);
        expect(staffTotal('1')).toBe(staffTotal('2'));
      }
      const song = parseMusicXml(xml);
      expect(song.notes.length).toBeGreaterThan(8);
      expect(song.notes.every((n) => n.pitch >= 36 && n.pitch <= 96)).toBe(true);
    });
  }
});

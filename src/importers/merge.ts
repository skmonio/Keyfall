/**
 * Join several MusicXML files into one score, e.g. a piece exported (or scanned) in parts:
 * "Song 1.mxl", "Song 2.mxl", "Song 3.mxl". Parts are matched by position (first part with
 * first part, ...). Bars are renumbered to run on, and each file's own attributes (key, time,
 * divisions, clefs) stay at the start of its first bar, so changes between files are kept.
 */
export interface NamedFile {
  name: string;
}

/** "Mad World 2.mxl" -> { base: "mad world", n: 2 }. Files without a trailing number get n = 0. */
export function splitNumberedName(name: string): { base: string; n: number } {
  const stem = name.replace(/\.(musicxml|mxl|xml)$/i, '');
  const m = stem.match(/^(.*?)[\s._-]*(?:part|pt|p|page|no\.?|#)?[\s._-]*\(?(\d+)\)?$/i);
  if (!m || !m[1].trim()) return { base: stem.trim().toLowerCase(), n: 0 };
  return { base: m[1].trim().toLowerCase(), n: Number(m[2]) };
}

/** Group files that share a name apart from a trailing number, each group sorted 1, 2, 3 … 10. */
export function groupNumbered<T extends NamedFile>(files: T[]): T[][] {
  const groups = new Map<string, { f: T; n: number }[]>();
  for (const f of files) {
    const { base, n } = splitNumberedName(f.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base)!.push({ f, n });
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a.n - b.n).map((x) => x.f));
}

/** Title for a merged group: the shared name, as written in the first file name. */
export function mergedTitle(firstName: string): string {
  const stem = firstName.replace(/\.(musicxml|mxl|xml)$/i, '');
  const m = stem.match(/^(.*?)[\s._-]*(?:part|pt|p|page|no\.?|#)?[\s._-]*\(?\d+\)?$/i);
  return (m?.[1] || stem).trim();
}

export function mergeMusicXml(xmls: string[]): string {
  if (xmls.length === 1) return xmls[0];
  const parser = new DOMParser();
  const docs = xmls.map((x) => parser.parseFromString(x, 'application/xml'));
  for (const d of docs) {
    if (d.getElementsByTagName('parsererror').length) throw new Error('One of the files is not valid MusicXML.');
  }
  const base = docs[0];
  const parts = Array.from(base.documentElement.children).filter((c) => c.localName === 'part');
  let barNo = 0;
  const renumber = (m: Element) => {
    // Keep a pickup (implicit) bar numbered 0 at the very start; everything else runs on.
    if (barNo === 0 && m.getAttribute('implicit') === 'yes') {
      m.setAttribute('number', '0');
      return;
    }
    barNo++;
    m.setAttribute('number', String(barNo));
    m.removeAttribute('implicit');
  };
  // Renumber the first file's bars (part 1 decides the numbers; other parts follow).
  const partBars = parts.map((p) => Array.from(p.children).filter((c) => c.localName === 'measure'));
  const renumberParts = (bars: Element[][]) => {
    const n = Math.max(...bars.map((b) => b.length));
    for (let i = 0; i < n; i++) {
      const before = barNo;
      if (bars[0][i]) renumber(bars[0][i]);
      for (const other of bars.slice(1)) if (other[i]) other[i].setAttribute('number', bars[0][i]?.getAttribute('number') ?? String(before + 1));
    }
  };
  renumberParts(partBars);

  for (const d of docs.slice(1)) {
    const addParts = Array.from(d.documentElement.children).filter((c) => c.localName === 'part');
    const addBars = parts.map((_, i) => (addParts[i] ? Array.from(addParts[i].children).filter((c) => c.localName === 'measure') : []));
    // A pickup can only be the first bar of the whole piece.
    for (const b of addBars) b.forEach((m) => m.removeAttribute('implicit'));
    renumberParts(addBars.map((b) => (b.length ? b : [])));
    addBars.forEach((bars, i) => {
      for (const m of bars) parts[i].appendChild(base.importNode(m, true));
    });
  }
  return new XMLSerializer().serializeToString(base);
}

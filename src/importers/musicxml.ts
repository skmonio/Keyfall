import JSZip from 'jszip';
import { handForStaff } from '../model/hands';
import { playbackOrder, type BarRepeatInfo } from './repeats';
import { finalizeSong, type Finger, type Hand, type Measure, type Note, type Song, type TempoEvent } from '../model/song';

export class ImportError extends Error {}

/** Bump when the importer changes how existing files are read (songs are then re-read). */
export const MUSICXML_IMPORTER_VERSION = 4;

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_BPM = 100;

function kids(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter((c) => c.localName === name);
}
function kid(el: Element | null | undefined, name: string): Element | undefined {
  return kids(el, name)[0];
}
function text(el: Element | null | undefined, name: string): string | undefined {
  return kid(el, name)?.textContent?.trim() ?? undefined;
}
function num(el: Element | null | undefined, name: string): number | undefined {
  const t = text(el, name);
  if (t === undefined || t === '') return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}

interface RawNote {
  pitch: number;
  /** Positions in quarter notes from the start of the piece. */
  startQ: number;
  durQ: number;
  staff: number;
  voice: string;
  partIndex: number;
  measure: number;
  finger?: Finger;
  velocity: number;
}

interface RawTempo {
  q: number;
  bpm: number;
}

/** Unzip a compressed .mxl file and return the MusicXML text inside. */
export async function unzipMxl(data: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
  let path: string | undefined;
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const xml = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
    path = xml.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') ?? undefined;
  }
  if (!path || !zip.file(path)) {
    path = Object.keys(zip.files).find((p) => !p.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(p));
  }
  if (!path) throw new ImportError('No MusicXML file found inside the .mxl archive.');
  return zip.file(path)!.async('string');
}

/** The MusicXML text of a .musicxml/.xml file, or of the score inside a compressed .mxl. */
export async function readMusicXmlText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  return isZip ? unzipMxl(buf) : new TextDecoder().decode(bytes);
}

export async function importMusicXmlFile(file: File): Promise<Song> {
  return parseMusicXml(await readMusicXmlText(file), file.name.replace(/\.(musicxml|mxl|xml)$/i, ''));
}

export function parseMusicXml(xml: string, fallbackTitle = 'Untitled'): Song {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError('The file is not valid XML.');
  const root = doc.documentElement;
  if (root.localName === 'score-timewise') {
    throw new ImportError('Timewise MusicXML is not supported. Please export as partwise MusicXML.');
  }
  if (root.localName !== 'score-partwise') throw new ImportError('This does not look like a MusicXML score.');

  const title =
    text(kid(root, 'work'), 'work-title') || text(root, 'movement-title') || fallbackTitle;
  const composer = kids(kid(root, 'identification'), 'creator')
    .find((c) => c.getAttribute('type') === 'composer')
    ?.textContent?.trim();

  const parts = kids(root, 'part');
  if (!parts.length) throw new ImportError('The score has no parts.');

  const raw: RawNote[] = [];
  const tempos: RawTempo[] = [];
  const measureStartsQ: number[] = [];
  const measureLensQ: number[] = [];
  const measureNumbers: number[] = [];
  const timeSigs: { beats: number; beatType: number }[] = [];
  const repeatInfo: BarRepeatInfo[] = [];
  let activeEnding: number[] | undefined;
  let partStaffCounts: number[] = [];

  parts.forEach((part, partIndex) => {
    let divisions = 1;
    let beats = 4;
    let beatType = 4;
    let measureStartQ = 0;
    let maxStaves = 1;
    // Transposing instruments (clarinet, sax, ...): written pitch + this = sounding pitch.
    let transpose = 0;
    // Open ties keyed by pitch/staff/voice.
    const openTies = new Map<string, RawNote>();

    kids(part, 'measure').forEach((m, mi) => {
      const bar: BarRepeatInfo = {};
      let barEnding = activeEnding;
      let endingEndsHere = false;
      const readJumps = (el: Element) => {
        const snd = el.localName === 'sound' ? el : kid(el, 'sound');
        if (snd) {
          if (snd.getAttribute('dacapo') === 'yes') bar.dacapo = true;
          if (snd.getAttribute('dalsegno')) bar.dalsegno = snd.getAttribute('dalsegno')!;
          if (snd.getAttribute('fine') !== null) bar.fine = true;
          if (snd.getAttribute('tocoda')) bar.tocoda = snd.getAttribute('tocoda')!;
          if (snd.getAttribute('segno')) bar.segno = snd.getAttribute('segno')!;
          if (snd.getAttribute('coda')) bar.coda = snd.getAttribute('coda')!;
        }
        // Marks without playback attributes (some exporters): read the symbols and words.
        if (el.getElementsByTagName('segno').length && !bar.segno) bar.segno = 'segno';
        if (el.getElementsByTagName('coda').length && !bar.coda && !bar.tocoda) bar.coda = 'coda';
        if (!snd) {
          const words = Array.from(el.getElementsByTagName('words')).map((w) => w.textContent?.trim() ?? '').join(' ');
          if (/\bD\.?\s?C\.?(\s|$)|da capo/i.test(words)) bar.dacapo = true;
          else if (/\bD\.?\s?S\.?(\s|$)|dal segno/i.test(words)) bar.dalsegno = 'segno';
          if (/^fine$/i.test(words)) bar.fine = true;
          if (/to coda/i.test(words)) {
            bar.tocoda = 'coda';
            delete bar.coda;
          }
        }
      };
      let posDiv = 0;
      let maxPosDiv = 0;
      let lastStartDiv = 0;
      const toQ = (d: number) => measureStartQ + d / divisions;

      for (const el of Array.from(m.children)) {
        switch (el.localName) {
          case 'attributes': {
            divisions = num(el, 'divisions') ?? divisions;
            const time = kid(el, 'time');
            if (time) {
              beats = Number(text(time, 'beats')?.split('+').reduce((a, b) => a + Number(b), 0) ?? beats) || beats;
              beatType = num(time, 'beat-type') ?? beatType;
            }
            maxStaves = Math.max(maxStaves, num(el, 'staves') ?? 1);
            const tr = kid(el, 'transpose');
            if (tr) transpose = (num(tr, 'chromatic') ?? 0) + 12 * (num(tr, 'octave-change') ?? 0);
            break;
          }
          case 'backup':
            posDiv -= num(el, 'duration') ?? 0;
            if (posDiv < 0) posDiv = 0;
            break;
          case 'forward':
            posDiv += num(el, 'duration') ?? 0;
            maxPosDiv = Math.max(maxPosDiv, posDiv);
            break;
          case 'barline': {
            if (partIndex !== 0) break;
            const rep = kid(el, 'repeat');
            if (rep?.getAttribute('direction') === 'forward') bar.forward = true;
            if (rep?.getAttribute('direction') === 'backward') bar.backward = Math.max(2, Number(rep.getAttribute('times')) || 2);
            const end = kid(el, 'ending');
            if (end) {
              const nums = (end.getAttribute('number') ?? '1')
                .split(/[,\s]+/)
                .map(Number)
                .filter((x) => Number.isFinite(x) && x > 0);
              const type = end.getAttribute('type');
              if (type === 'start') {
                barEnding = nums;
                activeEnding = nums;
              } else if (type === 'stop' || type === 'discontinue') {
                barEnding = barEnding ?? nums;
                endingEndsHere = true;
              }
            }
            readJumps(el);
            break;
          }
          case 'direction':
          case 'sound': {
            if (partIndex !== 0) break;
            readJumps(el);
            const sound = el.localName === 'sound' ? el : kid(el, 'sound');
            let bpm = sound ? Number(sound.getAttribute('tempo')) : NaN;
            if (!Number.isFinite(bpm) || bpm <= 0) {
              const metro = el.getElementsByTagName('metronome')[0];
              const pm = metro ? Number(text(metro, 'per-minute')) : NaN;
              const unit = metro ? text(metro, 'beat-unit') : undefined;
              const dotted = metro ? !!kid(metro, 'beat-unit-dot') : false;
              if (Number.isFinite(pm) && pm > 0) {
                const unitQ = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit ?? 'quarter'] ?? 1;
                bpm = pm * unitQ * (dotted ? 1.5 : 1);
              }
            }
            if (Number.isFinite(bpm) && bpm > 0) {
              const offset = num(el, 'offset') ?? 0;
              tempos.push({ q: toQ(posDiv + offset), bpm });
            }
            break;
          }
          case 'note': {
            const isChord = !!kid(el, 'chord');
            const isGrace = !!kid(el, 'grace');
            const isCue = !!kid(el, 'cue');
            const dur = num(el, 'duration') ?? 0;
            if (isGrace || isCue) break;
            const startDiv = isChord ? lastStartDiv : posDiv;
            if (!isChord) {
              lastStartDiv = posDiv;
              posDiv += dur;
              maxPosDiv = Math.max(maxPosDiv, posDiv);
            }
            const pitchEl = kid(el, 'pitch');
            if (kid(el, 'rest') || !pitchEl) break;
            const step = text(pitchEl, 'step') ?? 'C';
            const alter = num(pitchEl, 'alter') ?? 0;
            const octave = num(pitchEl, 'octave') ?? 4;
            const pitch = (octave + 1) * 12 + (STEP[step] ?? 0) + Math.round(alter) + transpose;
            const staff = num(el, 'staff') ?? 1;
            const voice = text(el, 'voice') ?? '1';
            const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
            const key = `${pitch}/${staff}/${voice}`;
            const startQ = toQ(startDiv);
            const durQ = dur / divisions;

            const fingerText = el.getElementsByTagName('fingering')[0]?.textContent?.trim();
            const fingerNum = fingerText ? Number(fingerText.match(/[1-5]/)?.[0]) : NaN;
            const finger = fingerNum >= 1 && fingerNum <= 5 ? (fingerNum as Finger) : undefined;
            const dyn = Number(el.getAttribute('dynamics'));
            const velocity = Number.isFinite(dyn) && dyn > 0 ? Math.min(127, Math.round((dyn / 100) * 90)) : 80;

            const open = ties.includes('stop') ? openTies.get(key) : undefined;
            if (open) {
              open.durQ = startQ + durQ - open.startQ;
              if (!ties.includes('start')) openTies.delete(key);
              break;
            }
            const note: RawNote = { pitch, startQ, durQ, staff, voice, partIndex, measure: mi, finger, velocity };
            raw.push(note);
            if (ties.includes('start')) openTies.set(key, note);
            break;
          }
        }
      }

      // Measure length: prefer the time signature, but honour pickups/irregular bars when shorter.
      // (The sheet view matches notes bar by bar, so it doesn't depend on this agreeing with OSMD.)
      const nominalQ = (beats * 4) / beatType;
      const actualQ = maxPosDiv / divisions;
      const implicit = m.getAttribute('implicit') === 'yes';
      const lenQ = actualQ > 0 && (implicit || actualQ < nominalQ - 1e-6) ? actualQ : nominalQ;
      if (partIndex === 0) {
        if (barEnding?.length) bar.ending = barEnding;
        if (endingEndsHere) activeEnding = undefined;
        repeatInfo.push(bar);
        measureStartsQ.push(measureStartQ);
        measureLensQ.push(lenQ);
        const printed = parseInt(m.getAttribute('number') ?? '', 10);
        measureNumbers.push(Number.isFinite(printed) ? printed : mi + 1);
        timeSigs.push({ beats, beatType });
      }
      // Keep parts aligned to the first part's measure grid.
      measureStartQ = partIndex === 0 ? measureStartQ + lenQ : (measureStartsQ[mi + 1] ?? measureStartQ + lenQ);
    });
    partStaffCounts.push(maxStaves);
  });

  if (!raw.length) throw new ImportError('No pitched notes were found in the score.');

  // ---- repeats: lay the music out in playing order (the score itself stays as written)
  const order = playbackOrder(repeatInfo);
  const unrolled = order.some((w, k) => w !== k) || order.length !== measureStartsQ.length;
  const playedStartQ: number[] = [];
  {
    let q = measureStartsQ[0] ?? 0;
    for (const w of order) {
      playedStartQ.push(q);
      q += measureLensQ[w];
    }
  }
  let playedRaw = raw;
  if (unrolled) {
    const occurrences = new Map<number, number[]>();
    order.forEach((w, k) => occurrences.set(w, [...(occurrences.get(w) ?? []), k]));
    playedRaw = [];
    for (const r of raw) {
      const offset = r.startQ - measureStartsQ[r.measure];
      for (const k of occurrences.get(r.measure) ?? []) playedRaw.push({ ...r, startQ: playedStartQ[k] + offset, measure: k });
    }
    const writtenBarOf = (q: number) => {
      let w = 0;
      while (w + 1 < measureStartsQ.length && measureStartsQ[w + 1] <= q + 1e-9) w++;
      return w;
    };
    const played: RawTempo[] = [];
    for (const t of tempos) {
      const w = writtenBarOf(t.q);
      for (const k of occurrences.get(w) ?? []) played.push({ q: playedStartQ[k] + (t.q - measureStartsQ[w]), bpm: t.bpm });
    }
    // Keep the opening tempo even if bar 1 is never replayed.
    if (tempos.length && !played.some((p) => p.q <= tempos[0].q + 1e-9)) played.push(tempos[0]);
    tempos.length = 0;
    tempos.push(...played);
  }

  // ---- tempo map: quarter positions -> seconds
  tempos.sort((a, b) => a.q - b.q);
  if (!tempos.length || tempos[0].q > 0) tempos.unshift({ q: 0, bpm: tempos[0]?.bpm ?? DEFAULT_BPM });
  const segs: { q: number; sec: number; bpm: number }[] = [];
  for (const t of tempos) {
    const prev = segs[segs.length - 1];
    if (prev && Math.abs(prev.q - t.q) < 1e-9) {
      prev.bpm = t.bpm;
      continue;
    }
    const sec = prev ? prev.sec + ((t.q - prev.q) * 60) / prev.bpm : 0;
    segs.push({ q: t.q, sec, bpm: t.bpm });
  }
  const qToSec = (q: number) => {
    let s = segs[0];
    for (const seg of segs) if (seg.q <= q + 1e-9) s = seg;
    return s.sec + ((q - s.q) * 60) / s.bpm;
  };

  // ---- parts and hands
  const partNames = new Map(kids(kid(root, 'part-list'), 'score-part').map((sp) => [sp.getAttribute('id'), text(sp, 'part-name') ?? '']));
  const names = parts.map((p, i) => partNames.get(p.getAttribute('id')) || `Part ${i + 1}`);
  // The piano: a part with two staves, or one called piano/keyboard.
  const isPiano = parts.map((_, i) => partStaffCounts[i] > 1 || /piano|keyboard|klavier|pno|keys/i.test(names[i]));
  const hasPiano = isPiano.some(Boolean);
  const roles: ('piano' | 'melody' | 'backing')[] = parts.map((_, i) => {
    if (hasPiano) return isPiano[i] ? 'piano' : 'backing';
    // No piano part: the first part is the right hand; a second single-staff part the left.
    return i === 0 ? 'melody' : i === 1 ? 'piano' : 'backing';
  });
  const handOf = (r: RawNote): { hand: Hand; staff: number; backing?: boolean } => {
    if (roles[r.partIndex] === 'backing') return { hand: 'R', staff: r.staff, backing: true };
    if (partStaffCounts[r.partIndex] > 1) return { hand: handForStaff(r.staff), staff: r.staff };
    if (!hasPiano && parts.length > 1) {
      const staff = r.partIndex === 0 ? 1 : 2;
      return { hand: handForStaff(staff), staff };
    }
    // A one-staff piano part: share it between the hands at middle C.
    if (roles[r.partIndex] === 'piano') return { hand: r.pitch >= 60 ? 'R' : 'L', staff: r.staff };
    // A single melody line (voice, flute, a lead sheet...): the right hand plays it.
    // (Use "Split at" on the setup screen to share it between the hands.)
    return { hand: 'R', staff: 1 };
  };

  const notes: Note[] = playedRaw.map((r) => {
    const { hand, staff, backing } = handOf(r);
    const start = qToSec(r.startQ);
    return {
      id: 0,
      pitch: r.pitch,
      start,
      duration: Math.max(0.02, qToSec(r.startQ + r.durQ) - start),
      hand,
      staff,
      finger: r.finger,
      fingerSource: r.finger ? 'score' : undefined,
      velocity: r.velocity,
      measure: r.measure,
      part: r.partIndex,
      ...(backing ? { backing: true } : {}),
    };
  });

  const seen = new Map<number, number>();
  const measures: Measure[] = order.map((w, k) => {
    const q = playedStartQ[k];
    const start = qToSec(q);
    const pass = (seen.get(w) ?? 0) + 1;
    seen.set(w, pass);
    return {
      index: k,
      number: measureNumbers[w],
      start,
      duration: qToSec(q + measureLensQ[w]) - start,
      beats: timeSigs[w].beats,
      beatType: timeSigs[w].beatType,
      writtenIndex: w,
      writtenQ: measureStartsQ[w],
      pass,
    };
  });
  const tempoEvents: TempoEvent[] = segs.map((s) => ({ time: s.sec, bpm: s.bpm }));

  return finalizeSong({
    id: crypto.randomUUID(),
    title,
    composer,
    notes,
    measures,
    tempos: tempoEvents,
    sourceKind: 'musicxml',
    musicXml: xml,
    importerVersion: MUSICXML_IMPORTER_VERSION,
    parts: names.map((name, i) => ({ name, role: roles[i] })),
    addedAt: Date.now(),
  });
}

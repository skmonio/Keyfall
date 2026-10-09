/**
 * Sheet-music practice view.
 *
 * Renders the score with OpenSheetMusicDisplay and drives it from the same song clock as
 * the falling-notes view: a playhead moves through the music, the view scrolls to follow
 * it, and each notehead is coloured by its judged state (hit, missed, next).
 *
 * Layouts:
 *  - scroll: one continuous line that slides past a fixed playhead (like Simply Piano)
 *  - lines:  normal line breaks; the current line and the next one are visible
 *  - page:   the whole score, scrolling to keep the current line in view
 */
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { GameSession } from '../engine/session';
import type { Hand, Note, Song } from '../model/song';
import { quarterToSec, secToQuarter, writtenQuarter } from '../model/time';

export type SheetLayout = 'scroll' | 'lines' | 'page';

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Plain-language key signature, e.g. "4 flats: every B, E, A and D is played flat (a black key) unless marked ♮". */
export function describeKey(fifths: number): string {
  if (!fifths) return 'No sharps or flats in the key signature.';
  const n = Math.min(7, Math.abs(fifths));
  const notes = (fifths > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, n);
  const list = notes.length > 1 ? `${notes.slice(0, -1).join(', ')} and ${notes[notes.length - 1]}` : notes[0];
  const kind = fifths > 0 ? 'sharp' : 'flat';
  return `Key signature: ${n} ${kind}${n > 1 ? 's' : ''} (${notes.map((x) => x + (fifths > 0 ? '♯' : '♭')).join(' ')}). Every ${list} is played ${kind} unless marked ♮.`;
}

export interface SheetOptions {
  layout: SheetLayout;
  /** 0.5 .. 2 */
  zoom: number;
  /** Show finger numbers (from the score, or estimated) next to the notes. */
  showFingers: boolean;
  /** Show note names (as written in the score) by the notes. */
  showNames?: boolean;
  colors: Record<Hand, string>;
  nextColors: Record<Hand, string>;
}

// Minimal views of the OSMD internals we use.
interface Box {
  AbsolutePosition: { x: number; y: number };
  Size: { width: number; height: number };
  BorderTop: number;
  BorderBottom: number;
}
interface GNote {
  PositionAndShape: Box;
  sourceNote: {
    halfTone: number;
    isRest(): boolean;
    NoteTie?: { StartNote: unknown };
    getAbsoluteTimestamp(): { RealValue: number };
    Pitch?: { FundamentalNote: number; AccidentalHalfTones: number };
  };
  setColor(color: string, opts: Record<string, boolean>): void;
}
interface GStaffEntry {
  PositionAndShape: Box;
  graphicalVoiceEntries: { notes: GNote[] }[];
  getAbsoluteTimestamp(): { RealValue: number };
}
interface GMeasure {
  PositionAndShape: Box;
  staffEntries: GStaffEntry[];
  parentSourceMeasure: { AbsoluteTimestamp: { RealValue: number }; Duration: { RealValue: number } };
  ParentMusicSystem: { PositionAndShape: Box };
}

interface Anchor {
  /** Position within its bar, in quarter notes (from the start of the bar). */
  rel: number;
  x: number; // px
  sys: number;
}
interface SysBox {
  top: number;
  bottom: number;
}
interface SheetNote {
  g: GNote;
  /** x of the note's column (staff entry), in OSMD units. */
  entryX: number;
  /** Written bar index, and position inside that bar (quarter notes). */
  w: number;
  rel: number;
  /** The song notes this notehead stands for: one per time through a repeat. */
  ids: { id: number; start: number }[];
  /** The one that applies right now (updated each frame). */
  noteId?: number;
  /** Written position (quarter notes). */
  q?: number;
  color?: string;
  tieContinuation?: boolean;
}

const UNIT_PX = 10; // OSMD's unit-to-pixel factor at zoom 1
const PLAYHEAD_AT = 0.3; // scroll layout: playhead position as a fraction of the width

const HIT = '#16a34a';
const MISS = '#dc2626';
const AUTO = '#9ca3af';
const PLAIN = '#111827';

export class SheetView {
  private osmd?: OpenSheetMusicDisplay;
  private scroller: HTMLDivElement;
  private inner: HTMLDivElement;
  private playhead: HTMLDivElement;
  /** Scroll layout: clef + key signature pinned at the left edge. */
  private sticky?: HTMLDivElement;
  private stickyInner?: HTMLDivElement;
  private firstEntryX = 0;
  private fingerLayer: HTMLDivElement;
  private nameLayer: HTMLDivElement;
  /** Key signature of the piece (in fifths), from the first <fifths> in the score. */
  readonly keyFifths: number;
  /** Positions on the page, per written bar (index = bar index in the score). */
  private barAnchors: Anchor[][] = [];
  private anchors: Anchor[] = [];
  private systems: SysBox[] = [];
  private notes: SheetNote[] = [];
  private lastSys = -1;
  private disposed = false;
  matched = 0;
  unmatched = 0;

  constructor(
    private host: HTMLElement,
    private song: Song,
    private xml: string,
    private opts: SheetOptions,
  ) {
    host.innerHTML = '';
    host.classList.add('sheet-host');
    this.scroller = document.createElement('div');
    this.scroller.className = 'sheet-scroller';
    this.inner = document.createElement('div');
    this.inner.className = 'sheet-inner';
    this.playhead = document.createElement('div');
    this.playhead.className = 'sheet-playhead';
    this.scroller.appendChild(this.inner);
    host.appendChild(this.scroller);
    this.inner.appendChild(this.playhead);
    this.fingerLayer = document.createElement('div');
    this.fingerLayer.className = 'sheet-fingers';
    this.inner.appendChild(this.fingerLayer);
    this.nameLayer = document.createElement('div');
    this.nameLayer.className = 'sheet-names';
    this.inner.appendChild(this.nameLayer);
    const f = xml.match(/<fifths>\s*(-?\d+)\s*<\/fifths>/);
    this.keyFifths = f ? Number(f[1]) : 0;
  }

  async init(): Promise<void> {
    const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
    if (this.disposed) return;
    const osmdHost = document.createElement('div');
    this.inner.insertBefore(osmdHost, this.playhead);
    this.osmd = new OpenSheetMusicDisplay(osmdHost, {
      autoResize: false,
      backend: 'svg',
      // The song title is already on screen, and files without one would show "Untitled Score".
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawPartNames: false,
      drawCredits: false,
      // Finger numbers are drawn by us (score + estimated), so they can be switched on and off.
      drawFingerings: false,
      drawMeasureNumbers: true,
      renderSingleHorizontalStaffline: this.opts.layout === 'scroll',
      drawingParameters: this.opts.layout === 'page' ? 'default' : 'compacttight',
      followCursor: false,
      // Show every empty bar as its own bar (not "6 bars rest"), so each one can be found and filled.
      autoGenerateMultipleRestMeasuresFromRestMeasures: false,
    });
    await this.osmd.load(this.xml);
    if (this.disposed) return;
    this.osmd.zoom = this.opts.zoom;
    this.render();
  }

  /** Re-render (after a resize or zoom change) and rebuild the position index. */
  render() {
    if (!this.osmd) return;
    this.osmd.zoom = this.opts.zoom;
    this.osmd.render();
    this.buildIndex();
    this.lastSys = -1;
    for (const n of this.notes) n.color = undefined;
    if (this.opts.layout === 'lines' && this.systems.length) {
      // Show two lines: size the view to the tallest pair of consecutive lines.
      let h = 0;
      for (let i = 0; i < this.systems.length; i++) {
        const next = this.systems[i + 1] ?? this.systems[i];
        h = Math.max(h, next.bottom - this.systems[i].top);
      }
      this.host.style.height = `${Math.round(h + 40)}px`;
    } else if (this.opts.layout === 'scroll' && this.systems.length) {
      this.host.style.height = `${Math.round(this.systems[0].bottom - this.systems[0].top + 60)}px`;
      this.buildSticky();
    } else {
      this.host.style.height = '';
    }
  }

  /** Pin a copy of the start of the line (clef, key and time signature) to the left edge. */
  private buildSticky() {
    this.sticky?.remove();
    const svg = this.inner.querySelector('svg');
    const width = this.firstEntryX - 8;
    if (!svg || width < 20) return;
    const sticky = document.createElement('div');
    sticky.className = 'sheet-sticky';
    sticky.style.width = `${Math.round(width)}px`;
    const inner = document.createElement('div');
    inner.appendChild(svg.cloneNode(true));
    sticky.appendChild(inner);
    this.host.appendChild(sticky);
    this.sticky = sticky;
    this.stickyInner = inner;
  }

  /** Screen x of the playhead in the scroll layout (where the music passes by). */
  playheadClientX(): number {
    // Where the playhead really is (with smooth scrolling it isn't always at exactly PLAYHEAD_AT).
    const p = this.playhead.getBoundingClientRect();
    if (p.width || p.height) return p.left + p.width / 2;
    const r = this.host.getBoundingClientRect();
    return r.left + r.width * PLAYHEAD_AT;
  }

  /**
   * The song time at a point on the sheet (screen coordinates), for tapping and scrubbing.
   * `near` picks which time through a repeated bar you mean (the one closest to it).
   */
  timeAt(clientX: number, clientY: number, near: number): { t: number; measure: number } | undefined {
    if (!this.anchors.length) return undefined;
    const r = this.inner.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    // Which line of music: the one whose box is nearest vertically (the scroll layout has one).
    let sys = 0;
    let best = Infinity;
    this.systems.forEach((b, i) => {
      const d = cy < b.top ? b.top - cy : cy > b.bottom ? cy - b.bottom : 0;
      if (d < best) {
        best = d;
        sys = i;
      }
    });
    // Which bar on that line, and where in it.
    let pick: { w: number; rel: number } | undefined;
    let bestDx = Infinity;
    this.barAnchors.forEach((bar, w) => {
      if (!bar?.length || bar[0].sys !== sys) return;
      const x0 = bar[0].x;
      const x1 = bar[bar.length - 1].x;
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      if (dx >= bestDx) return;
      bestDx = dx;
      const x = Math.max(x0, Math.min(x1, cx));
      let i = 0;
      while (i + 1 < bar.length && bar[i + 1].x <= x) i++;
      const a = bar[i];
      const b = bar[i + 1];
      const rel = !b || b.x <= a.x ? a.rel : a.rel + ((x - a.x) / (b.x - a.x)) * (b.rel - a.rel);
      pick = { w, rel };
    });
    if (!pick) return undefined;
    const { w, rel } = pick;
    // The played bar for that written bar (with repeats there can be several: take the nearest).
    const ms = this.song.measures;
    let k = -1;
    for (const m of ms) {
      if ((m.writtenIndex ?? m.index) !== w) continue;
      if (k < 0 || Math.abs(m.start - near) < Math.abs(ms[k].start - near)) k = m.index;
    }
    if (k < 0) return undefined;
    const m = ms[k];
    return { t: quarterToSec(this.song, secToQuarter(this.song, m.start) + rel), measure: k };
  }

  /** Show or hide finger numbers without re-rendering. */
  setShowFingers(show: boolean) {
    this.opts.showFingers = show;
    this.fingerLayer.style.display = show ? '' : 'none';
  }

  setOptions(opts: Partial<SheetOptions>) {
    const relayout = opts.layout !== undefined && opts.layout !== this.opts.layout;
    this.opts = { ...this.opts, ...opts };
    if (relayout) return false; // caller rebuilds the view
    this.render();
    return true;
  }

  private buildIndex() {
    const osmd = this.osmd!;
    const scale = UNIT_PX * this.opts.zoom;
    const measures = (osmd.GraphicSheet.MeasureList as unknown as (GMeasure | undefined)[][]) ?? [];
    const sysIndex = new Map<unknown, number>();
    const systems: SysBox[] = [];
    const anchors: Anchor[] = [];
    const notes: SheetNote[] = [];

    const barAnchors: Anchor[][] = [];
    for (const [w, staves] of measures.entries()) {
      const staffMeasures = staves.filter((m): m is GMeasure => !!m);
      if (!staffMeasures.length) continue;
      const first = staffMeasures[0];
      const sysObj = first.ParentMusicSystem;
      if (!sysIndex.has(sysObj)) {
        const top = Math.min(...staffMeasures.map((m) => m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderTop));
        const bottom = Math.max(...staffMeasures.map((m) => m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderBottom));
        sysIndex.set(sysObj, systems.length);
        systems.push({ top: top * scale, bottom: bottom * scale });
      } else {
        const s = systems[sysIndex.get(sysObj)!];
        for (const m of staffMeasures) {
          s.top = Math.min(s.top, (m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderTop) * scale);
          s.bottom = Math.max(s.bottom, (m.PositionAndShape.AbsolutePosition.y + m.PositionAndShape.BorderBottom) * scale);
        }
      }
      const sys = sysIndex.get(sysObj)!;
      const mq = first.parentSourceMeasure.AbsoluteTimestamp.RealValue * 4;
      const mEndQ = mq + first.parentSourceMeasure.Duration.RealValue * 4;
      const mx = first.PositionAndShape.AbsolutePosition.x;
      const mEndX = mx + first.PositionAndShape.Size.width;
      const entryX = new Map<number, number>();
      for (const m of staffMeasures) {
        for (const se of m.staffEntries) {
          const q = se.getAbsoluteTimestamp().RealValue * 4;
          const x = se.PositionAndShape.AbsolutePosition.x;
          entryX.set(q, Math.min(entryX.get(q) ?? Infinity, x));
          for (const ve of se.graphicalVoiceEntries) for (const g of ve.notes) if (!g.sourceNote.isRest()) notes.push({ g, entryX: x, ids: [], w, rel: q - mq });
        }
      }
      const qs = [...entryX.keys()].sort((a, b) => a - b);
      if (anchors.length === 0 && qs.length) this.firstEntryX = entryX.get(qs[0])! * scale;
      const bar: Anchor[] = [];
      if (!qs.length || qs[0] > mq + 1e-6) bar.push({ rel: 0, x: (qs.length ? Math.min(mx + 1, entryX.get(qs[0])!) : mx) * scale, sys });
      for (const q of qs) bar.push({ rel: q - mq, x: entryX.get(q)! * scale, sys });
      bar.push({ rel: mEndQ - mq, x: (mEndX - 0.5) * scale, sys });
      barAnchors[w] = bar;
      anchors.push(...bar);
    }
    this.barAnchors = barAnchors;
    this.anchors = anchors;
    this.systems = systems;
    this.notes = notes;
    this.matchNotes();
    this.buildFingers(scale);
    this.buildNames(scale);
  }

  /**
   * Note names, spelled as the score writes them (so E♭ stays E♭). They go on the other side of
   * the note from the finger numbers: below right-hand notes, above left-hand notes.
   */
  private buildNames(scale: number) {
    const layer = this.nameLayer;
    layer.innerHTML = '';
    layer.style.display = this.opts.showNames ? '' : 'none';
    const LETTER: Record<number, string> = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
    const ACC: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
    const byId = new Map(this.song.notes.map((n) => [n.id, n] as const));
    const size = Math.round(10 * Math.max(0.8, this.opts.zoom));
    for (const sn of this.notes) {
      if (sn.tieContinuation) continue;
      const p = sn.g.sourceNote.Pitch;
      if (!p) continue;
      const name = `${LETTER[p.FundamentalNote] ?? '?'}${ACC[Math.round(p.AccidentalHalfTones)] ?? ''}`;
      const hand = sn.noteId !== undefined ? byId.get(sn.noteId)?.hand : undefined;
      const y = sn.g.PositionAndShape.AbsolutePosition.y * scale;
      const el = document.createElement('div');
      el.className = 'sheet-name';
      el.textContent = name;
      el.style.fontSize = `${size}px`;
      const off = hand === 'L' ? -(size + 0.9 * UNIT_PX * this.opts.zoom) : 0.9 * UNIT_PX * this.opts.zoom;
      el.style.transform = `translate(${sn.g.PositionAndShape.AbsolutePosition.x * scale - 2}px, ${y + off}px)`;
      layer.appendChild(el);
    }
  }

  setShowNames(show: boolean) {
    this.opts.showNames = show;
    this.nameLayer.style.display = show ? '' : 'none';
  }

  /** Move the playhead and scroll to song time t, without colouring notes (used by the editor). */
  showAt(t: number) {
    if (!this.osmd || !this.anchors.length) return;
    this.position(Math.max(0, t));
  }

  /**
   * Finger numbers for every note that has one: right hand above its chord, left hand below.
   * Uses the song's fingering, so estimated fingers show too, not only those printed in the score.
   */
  private buildFingers(scale: number) {
    const layer = this.fingerLayer;
    layer.innerHTML = '';
    layer.style.display = this.opts.showFingers ? '' : 'none';
    const byId = new Map(this.song.notes.map((n) => [n.id, n] as const));
    // Group noteheads into chords: same column and hand.
    const groups = new Map<string, { y: number; finger: number; hand: Hand }[]>();
    for (const sn of this.notes) {
      if (sn.noteId === undefined || sn.tieContinuation) continue;
      const n = byId.get(sn.noteId);
      if (!n?.finger) continue;
      const key = `${sn.entryX.toFixed(2)}|${n.hand}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ y: sn.g.PositionAndShape.AbsolutePosition.y, finger: n.finger, hand: n.hand });
    }
    const size = Math.round(11 * Math.max(0.8, this.opts.zoom));
    for (const [key, list] of groups) {
      const x = Number(key.split('|')[0]) * scale;
      const hand = list[0].hand;
      // Top to bottom on the page = high to low pitch.
      list.sort((a, b) => a.y - b.y);
      const edge = hand === 'R' ? list[0].y * scale - 2.2 * UNIT_PX * this.opts.zoom : list[list.length - 1].y * scale + 1.4 * UNIT_PX * this.opts.zoom;
      const ordered = hand === 'R' ? list : [...list].reverse();
      ordered.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = `sheet-finger ${hand === 'R' ? 'rh' : 'lh'}`;
        el.textContent = String(item.finger);
        el.style.fontSize = `${size}px`;
        const y = hand === 'R' ? edge - i * (size + 1) : edge + i * (size + 1);
        el.style.transform = `translate(${x}px, ${y}px)`;
        layer.appendChild(el);
      });
    }
  }

  /** Link each notehead to the song note it shows (by written pitch and position). */
  private matchNotes() {
    const byPitch = new Map<number, { n: Note; q: number; qEnd: number }[]>();
    for (const n of this.song.notes) {
      const p = n.origPitch ?? n.pitch;
      if (!byPitch.has(p)) byPitch.set(p, []);
      // Compare in written positions, so every pass through a repeat maps to the same notehead.
      const q = writtenQuarter(this.song, n.start);
      byPitch.get(p)!.push({ n, q, qEnd: q + secToQuarter(this.song, n.start + n.duration) - secToQuarter(this.song, n.start) });
    }
    let matched = 0;
    for (const sn of this.notes) {
      const src = sn.g.sourceNote;
      const pitch = src.halfTone + 12;
      // Bar by bar: where this bar starts in *our* timing, plus the note's place in the bar. That way
      // a bar we and the score renderer measure differently can't shift the rest of the piece.
      const q = this.barStartQ(sn.w) + sn.rel;
      const cands = byPitch.get(pitch) ?? [];
      const isTieContinuation = !!src.NoteTie && src.NoteTie.StartNote !== src;
      // Every candidate at this written position (one per pass through a repeat).
      let bestD = Infinity;
      const dist = (c: (typeof cands)[number]) =>
        // A tied continuation belongs to the note that's still sounding.
        isTieContinuation && q >= c.q - 1e-6 && q < c.qEnd + 1e-6 ? 0 : Math.abs(c.q - q);
      for (const c of cands) bestD = Math.min(bestD, dist(c));
      sn.ids = bestD < 0.26 ? cands.filter((c) => Math.abs(dist(c) - bestD) < 1e-3).map((c) => ({ id: c.n.id, start: c.n.start })) : [];
      sn.ids.sort((a, b) => a.start - b.start);
      sn.noteId = sn.ids[0]?.id;
      sn.q = q;
      sn.tieContinuation = isTieContinuation;
      if (sn.ids.length) matched++;
    }
    this.matched = matched;
    this.unmatched = this.notes.length - matched;
  }

  /** Start of written bar w in our written timing (quarter notes). */
  private barStartQ(w: number): number {
    const ms = this.song.measures;
    const m = ms.find((x) => (x.writtenIndex ?? x.index) === w);
    if (!m) return Infinity;
    return m.writtenQ ?? secToQuarter(this.song, m.start);
  }

  /** Where is song time t on the page? Found bar by bar: which written bar, and how far into it. */
  private locate(t: number): { x: number; sys: number } {
    const ms = this.song.measures;
    if (!ms.length || !this.anchors.length) return { x: 0, sys: 0 };
    let k = 0;
    while (k + 1 < ms.length && ms[k + 1].start <= t + 1e-3) k++;
    const m = ms[k];
    const bar = this.barAnchors[m.writtenIndex ?? m.index] ?? this.barAnchors[0];
    if (!bar?.length) return { x: 0, sys: 0 };
    const rel = Math.max(0, secToQuarter(this.song, Math.max(t, m.start)) - secToQuarter(this.song, m.start));
    let i = 0;
    while (i + 1 < bar.length && bar[i + 1].rel <= rel + 1e-9) i++;
    const cur = bar[i];
    // Towards the end of a bar, glide on to the next bar's first note (on the same line) rather
    // than to the bar's end mark: there's a gap at every bar line, and stopping at the mark and
    // then hopping the gap made the playhead and scrolling lurch once per bar.
    const barLen = secToQuarter(this.song, m.start + m.duration) - secToQuarter(this.song, m.start);
    const nm = ms[k + 1];
    const first = nm ? this.barAnchors[nm.writtenIndex ?? nm.index]?.[0] : undefined;
    const nextBar = first && first.sys === cur.sys && first.x > cur.x ? { rel: barLen, x: first.x, sys: cur.sys } : undefined;
    let next = bar[i + 1];
    if (nextBar && (!next || next.rel >= barLen - 1e-6)) next = nextBar;
    if (!next || next.rel <= cur.rel) return { x: cur.x, sys: cur.sys };
    const f = Math.min(1, (rel - cur.rel) / (next.rel - cur.rel));
    return { x: cur.x + f * (next.x - cur.x), sys: cur.sys };
  }

  /** Call every frame. */
  update(session: GameSession) {
    if (!this.osmd || !this.anchors.length) return;
    const t = session.songTime;
    const q = this.position(Math.max(t, 0), session.running);
    this.colorNotes(session, t, q);
  }

  /** Highlight the notes to play (now/next colours). Off: the sheet stays plain, like paper. */
  setShowTargets(on: boolean) {
    this.showTargets = on;
  }
  private showTargets = true;

  // Smooth scrolling. Notation doesn't space notes evenly in time (a half note can take as
  // much room as an eighth), so following the playhead exactly changes speed at every note,
  // which looks like a stutter. While playing, the scroll follows it with a critically damped
  // spring instead; when paused or jumping, it snaps.
  private scrollX?: number;
  private scrollV = 0;
  private lastFrame?: number;
  private smoothScroll(target: number, smooth: boolean): number {
    const now = performance.now();
    const dt = this.lastFrame === undefined ? 0 : Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (!smooth || this.scrollX === undefined || dt === 0 || Math.abs(target - this.scrollX) > this.host.clientWidth * 0.5) {
      this.scrollX = target;
      this.scrollV = 0;
      return target;
    }
    const w = 7; // stiffness: how closely it follows (rad/s)
    const a = w * w * (target - this.scrollX) - 2 * w * this.scrollV;
    this.scrollV += a * dt;
    this.scrollX += this.scrollV * dt;
    return this.scrollX;
  }

  /** Playhead, scrolling and line turns for song time t. Returns the written position. */
  private position(t: number, smooth = false): number {
    const q = writtenQuarter(this.song, t);
    const { x, sys } = this.locate(t);
    const box = this.systems[sys] ?? { top: 0, bottom: 100 };

    this.playhead.style.transform = `translate(${x}px, ${box.top - 8}px)`;
    this.playhead.style.height = `${box.bottom - box.top + 16}px`;

    if (this.opts.layout === 'scroll') {
      const offset = this.smoothScroll(x - this.host.clientWidth * PLAYHEAD_AT, smooth);
      this.inner.style.transform = `translate(${-offset}px, ${-box.top + 30}px)`;
      if (this.sticky && this.stickyInner) {
        // Only needed once the real clef and key signature have scrolled away.
        this.sticky.style.display = offset > 4 ? '' : 'none';
        this.stickyInner.style.transform = `translateY(${-box.top + 30}px)`;
      }
    } else if (sys !== this.lastSys) {
      const top = Math.max(0, box.top - 6);
      const view = this.scroller;
      if (this.opts.layout === 'lines' || box.top < view.scrollTop || box.bottom > view.scrollTop + view.clientHeight) {
        view.scrollTo({ top, behavior: this.lastSys < 0 ? 'auto' : 'smooth' });
      }
    }
    this.lastSys = sys;
    return q;
  }

  private colorNotes(session: GameSession, t: number, writtenQ: number) {
    // Same now/next notes as the keyboard and the LUMI, in the same colours.
    const { now, next } = session.targetNotes();
    const role = new Map<number, string>();
    if (this.showTargets) {
      for (const n of next) role.set(n.id, this.opts.nextColors[n.hand]);
      for (const n of now) role.set(n.id, this.opts.colors[n.hand]);
    }
    void t;
    for (const sn of this.notes) {
      // With repeats: notes ahead of the playhead show the coming pass (fresh), notes behind it
      // show how you played them last time.
      if (sn.ids.length > 1) {
        const ahead = (sn.q ?? 0) >= writtenQ - 1e-6;
        const pick = ahead
          ? (sn.ids.find((c) => c.start >= t - 0.05) ?? sn.ids[sn.ids.length - 1])
          : ([...sn.ids].reverse().find((c) => c.start <= t + 0.05) ?? sn.ids[0]);
        sn.noteId = pick.id;
      }
      let color = PLAIN;
      if (sn.noteId !== undefined) {
        const st = session.noteState(sn.noteId).status;
        if (st === 'hit') color = HIT;
        else if (st === 'missed') color = MISS;
        else if (role.has(sn.noteId)) color = role.get(sn.noteId)!;
        else if (st === 'auto') color = AUTO;
      }
      if (color !== sn.color) {
        sn.color = color;
        try {
          sn.g.setColor(color, { applyToNoteheads: true, applyToStem: true, applyToFlag: true, applyToBeams: false, applyToLedgerLines: false, applyToModifiers: true, applyToTies: false, applyToSlurs: false });
        } catch {
          /* some notes (e.g. grace notes) have no SVG */
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.sticky?.remove();
    this.osmd?.clear();
    this.host.innerHTML = '';
    this.host.classList.remove('sheet-host');
    this.host.style.height = '';
  }
}

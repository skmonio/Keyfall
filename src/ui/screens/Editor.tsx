/**
 * Note editor: fix the notes of a song (or write your own), as a piano roll.
 *
 * Time runs left to right (bars marked), pitch goes up the page. Click an empty spot to add a
 * note, click a note to select it, drag it to move, drag its right edge to change its length.
 * Keys on your LUMI/MIDI keyboard can enter notes at the cursor ("step input").
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addNote,
  applyEdits,
  copyNotes,
  moveNotes,
  nextNoteStart,
  notesAt,
  notesInBox,
  pasteNotes,
  prevNoteStart,
  removeNotes,
  resizeNotes,
  setHand,
  setLength,
  snap,
  toEditable,
  type Clip,
  type EditNote,
} from '../../model/edit';
import { isBlack, noteLetter, pitchName, prefersFlats, type Hand, type Song } from '../../model/song';
import { SheetView } from '../../render/sheet';
import { addBars, canRemoveLastBar, KEY_SIGNATURES, removeLastBar, setTempo } from '../../model/blank';
import { quarterToSec, secToQuarter } from '../../model/time';
import { parseMusicXml } from '../../importers/musicxml';
import { estimateFingering } from '../../model/fingering';
import { db } from '../../storage/db';
import type { Navigate } from '../App';
import { Seg } from '../Seg';
import { ensureAudio, input, piano, updateSettings, useSettings } from '../services';

const ROW = 14; // px per semitone
const RULER = 26; // px, the time ruler above the notes

// Copied notes stay available while the app is open, so you can paste into another song too.
let clipboard: Clip | undefined;
const LENGTHS: [number, string][] = [
  [4, 'whole'],
  [2, 'half'],
  [1, 'quarter'],
  [0.5, 'eighth'],
  [0.25, '16th'],
];

type Snap = { notes: EditNote[]; song: Song };

type Drag = {
  kind: 'move' | 'resize' | 'create' | 'box';
  keys: Set<number>;
  x0: number;
  y0: number;
  base: EditNote[];
  dq: number;
  dp: number;
  dl: number;
  /** The note being placed (kind 'create'): follows the pointer until you let go. */
  fresh?: EditNote;
  lastPitch?: number;
  /** Drag-select box (kind 'box'), in grid pixels. */
  box?: { x0: number; y0: number; x1: number; y1: number; add: boolean };
};

export function Editor({ song: initial, nav }: { song: Song; nav: Navigate }) {
  const settings = useSettings();
  // The song itself changes only when bars are added or removed, or the key is set.
  const [song, setSongState] = useState(initial);
  const songRef = useRef(song);
  songRef.current = song;
  const written = song.sourceKind === 'written';
  const [notes, setNotes] = useState<EditNote[]>(() => toEditable(song));
  // Undo covers the notes and the song (bars, key, tempo) together.
  const [history, setHistory] = useState<Snap[]>([]);
  const [future, setFuture] = useState<Snap[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [hand, setHandTool] = useState<Hand>('R');
  const [len, setLen] = useState(1);
  const [grid, setGrid] = useState(0.5);
  const [zoom, setZoom] = useState(48); // px per quarter
  const [cursor, setCursor] = useState(0);
  const [stepInput, setStepInput] = useState(true);
  const [tool, setTool] = useState<'add' | 'select'>('add');
  const [clip, setClip] = useState<Clip | undefined>(clipboard);
  const [showScore, setShowScore] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(undefined), 4000);
    return () => clearTimeout(id);
  }, [msg]);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const dirty = history.length > 0;
  const names = settings.play.showNoteNames;
  const flats = useMemo(() => (song.keyFifths !== undefined ? song.keyFifths < 0 : prefersFlats(song)), [song]);

  // Geometry
  const bars = useMemo(
    () => song.measures.map((m) => ({ q: secToQuarter(song, m.start), end: secToQuarter(song, m.start + m.duration), m })),
    [song],
  );
  const totalQ = bars.length ? bars[bars.length - 1].end : Math.max(8, ...notes.map((n) => n.q + n.len));
  const [lo, hi] = useMemo(() => {
    const ps = notes.map((n) => n.pitch);
    const a = Math.min(48, ...ps) - 3;
    const b = Math.max(79, ...ps) + 3;
    return [Math.max(21, a), Math.min(108, b)];
  }, [song]); // keep the range stable while editing
  const width = totalQ * zoom + 40;
  /** Notes can run past the last bar (pasting, playing notes in at the end): add bars to hold them. */
  const barsFor = (s: Song, endQ: number): Song => {
    const last = s.measures[s.measures.length - 1];
    if (!last) return s;
    const lastEnd = secToQuarter(s, last.start + last.duration);
    if (endQ <= lastEnd + 1e-6) return s;
    const barQ = (last.beats * 4) / last.beatType;
    return addBars(s, Math.ceil((endQ - lastEnd - 1e-6) / barQ));
  };
  const withBars = (next: EditNote[]) => barsFor(songRef.current, Math.max(0, ...next.map((n) => n.q + n.len)));
  const height = (hi - lo + 1) * ROW;
  const yOf = (p: number) => (hi - p) * ROW;
  const pitchAt = (y: number) => Math.max(lo, Math.min(hi, hi - Math.floor(y / ROW)));

  const commit = (next: EditNote[], nextSong?: Song) => {
    const snap0 = { notes, song: songRef.current }; // taken now: the updater runs after the song has changed
    setHistory((h) => [...h.slice(-99), snap0]);
    setFuture([]);
    setNotes(next);
    if (nextSong && nextSong !== songRef.current) setSongState(nextSong);
  };
  /** Change the bars, key or tempo (undoable like note edits). */
  const setSong = (next: Song) => commit(notes, next);
  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setFuture((f) => [{ notes, song }, ...f]);
    setNotes(prev.notes);
    setSongState(prev.song);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setHistory((h) => [...h, { notes, song }]);
    setNotes(future[0].notes);
    setSongState(future[0].song);
    setFuture((f) => f.slice(1));
  };

  const preview = (p: number) => {
    ensureAudio().then(() => {
      piano.keyDown(p, 80);
      setTimeout(() => piano.keyUp(p), 250);
    });
  };

  // ---- pointer
  const svgPoint = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).closest('svg')!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tap = useRef<{ x: number; y: number; id: number } | null>(null);
  const cellAt = (e: React.PointerEvent) => {
    const { x, y } = svgPoint(e);
    // The grid cell under the pointer (not the nearest line), so a note starts where you point.
    return { q: snap(Math.max(0, Math.floor(x / zoom / grid) * grid), grid), p: pitchAt(y) };
  };
  const onBackgroundDown = (e: React.PointerEvent<SVGRectElement>) => {
    const { q, p } = cellAt(e);
    if (tool === 'select' || e.shiftKey) {
      // Drag a box to select the notes in it (Shift adds to the selection).
      const { x, y } = svgPoint(e);
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      drag.current = { kind: 'box', keys: new Set(), x0: e.clientX, y0: e.clientY, base: notes, dq: 0, dp: 0, dl: 0, box: { x0: x, y0: y, x1: x, y1: y, add: e.shiftKey } };
      setDragView({ ...drag.current });
      return;
    }
    setCursor(q);
    if (e.altKey) return; // Alt/Option-click just moves the cursor
    if (e.pointerType === 'touch') {
      // On a touchscreen a drag here scrolls; a quick tap adds a note (see onBackgroundUp).
      tap.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      return;
    }
    // Mouse/pen: the new note appears under the pointer and follows it until you let go.
    const fresh: EditNote = { key: -1, pitch: p, q, len, hand, velocity: 80, touched: true };
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = { kind: 'create', keys: new Set([-1]), x0: e.clientX, y0: e.clientY, base: notes, dq: 0, dp: 0, dl: 0, fresh, lastPitch: p };
    setDragView({ ...drag.current });
    preview(p);
  };
  const onBackgroundUp = (e: React.PointerEvent<SVGRectElement>) => {
    const t = tap.current;
    tap.current = null;
    if (!t || t.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) return; // it was a scroll
    const { q, p } = cellAt(e);
    const next = addNote(notes, { pitch: p, q, len, hand, velocity: 80 });
    if (next !== notes) {
      commit(next);
      setSel(new Set([next[next.length - 1].key]));
      preview(p);
    }
  };
  const onNoteDown = (e: React.PointerEvent<SVGRectElement>, n: EditNote) => {
    e.stopPropagation();
    const { x } = svgPoint(e);
    const nx = n.q * zoom;
    const nearEnd = x > nx + n.len * zoom - 7;
    let keys = sel;
    if (e.shiftKey) {
      keys = new Set(sel);
      if (keys.has(n.key)) keys.delete(n.key);
      else keys.add(n.key);
    } else if (!sel.has(n.key)) keys = new Set([n.key]);
    setSel(keys);
    setCursor(n.q);
    preview(n.pitch);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = { kind: nearEnd ? 'resize' : 'move', keys, x0: e.clientX, y0: e.clientY, base: notes, dq: 0, dp: 0, dl: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'box' && d.box) {
      const { x, y } = svgPoint(e);
      d.box = { ...d.box, x1: x, y1: y };
      setDragView({ ...d });
      return;
    }
    const dx = (e.clientX - d.x0) / zoom;
    if (d.kind === 'move' || d.kind === 'create') {
      d.dq = Math.round(dx / grid) * grid;
      d.dp = -Math.round((e.clientY - d.y0) / ROW);
      // Hear each new pitch as you drag a note up or down.
      const base = d.fresh ?? d.base.find((n) => d.keys.has(n.key));
      const p = base ? Math.max(21, Math.min(108, base.pitch + d.dp)) : undefined;
      if (p !== undefined && p !== d.lastPitch) {
        d.lastPitch = p;
        preview(p);
      }
    } else d.dl = Math.round(dx / grid) * grid;
    setDragView({ ...d });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragView(null);
    if (!d) return;
    if (d.kind === 'box' && d.box) {
      const b = d.box;
      if (Math.hypot(b.x1 - b.x0, b.y1 - b.y0) < 4) {
        // Just a click: move the cursor there and clear the selection.
        if (!b.add) setSel(new Set());
        setCursor(snap(Math.max(0, Math.floor(b.x0 / zoom / grid) * grid), grid));
        return;
      }
      const hit = notesInBox(notes, b.x0 / zoom, b.x1 / zoom, pitchAt(b.y0), pitchAt(b.y1));
      const keys = new Set(b.add ? sel : []);
      hit.forEach((n) => keys.add(n.key));
      setSel(keys);
      if (hit.length) setCursor(Math.min(...hit.map((n) => n.q)));
      return;
    }
    if (d.kind === 'create' && d.fresh) {
      const f = d.fresh;
      const placed = { pitch: Math.max(21, Math.min(108, f.pitch + d.dp)), q: Math.max(0, f.q + d.dq), len: f.len, hand: f.hand, velocity: f.velocity };
      const next = addNote(d.base, placed);
      if (next !== d.base) {
        commit(next);
        setSel(new Set([next[next.length - 1].key]));
        setCursor(placed.q);
      }
      return;
    }
    if (d.kind === 'move' && (d.dq || d.dp)) commit(moveNotes(d.base, d.keys, d.dq, d.dp));
    if (d.kind === 'resize' && d.dl) commit(resizeNotes(d.base, d.keys, d.dl));
  };

  // ---- the time ruler: click or drag it to put the cursor anywhere. It snaps to note starts
  // when close to one (and plays them), otherwise to the grid.
  const rulerDrag = useRef<{ id: number; last?: number } | null>(null);
  const rulerQ = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const raw = Math.max(0, (e.clientX - r.left) / zoom);
    let best: number | undefined;
    for (const n of notes) if (Math.abs(n.q - raw) * zoom < 8 && (best === undefined || Math.abs(n.q - raw) < Math.abs(best - raw))) best = n.q;
    return { q: best ?? Math.max(0, snap(raw, grid)), onNote: best !== undefined };
  };
  const rulerSet = (e: React.PointerEvent) => {
    const d = rulerDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const { q, onNote } = rulerQ(e);
    if (q === d.last) return;
    d.last = q;
    setCursor(q);
    if (onNote) notesAt(notes, q).forEach((n) => preview(n.pitch));
  };
  const onRulerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    rulerDrag.current = { id: e.pointerId };
    rulerSet(e);
  };
  const onRulerUp = () => {
    rulerDrag.current = null;
  };

  // ---- cursor, clipboard
  /** Move the cursor to the previous/next note, select it (a chord selects all its notes) and play it. */
  const stepNote = (dir: 1 | -1) => {
    const at = dir > 0 ? nextNoteStart(notes, cursor) : prevNoteStart(notes, cursor);
    if (at === undefined) return;
    setCursor(at);
    const chord = notesAt(notes, at);
    setSel(new Set(chord.map((n) => n.key)));
    chord.forEach((n) => preview(n.pitch));
  };
  const toStart = () => setCursor(0);
  const toEnd = () => setCursor(Math.max(0, ...notes.map((n) => n.q + n.len)));
  const copy = () => {
    const c = copyNotes(notes, sel);
    if (!c) return;
    clipboard = c;
    setClip(c);
    setMsg(`Copied ${c.items.length} note${c.items.length === 1 ? '' : 's'}. Put the cursor where they should go and press Paste (Cmd/Ctrl+V).`);
  };
  const cut = () => {
    if (!sel.size) return;
    copy();
    commit(removeNotes(notes, sel));
    setSel(new Set());
  };
  const paste = (at = cursor) => {
    if (!clip) return;
    const r = pasteNotes(notes, clip, at);
    if (r.keys.size) commit(r.notes, withBars(r.notes));
    setSel(r.keys);
    setCursor(snap(at + clip.span, grid));
    setMsg(undefined);
  };
  /** Paste a copy of the selection straight after it. */
  const duplicate = () => {
    const c = copyNotes(notes, sel);
    if (!c) return;
    const start = Math.min(...notes.filter((n) => sel.has(n.key)).map((n) => n.q));
    const r = pasteNotes(notes, c, start + c.span);
    if (r.keys.size) commit(r.notes, withBars(r.notes));
    setSel(r.keys);
  };

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSel(new Set(notes.map((n) => n.key)));
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') return void (sel.size && (e.preventDefault(), copy()));
      if (mod && e.key.toLowerCase() === 'x') return void (sel.size && (e.preventDefault(), cut()));
      if (mod && e.key.toLowerCase() === 'v') return void (clip && (e.preventDefault(), paste()));
      if (mod && e.key.toLowerCase() === 'd') return void (sel.size && (e.preventDefault(), duplicate()));
      if (mod) return;
      // Moving the cursor: , and . step note by note; Home/End; ←/→ by the snap when nothing is selected.
      if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        stepNote(e.key === '.' ? 1 : -1);
        return;
      }
      if (e.key === 'Home') return void (e.preventDefault(), toStart());
      if (e.key === 'End') return void (e.preventDefault(), toEnd());
      if (e.key === 'Escape') return void setSel(new Set());
      if (!sel.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setCursor((c) => Math.max(0, snap(c + (e.key === 'ArrowRight' ? 1 : -1) * grid, grid)));
        return;
      }
      if (!sel.size && !['Space'].includes(e.code)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit(removeNotes(notes, sel));
        setSel(new Set());
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dp = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        commit(moveNotes(notes, sel, 0, dp));
        const first = notes.find((n) => sel.has(n.key));
        if (first) preview(first.pitch + dp);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        commit(moveNotes(notes, sel, (e.key === 'ArrowRight' ? 1 : -1) * grid, 0));
      } else if (e.key.toLowerCase() === 'h') {
        const anyR = notes.some((n) => sel.has(n.key) && n.hand === 'R');
        commit(setHand(notes, sel, anyR ? 'L' : 'R'));
      } else if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---- step input from the MIDI keyboard (notes pressed together make a chord)
  const chordRef = useRef<{ pitches: number[]; timer: number } | null>(null);
  const stateRef = useRef({ notes, cursor, len, hand, stepInput, history });
  stateRef.current = { notes, cursor, len, hand, stepInput, history };
  useEffect(() => {
    return input.onKey((e) => {
      if (e.type === 'on') piano.keyDown(e.pitch, e.velocity);
      else piano.keyUp(e.pitch);
      if (e.type !== 'on' || !stateRef.current.stepInput || e.source !== 'midi') return;
      if (!chordRef.current) {
        chordRef.current = {
          pitches: [],
          timer: window.setTimeout(() => {
            const { notes: cur, cursor: at, len: l, hand: h } = stateRef.current;
            let next = cur;
            for (const p of chordRef.current!.pitches) next = addNote(next, { pitch: p, q: at, len: l, hand: h, velocity: 80 });
            chordRef.current = null;
            if (next !== cur) {
              const snap0 = { notes: cur, song: songRef.current };
              setHistory((hh) => [...hh.slice(-99), snap0]);
              setFuture([]);
              setNotes(next);
              setSongState(withBars(next));
            }
            setCursor(at + l);
          }, 80),
        };
      }
      chordRef.current.pitches.push(e.pitch);
    });
  }, []);

  // ---- playback from the cursor
  const playTimer = useRef<number | undefined>(undefined);
  const [playQ, setPlayQ] = useState<number>();
  const playQRef = useRef(playQ);
  playQRef.current = playQ;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const playRef = useRef<{ t0: number; startSec: number; until: number; order: EditNote[]; i: number } | null>(null);
  const togglePlay = async () => {
    if (playRef.current) {
      stopPlay();
      return;
    }
    await ensureAudio();
    const startSec = quarterToSec(song, cursor);
    const endSec = Math.min(quarterToSec(song, totalQ), startSec + 60);
    const order = notes.filter((n) => quarterToSec(song, n.q) >= startSec - 1e-6).sort((x, y) => x.q - y.q);
    playRef.current = { t0: performance.now(), startSec, until: endSec, order, i: 0 };
    setPlaying(true);
    const LOOKAHEAD = 0.2; // seconds: notes are queued only this far ahead, so Stop is instant
    const tick = () => {
      const pr = playRef.current;
      if (!pr) return;
      const sec = pr.startSec + (performance.now() - pr.t0) / 1000;
      if (sec > pr.until) return stopPlay();
      while (pr.i < pr.order.length) {
        const n = pr.order[pr.i];
        const s = quarterToSec(song, n.q);
        if (s > sec + LOOKAHEAD) break;
        pr.i++;
        if (s >= sec - 0.05) piano.scheduleNote(n.pitch, quarterToSec(song, n.q + n.len) - s, n.velocity, Math.max(0, s - sec), 0.9);
      }
      setPlayQ(secToQuarter(song, sec));
      playTimer.current = requestAnimationFrame(tick);
    };
    playTimer.current = requestAnimationFrame(tick);
  };
  const stopPlay = () => {
    playRef.current = null;
    if (playTimer.current) cancelAnimationFrame(playTimer.current);
    piano.cancelScheduled();
    setPlaying(false);
    setPlayQ(undefined);
  };
  useEffect(() => () => stopPlay(), []);

  // Keep the play position in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || playQ === undefined) return;
    const x = playQ * zoom + 60;
    if (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft) el.scrollLeft = x - 120;
  }, [playQ]);

  // ---- save
  const save = async () => {
    const edited = applyEdits(song, notes);
    await db.saveSong(edited);
    nav({ name: 'setup', song: edited });
  };
  const revert = async () => {
    if (!song.originalMusicXml || !confirm('Put back the notes as they were when you imported this song? Your edits will be lost.')) return;
    const fresh = parseMusicXml(song.originalMusicXml, song.title);
    estimateFingering(fresh.notes);
    const restored: Song = { ...fresh, id: song.id, title: song.title, addedAt: song.addedAt, sourceKind: song.sourceKind };
    await db.saveSong(restored);
    nav({ name: 'setup', song: restored });
  };
  /** Download the sheet music as it is now (for MuseScore, printing, or sharing). */
  const download = () => {
    const xml = applyEdits(song, notes).musicXml;
    if (!xml) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
    a.download = `${song.title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'score'}.musicxml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const canDropBar = canRemoveLastBar(song, notes.map((n) => quarterToSec(song, n.q)));
  const leave = () => {
    if (dirty && !confirm('Leave without saving your changes?')) return;
    nav({ name: 'setup', song });
  };

  // ---- the sheet music: one scrolling line with a playhead at the cursor (or the play position)
  const sheetHost = useRef<HTMLDivElement>(null);
  const sheet = useRef<SheetView | null>(null);
  // "Your version" is the sheet music written from the notes as they are now (what Save will
  // store); "Original" is the score as it was imported.
  const hasOriginal = !written && !!(song.originalMusicXml ?? song.musicXml);
  const [sheetMode, setSheetMode] = useState<'mine' | 'original'>(written || song.edited || !hasOriginal ? 'mine' : 'original');
  const [draft, setDraft] = useState<Song>();
  const draftReady = useRef(false);
  useEffect(() => {
    if (!showScore || sheetMode !== 'mine') return;
    const id = window.setTimeout(
      () => {
        try {
          setDraft(applyEdits(song, notes));
          draftReady.current = true;
        } catch (e) {
          console.warn('Could not write the sheet music', e);
        }
      },
      draftReady.current ? 450 : 0,
    );
    return () => clearTimeout(id);
  }, [notes, song, sheetMode, showScore]);
  const sheetSong = sheetMode === 'mine' ? draft : song;
  const sheetXml = sheetMode === 'mine' ? draft?.musicXml : (song.originalMusicXml ?? song.musicXml);
  useEffect(() => {
    const box = sheetHost.current;
    const xml = sheetXml;
    const sSong = sheetSong;
    if (!showScore || !box || !xml || !sSong) return;
    // Lay out the new sheet out of sight and swap it in when ready, so edits don't flicker.
    const host = document.createElement('div');
    host.className = 'editor-sheet-layer';
    box.appendChild(host);
    const sv = new SheetView(host, sSong, xml, {
      layout: 'scroll',
      zoom: 0.9,
      showFingers: false,
      showNames: settings.play.showNoteNames,
      colors: settings.colors,
      nextColors: settings.nextColors,
    });
    let alive = true;
    sv.init().then(() => {
      if (!alive) return;
      const prev = sheet.current;
      sheet.current = sv;
      prev?.dispose();
      host.classList.add('ready');
      for (const el of [...box.children]) if (el !== host) el.remove();
      sv.showAt(quarterToSec(song, playQRef.current ?? cursorRef.current));
    });
    return () => {
      alive = false;
      // A sheet on show stays until the next one is ready; one still being laid out is dropped.
      if (sheet.current !== sv) {
        sv.dispose();
        host.remove();
      }
    };
  }, [showScore, sheetSong, sheetXml]);
  // Hiding the sheet, or leaving the editor, frees the one on show.
  useEffect(
    () => () => {
      sheet.current?.dispose();
      sheet.current = null;
    },
    [showScore],
  );
  useEffect(() => {
    sheet.current?.showAt(quarterToSec(song, playQ ?? cursor));
  }, [cursor, playQ]);
  useEffect(() => sheet.current?.setShowNames(names), [names]);
  // Keep the cursor in view in the note grid when it moves (e.g. from the sheet).
  useEffect(() => {
    const el = scroller.current;
    if (!el || playQ !== undefined) return;
    const x = cursor * zoom + 60;
    if (x < el.scrollLeft + 60 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = x - el.clientWidth / 3;
  }, [cursor]);

  const sheetDrag = useRef<{ x: number; lastX: number; moved: boolean; id: number } | null>(null);
  const onSheetDown = (e: React.PointerEvent<HTMLDivElement>) => {
    sheetDrag.current = { x: e.clientX, lastX: e.clientX, moved: false, id: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onSheetMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = sheetDrag.current;
    const sv = sheet.current;
    if (!d || !sv || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 6) return;
    d.moved = true;
    const delta = e.clientX - d.lastX;
    d.lastX = e.clientX;
    const box = e.currentTarget.getBoundingClientRect();
    const hit = sv.timeAt(sv.playheadClientX() - delta, box.top + box.height / 2, quarterToSec(song, cursor));
    if (hit) setCursor(Math.max(0, snap(secToQuarter(song, hit.t), grid)));
  };
  const onSheetUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = sheetDrag.current;
    sheetDrag.current = null;
    const sv = sheet.current;
    if (!d || !sv || d.moved || d.id !== e.pointerId) return;
    // A tap: put the cursor at that spot in the music.
    const hit = sv.timeAt(e.clientX, e.clientY, quarterToSec(song, cursor));
    if (hit) setCursor(Math.max(0, snap(secToQuarter(song, hit.t), grid)));
  };

  const selNotes = notes.filter((n) => sel.has(n.key));
  const shown = (n: EditNote) => {
    const d = dragView;
    if (!d || !d.keys.has(n.key)) return n;
    return d.kind === 'move' ? { ...n, q: Math.max(0, n.q + d.dq), pitch: n.pitch + d.dp } : { ...n, len: Math.max(0.125, n.len + d.dl) };
  };
  const hasRepeats = song.measures.some((m) => (m.pass ?? 1) > 1);

  return (
    <div className="page editor" style={{ maxWidth: 'none' }}>
      <div className="row">
        <button onClick={leave}>← Back</button>
        <div className="grow" style={{ minWidth: 200 }}>
          <h2 style={{ margin: 0 }}>Edit notes</h2>
          <div className="small muted">{song.title}</div>
        </div>
        {song.originalMusicXml && <button onClick={revert} title="Put the notes back as they were when you imported the song">Undo all edits</button>}
        <button onClick={undo} disabled={!history.length} title="Undo (Cmd/Ctrl+Z)">↶ Undo</button>
        <button onClick={redo} disabled={!future.length} title="Redo (Shift+Cmd/Ctrl+Z)">↷ Redo</button>
        <button className="primary" onClick={save} disabled={!dirty}>Save</button>
      </div>

      <div className="card row" style={{ gap: 18 }}>
        <div className="field">
          <label>Mouse</label>
          <Seg<'add' | 'select'>
            value={tool}
            options={[
              ['add', '✏️ Add notes'],
              ['select', '⬚ Select'],
            ]}
            onChange={setTool}
          />
        </div>
        <div className="field">
          <label>New notes: hand</label>
          <Seg<Hand> value={hand} options={[['R', 'Right'], ['L', 'Left']]} onChange={setHandTool} />
        </div>
        <div className="field">
          <label>Length</label>
          <select value={len} onChange={(e) => { const v = Number(e.target.value); setLen(v); if (sel.size) commit(setLength(notes, sel, v)); }}>
            {LENGTHS.map(([v, name]) => (
              <option key={v} value={v}>{name}</option>
            ))}
            <option value={1.5}>dotted quarter</option>
            <option value={3}>dotted half</option>
          </select>
        </div>
        <div className="field">
          <label>Snap to</label>
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
            <option value={1}>beats</option>
            <option value={0.5}>eighths</option>
            <option value={0.25}>16ths</option>
            <option value={1 / 3}>triplets</option>
          </select>
        </div>
        <div className="field">
          <label>Zoom</label>
          <input type="range" min={20} max={120} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </div>
        <label className="row small" style={{ gap: 6 }} title="Keys you press on your LUMI/MIDI keyboard are added at the cursor">
          <input type="checkbox" checked={stepInput} onChange={(e) => setStepInput(e.target.checked)} /> Enter notes from my keyboard
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={showScore} onChange={(e) => setShowScore(e.target.checked)} /> Show the score
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={names} onChange={(e) => updateSettings((x) => (x.play.showNoteNames = e.target.checked))} /> Note names
        </label>
      </div>



      <div className="card row" style={{ gap: 18 }}>
        <div className="field">
          <label>Key signature</label>
          <select
            value={song.keyFifths ?? 'auto'}
            onChange={(e) => setSong({ ...song, keyFifths: e.target.value === 'auto' ? undefined : Number(e.target.value) })}
            title="The key the sheet music is written in (sharps or flats)"
          >
            {!written && <option value="auto">Work it out from the notes</option>}
            {KEY_SIGNATURES.map((k) => (
              <option key={k.fifths} value={k.fifths}>{k.name}</option>
            ))}
          </select>
        </div>
        {song.tempos.length <= 1 && (
          <div className="field">
            <label>Tempo (bpm)</label>
            <input
              type="number"
              min={20}
              max={300}
              style={{ width: 80 }}
              value={Math.round(song.tempos[0]?.bpm ?? 100)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 20 && v <= 300) setSong(setTempo(song, v));
              }}
            />
          </div>
        )}
        <div className="field">
          <label>Bars ({song.measures.length})</label>
          <div className="row" style={{ gap: 6 }}>
            <button onClick={() => setSong(addBars(song, 4))} title="Add 4 empty bars at the end">+ 4 bars</button>
            <button onClick={() => setSong(removeLastBar(song))} disabled={!canDropBar} title={canDropBar ? 'Remove the last bar' : 'Only an empty last bar can be removed'}>− Last bar</button>
          </div>
        </div>
        {hasOriginal && showScore && (
          <div className="field">
            <label>Sheet shows</label>
            <Seg<'mine' | 'original'> value={sheetMode} options={[['mine', 'Your version'], ['original', 'Original']]} onChange={setSheetMode} />
          </div>
        )}
        <div className="spacer" />
        <button onClick={download} title="Save the sheet music as a MusicXML file: open it in MuseScore (free) to print or share">⬇ Download MusicXML</button>
      </div>

      {showScore && (
        <div
          className="sheet-area layout-scroll editor-sheet"
          onPointerDown={onSheetDown}
          onPointerMove={onSheetMove}
          onPointerUp={onSheetUp}
          onPointerCancel={onSheetUp}
          style={{ touchAction: 'none', cursor: 'grab' }}
          title="Drag to move through the music, or tap a spot to put the cursor there"
        >
          <div ref={sheetHost} />
        </div>
      )}

      <div className="row editor-transport">
        <button onClick={toStart} title="Cursor to the start (Home)">⏮</button>
        <button onClick={() => stepNote(-1)} title="Previous note (,)">◀ Note</button>
        <button onClick={() => stepNote(1)} title="Next note (.)">Note ▶</button>
        <button onClick={toEnd} title="Cursor to the last note (End)">⏭</button>
        <button className={playing ? '' : 'primary'} onClick={togglePlay}>{playing ? '■ Stop' : '▶ Play from cursor'}</button>
        <span className="small muted">
          {(() => {
            const b = bars.find((x) => x.end > cursor + 1e-6);
            return b ? `Cursor: bar ${b.m.number}, beat ${Math.round((cursor - b.q + 1) * 100) / 100}` : 'Cursor: at the end';
          })()}
        </span>
        <div className="spacer" />
        <button onClick={copy} disabled={!sel.size} title="Copy the selected notes (Cmd/Ctrl+C)">Copy</button>
        <button onClick={cut} disabled={!sel.size} title="Cut (Cmd/Ctrl+X)">Cut</button>
        <button onClick={() => paste()} disabled={!clip} title="Paste at the cursor (Cmd/Ctrl+V)">Paste{clip ? ` (${clip.items.length})` : ''}</button>
        <button onClick={duplicate} disabled={!sel.size} title="Paste a copy straight after the selection (Cmd/Ctrl+D)">Duplicate</button>
      </div>
      {selNotes.length === 0 ? (
        <div className="small muted editor-selrow">Nothing selected. Click a note, Shift-drag a box, or step with ◀ Note / Note ▶.</div>
      ) : (
        <div className="small editor-selrow">
          Selected: {selNotes.length === 1 ? `${pitchName(selNotes[0].pitch)}, ${selNotes[0].hand === 'R' ? 'right' : 'left'} hand, bar ${song.measures[bars.findIndex((b) => b.end > selNotes[0].q)]?.number ?? '?'}` : `${selNotes.length} notes`}
          {' · '}
          <button className="link" onClick={() => commit(setHand(notes, sel, 'R'))}>→ right hand</button>{' · '}
          <button className="link" onClick={() => commit(setHand(notes, sel, 'L'))}>→ left hand</button>{' · '}
          <button className="link danger" onClick={() => { commit(removeNotes(notes, sel)); setSel(new Set()); }}>delete</button>
        </div>
      )}
      {msg && <div className="notice editor-toast">{msg}<button className="link" onClick={() => setMsg(undefined)}> ✕</button></div>}
      <div className="editor-roll" ref={scroller}>
        <div className="editor-ruler-row" style={{ width: width + 60 }}>
          <div className="editor-corner" />
          <svg width={width} height={RULER} onPointerDown={onRulerDown} onPointerMove={rulerSet} onPointerUp={onRulerUp} onPointerCancel={onRulerUp} style={{ display: 'block', cursor: 'col-resize', touchAction: 'none' }}>
            <rect x={0} y={0} width={width} height={RULER} fill="#101727" />
            {bars.map((b, i) => (
              <g key={i}>
                {Array.from({ length: Math.round(b.end - b.q) }, (_, k) => (
                  <line key={k} x1={(b.q + k) * zoom} x2={(b.q + k) * zoom} y1={k === 0 ? 0 : RULER - 7} y2={RULER} stroke={k === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)'} />
                ))}
                <text x={b.q * zoom + 4} y={13} fontSize={11} fontWeight={600} fill="#cbd5e1">
                  {b.m.number}
                  {(b.m.pass ?? 1) > 1 ? '′' : ''}
                </text>
              </g>
            ))}
            {/* note starts, so you can see where the ruler will snap */}
            {[...new Set(notes.map((n) => n.q))].map((q) => (
              <circle key={q} cx={q * zoom} cy={RULER - 3} r={1.8} fill="#64748b" />
            ))}
            {playQ !== undefined && <line x1={playQ * zoom} x2={playQ * zoom} y1={0} y2={RULER} stroke="#818cf8" strokeWidth={2} />}
            <polygon points={`${cursor * zoom - 7},0 ${cursor * zoom + 7},0 ${cursor * zoom},${RULER - 4}`} fill="#fbbf24" />
          </svg>
        </div>
        <div style={{ display: 'flex', width: width + 60 }}>
          <div className="editor-keys" style={{ height }}>
            {Array.from({ length: hi - lo + 1 }, (_, i) => hi - i).map((p) => (
              <div key={p} className={`ek ${isBlack(p) ? 'b' : 'w'}`} style={{ height: ROW }} onPointerDown={() => preview(p)}>
                {p % 12 === 0 ? pitchName(p) : names ? noteLetter(p, flats) : ''}
              </div>
            ))}
          </div>
          <svg width={width} height={height} onPointerMove={onMove} onPointerUp={onUp} style={{ display: 'block' }}>
            {/* rows */}
            {Array.from({ length: hi - lo + 1 }, (_, i) => hi - i).map((p) => (
              <rect key={p} x={0} y={yOf(p)} width={width} height={ROW} fill={isBlack(p) ? '#0e1322' : '#141b2e'} />
            ))}
            {/* beats and bars */}
            {bars.map((b, i) => (
              <g key={i}>
                {Array.from({ length: Math.round(b.end - b.q) }, (_, k) => (
                  <line key={k} x1={(b.q + k) * zoom} x2={(b.q + k) * zoom} y1={0} y2={height} stroke={k === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.07)'} />
                ))}
              </g>
            ))}
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              fill="transparent"
              onPointerDown={onBackgroundDown}
              onPointerUp={onBackgroundUp}
              style={{ cursor: tool === 'select' ? 'crosshair' : 'copy', touchAction: tool === 'select' ? 'none' : 'pan-x pan-y' }}
            />
            {/* notes */}
            {notes.map((n0) => {
              const n = shown(n0);
              const c = n.backing ? '#6b7280' : n.hand === 'R' ? settings.colors.R : settings.colors.L;
              const selected = sel.has(n.key);
              return (
                <g key={n.key}>
                  <rect
                    x={n.q * zoom + 1}
                    y={yOf(n.pitch) + 1}
                    width={Math.max(4, n.len * zoom - 2)}
                    height={ROW - 2}
                    rx={3}
                    fill={c}
                    opacity={n.backing ? 0.5 : 0.95}
                    stroke={selected ? '#fff' : 'rgba(0,0,0,0.4)'}
                    strokeWidth={selected ? 2 : 1}
                    onPointerDown={(e) => onNoteDown(e, n0)}
                    style={{ cursor: 'grab', touchAction: 'none' }}
                  >
                    <title>{`${pitchName(n.pitch)} · ${n.hand === 'R' ? 'right' : 'left'} hand${n.backing ? ' · backing part' : ''}`}</title>
                  </rect>
                  {names && n.len * zoom >= 18 && (
                    <text x={n.q * zoom + 4} y={yOf(n.pitch) + ROW - 4} fontSize={9} fontWeight={700} fill="#0b0f19" pointerEvents="none">
                      {noteLetter(n.pitch, flats)}
                    </text>
                  )}
                  <rect x={n.q * zoom + Math.max(4, n.len * zoom - 2) - 5} y={yOf(n.pitch) + 1} width={6} height={ROW - 2} fill="transparent" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => onNoteDown(e, n0)} />
                </g>
              );
            })}
            {/* the note being placed */}
            {dragView?.kind === 'create' && dragView.fresh && (
              <rect
                x={Math.max(0, dragView.fresh.q + dragView.dq) * zoom + 1}
                y={yOf(Math.max(lo, Math.min(hi, dragView.fresh.pitch + dragView.dp))) + 1}
                width={Math.max(4, dragView.fresh.len * zoom - 2)}
                height={ROW - 2}
                rx={3}
                fill={dragView.fresh.hand === 'R' ? settings.colors.R : settings.colors.L}
                stroke="#fff"
                strokeWidth={2}
                pointerEvents="none"
              />
            )}
            {dragView?.kind === 'box' && dragView.box && (
              <rect
                x={Math.min(dragView.box.x0, dragView.box.x1)}
                y={Math.min(dragView.box.y0, dragView.box.y1)}
                width={Math.abs(dragView.box.x1 - dragView.box.x0)}
                height={Math.abs(dragView.box.y1 - dragView.box.y0)}
                fill="rgba(251,191,36,0.12)"
                stroke="#fbbf24"
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            {/* cursor and play position */}
            <line x1={cursor * zoom} x2={cursor * zoom} y1={0} y2={height} stroke="#fbbf24" strokeWidth={2} />
            {playQ !== undefined && <line x1={playQ * zoom} x2={playQ * zoom} y1={0} y2={height} stroke="#818cf8" strokeWidth={2} />}
          </svg>
        </div>
      </div>
      <details className="small muted editor-help">
        <summary>Mouse and keyboard shortcuts</summary>
        Click an empty spot to add a note · click a note to select it (Shift for more) · drag to move · drag its right edge to make it
        longer · <span className="kbd">Delete</span> removes · <span className="kbd">↑</span>/<span className="kbd">↓</span> change pitch (Shift: an octave) ·{' '}
        <span className="kbd">←</span>/<span className="kbd">→</span> move in time · <span className="kbd">H</span> switches hand · <span className="kbd">Space</span> plays ·
        Option/Alt-click sets the cursor. <b>Cursor:</b> click or drag the ruler above the notes (it snaps to notes), <span className="kbd">,</span>/<span className="kbd">.</span> previous/next note,{' '}
        <span className="kbd">←</span>/<span className="kbd">→</span> with nothing selected. <b>Select:</b> Shift-drag (or the Select tool) draws a box, <span className="kbd">Cmd/Ctrl+A</span> all, <span className="kbd">Esc</span> none;
        Copy/Cut/Paste/Duplicate with <span className="kbd">Cmd/Ctrl+C/X/V/D</span> (paste goes to the cursor). With "Enter notes from my keyboard", play keys on your LUMI to add them at the cursor.
        {hasRepeats && ' This song has repeats: they are written out here, so each time through can be fixed separately.'}
      </details>
    </div>
  );
}

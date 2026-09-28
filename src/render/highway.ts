import type { GameSession } from '../engine/session';
import { noteLetter, pitchName, pitchRange, type Hand, type Note } from '../model/song';
import { layoutKeyboard, visibleRange, type KeyboardLayout } from './keyboard';

export interface HighwayTheme {
  /** "Play now" colour per hand (also used for the falling notes). */
  colors: Record<Hand, string>;
  /** "Next note" colour per hand. */
  nextColors?: Record<Hand, string>;
  showFingers: boolean;
  lookAheadSec: number;
  /** Mark the keys to press next on the keyboard. */
  hints?: boolean;
  /** Draw the falling notes (false = keyboard only, e.g. under the sheet music). */
  highway?: boolean;
  /** Show the hand you're not practising (its falling notes and auto-played keys). */
  showOtherHand?: boolean;
  /** "Listen first": the app plays everything, so draw its notes at full strength. */
  listen?: boolean;
  /** Letter names on the keys and the falling notes. */
  noteNames?: boolean;
  /** Spell black keys as flats (the song is in a flat key). */
  flats?: boolean;
}

const FEEDBACK_MS = 650;
const LABEL: Record<string, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss', wrong: 'Wrong' };
const FEEDBACK_COLOR: Record<string, string> = {
  perfect: '#a7f3d0',
  great: '#bfdbfe',
  good: '#fde68a',
  miss: '#fca5a5',
  wrong: '#f87171',
};

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Draws the falling-note highway and keyboard on a 2D canvas.
 * Everything is derived from the session's song clock each frame.
 */
export class HighwayRenderer {
  private ctx: CanvasRenderingContext2D;
  private layout!: KeyboardLayout;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private range: [number, number];
  keyboardHeight = 120;

  constructor(
    private canvas: HTMLCanvasElement,
    private session: GameSession,
    public theme: HighwayTheme,
    /** Show exactly these keys (e.g. the player's physical keyboard). Default: zoom to the song. */
    range?: [number, number],
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.range = range ?? this.autoRange();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(100, rect.width);
    this.h = Math.max(100, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.keyboardHeight = this.theme.highway === false ? this.h : Math.min(140, Math.max(70, this.h * 0.18));
    this.layout = layoutKeyboard(this.range[0], this.range[1], this.w);
  }

  /** Zoom to the notes you'll see: just your hand when the other one is hidden. */
  private autoRange(): [number, number] {
    const { session, theme } = this;
    const shown = theme.showOtherHand ? session.song.notes : session.song.notes.filter((n) => session.active.has(n.hand));
    const [lo, hi] = pitchRange(shown.length ? shown : session.song.notes);
    return visibleRange(lo, hi, 24);
  }

  /** Recompute the visible keys (after a theme change). `fixed` = show exactly these keys. */
  rezoom(fixed?: [number, number]) {
    this.range = fixed ?? this.autoRange();
    this.resize();
  }

  get hitY() {
    return this.h - this.keyboardHeight;
  }

  private pxPerSongSec() {
    // Keep the on-screen fall speed constant in real time, whatever the playback speed.
    return Math.max(1, this.hitY) / (this.theme.lookAheadSec * this.session.rate);
  }

  /** Find the note under a canvas point (CSS pixels), for hand overrides. */
  noteAt(x: number, y: number): Note | undefined {
    const t = this.session.songTime;
    const pps = this.pxPerSongSec();
    for (const n of this.session.song.notes) {
      const k = this.layout.keys.get(n.pitch);
      if (!k) continue;
      const bottom = this.hitY - (n.start - t) * pps;
      const top = bottom - n.duration * pps;
      if (x >= k.x && x <= k.x + k.w && y >= top - 2 && y <= bottom + 2) return n;
    }
    return undefined;
  }

  draw(perfNow: number) {
    const { ctx, w, h, session } = this;
    const t = session.songTime;
    const pps = this.pxPerSongSec();
    const hitY = this.hitY;
    const visibleSong = hitY / pps;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Background and lanes
    ctx.fillStyle = '#0b0f19';
    ctx.fillRect(0, 0, w, h);
    for (const k of this.layout.keys.values()) {
      if (k.black) {
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        ctx.fillRect(k.x, 0, k.w, hitY);
      } else if (k.pitch % 12 === 0 || k.pitch % 12 === 5) {
        ctx.fillStyle = k.pitch % 12 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(Math.round(k.x), 0, 1, hitY);
      }
    }

    // Section shading and bar lines
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    for (const m of session.song.measures) {
      if (m.start < t - 0.5 || m.start > t + visibleSong) continue;
      const y = hitY - (m.start - t) * pps;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, Math.round(y), w, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(String(m.number), 4, y - 2);
    }
    const shade = (from: number, to: number) => {
      const y1 = hitY - (to - t) * pps;
      const y2 = hitY - (from - t) * pps;
      const top = Math.max(0, y1);
      const bottom = Math.min(hitY, y2);
      if (bottom > top) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, top, w, bottom - top);
      }
    };
    shade(-1e9, session.rangeStart);
    shade(session.rangeEnd, 1e9);

    // Notes
    const chord = session.currentChord;
    const chordIds = new Set(chord?.notes.map((n) => n.id));
    const pulse = 0.5 + 0.5 * Math.sin(perfNow / 140);
    // Two passes: white-key notes first, then black-key notes on top with a dark outline, so a
    // black-key note is never hidden behind (or confused with) a white-key note next to it.
    const visible = [];
    for (const n of session.song.notes) {
      if (n.start > t + visibleSong) break;
      if (n.start + n.duration < t - 0.3) continue;
      const k = this.layout.keys.get(n.pitch);
      if (k) visible.push({ n, k });
    }
    for (const pass of [false, true]) {
      for (const { n, k } of visible) {
        if (k.black !== pass) continue;
        const bottom = hitY - (n.start - t) * pps;
        // A small gap at the top, so repeated notes on one key read as separate notes.
        const height = Math.max(6, n.duration * pps - 3);
        const top = bottom - height;
        const st = session.noteState(n.id);
        if (st.status === 'auto' && !this.theme.showOtherHand) continue;
        const base = this.theme.colors[n.hand];
        let fill = base;
        let alpha = 1;
        if (st.status === 'auto') alpha = this.theme.listen ? 0.9 : 0.28;
        else if (st.status === 'missed') fill = '#6b7280';
        else if (st.status === 'hit') alpha = 0.55;
        const pad = k.black ? 1 : 2;
        const r = Math.min(6, k.w / 3);
        roundRect(ctx, k.x + pad, top, k.w - pad * 2, height, r);
        if (k.black) {
          // Solid backing first so a translucent black-key note doesn't mix with what's behind it.
          ctx.fillStyle = '#0b0f19';
          ctx.fill();
        }
        ctx.fillStyle = withAlpha(fill, alpha);
        ctx.fill();
        if (k.black) {
          ctx.strokeStyle = 'rgba(11,15,25,0.9)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (chordIds.has(n.id) && st.status === 'pending') {
          ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.5 * pulse})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (st.status === 'hit') {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (this.theme.noteNames && st.status !== 'auto' && k.w >= 12 && height >= 16) {
          // The note's name at the top of the block.
          ctx.fillStyle = 'rgba(255,255,255,0.95)';
          ctx.font = `bold ${Math.round(Math.min(12, k.w * 0.42))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(noteLetter(n.pitch, this.theme.flats), k.x + k.w / 2, top + 3);
          ctx.textAlign = 'left';
        }
        if (this.theme.showFingers && n.finger && st.status !== 'auto' && k.w >= 10) {
          const fr = Math.min(9, k.w / 2 - 1);
          const cy = Math.min(bottom - fr - 2, hitY - fr - 2);
          if (cy > top + fr - 2) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath();
            ctx.arc(k.x + k.w / 2, cy, fr, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = n.fingerSource === 'score' ? '#fff' : 'rgba(255,255,255,0.85)';
            ctx.font = `bold ${Math.round(fr * 1.3)}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(n.finger), k.x + k.w / 2, cy + 0.5);
            ctx.textAlign = 'left';
          }
        }
      }
    }

    // Hit line
    ctx.fillStyle = session.waiting ? `rgba(250,204,21,${0.6 + 0.4 * pulse})` : 'rgba(255,255,255,0.7)';
    ctx.fillRect(0, hitY - 2, w, 3);

    this.drawKeyboard(t, perfNow);
    this.drawFeedback(perfNow);
  }

  private drawKeyboard(t: number, perfNow: number) {
    const { ctx, session } = this;
    const top = this.hitY + 1;
    const kh = this.keyboardHeight;
    // Keys sounding from the score right now (the auto-played hand), if that hand is shown.
    const sounding = new Map<number, Hand>();
    if (this.theme.showOtherHand) {
      for (const n of session.song.notes) {
        if (n.start > t + 0.05) break;
        if (n.start + n.duration > t && session.noteState(n.id).status === 'auto') sounding.set(n.pitch, n.hand);
      }
    }
    // Keys to press, in the same now/next colours as the LUMI.
    const targets = this.theme.hints !== false ? session.keyTargets() : new Map<number, { hand: Hand; role: 'now' | 'next' }>();
    const nextColors = this.theme.nextColors ?? this.theme.colors;
    const wrongKeys = new Set<number>();
    const hitKeys = new Map<number, Hand>();
    for (const f of session.feedback) {
      if (f.kind === 'wrong' && perfNow - f.perf < 400) wrongKeys.add(f.pitch);
      if (f.kind !== 'wrong' && f.kind !== 'miss' && f.hand && perfNow - f.perf < 350) hitKeys.set(f.pitch, f.hand);
    }
    const pulse = session.waiting ? 0.8 + 0.2 * Math.sin(perfNow / 140) : 1;

    const draw = (black: boolean) => {
      for (const k of this.layout.keys.values()) {
        if (k.black !== black) continue;
        const height = black ? kh * 0.62 : kh;
        const held = session.held.has(k.pitch);
        const auto = sounding.get(k.pitch);
        const target = targets.get(k.pitch);
        const base = black ? '#111827' : '#f3f4f6';
        const x = k.x + (black ? 0 : 0.5);
        const w = k.w - (black ? 0 : 1);
        ctx.fillStyle = base;
        roundRect(ctx, x, top, w, height, 3);
        ctx.fill();
        let overlay: string | undefined;
        if (held && wrongKeys.has(k.pitch)) overlay = '#ef4444';
        else if (held && (target || hitKeys.has(k.pitch))) overlay = this.theme.colors[target?.hand ?? hitKeys.get(k.pitch)!];
        else if (held) overlay = '#a78bfa';
        // Now: solid colour with an outline. Next: the same idea, but faded, so "now" stands out.
        else if (target) overlay = target.role === 'now' ? this.theme.colors[target.hand] : withAlpha(nextColors[target.hand], 0.38);
        else if (auto) overlay = withAlpha(this.theme.colors[auto], this.theme.listen ? 1 : 0.55);
        if (overlay) {
          ctx.fillStyle = overlay;
          roundRect(ctx, x, top, w, height, 3);
          ctx.fill();
        }
        if (target?.role === 'now' && !held) {
          // "Play now": a bright outline, like the LUMI's key lights.
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * pulse})`;
          ctx.lineWidth = 2;
          roundRect(ctx, x + 1.5, top + 1.5, w - 3, height - 3, 3);
          ctx.stroke();
        } else if (!black) {
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 0.5;
          roundRect(ctx, x, top, w, height, 3);
          ctx.stroke();
        }
        const lit = !!(target || held);
        if (this.theme.noteNames && k.w > 10) {
          // Every key named: the letter (C also gets its octave, so you know where you are).
          ctx.fillStyle = black ? (lit ? '#0b0f19' : '#d1d5db') : lit ? '#ffffff' : '#4b5563';
          ctx.font = `${black ? '' : 'bold '}${Math.round(Math.min(black ? 10 : 12, k.w * 0.4))}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(k.pitch % 12 === 0 ? pitchName(k.pitch) : noteLetter(k.pitch, this.theme.flats), k.x + k.w / 2, top + height - (black ? 4 : 6));
          ctx.textAlign = 'left';
        } else if (!black && k.pitch % 12 === 0 && k.w > 14) {
          ctx.fillStyle = lit ? '#ffffff' : '#6b7280';
          ctx.font = '10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(pitchName(k.pitch), k.x + k.w / 2, top + height - 6);
          ctx.textAlign = 'left';
        }
      }
    };
    draw(false);
    draw(true);
  }

  private drawFeedback(perfNow: number) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 14px system-ui, sans-serif';
    for (const f of this.session.feedback) {
      const age = perfNow - f.perf;
      if (age < 0 || age > FEEDBACK_MS) continue;
      const k = this.layout.keys.get(f.pitch);
      if (!k) continue;
      const a = 1 - age / FEEDBACK_MS;
      ctx.globalAlpha = a;
      ctx.fillStyle = FEEDBACK_COLOR[f.kind];
      ctx.fillText(LABEL[f.kind], k.x + k.w / 2, this.hitY - 10 - age * 0.06);
      if (f.kind !== 'miss') {
        ctx.fillStyle = f.kind === 'wrong' ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.35)';
        ctx.fillRect(k.x, this.hitY - 40 * a, k.w, 40 * a);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

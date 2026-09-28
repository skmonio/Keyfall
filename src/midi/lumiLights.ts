/**
 * LUMI Keys LED control.
 *
 * ROLI never documented this. Everything here comes from community reverse engineering,
 * mainly github.com/benob/LUMI-lights (SYSEX.txt and the default LittleFoot program):
 *
 * 1. Per-key colour. The LUMI's default program lights a key when it *receives* a MIDI
 *    note-on for that key. The velocity (1..127) picks a colour from a fixed palette
 *    (see lumiPalette.ts); note-off turns it off. Poly aftertouch sets that key's
 *    brightness. This is plain MIDI and needs no SysEx permission. Only keys inside the
 *    LUMI's current 24-key octave window light up.
 *
 * 2. Global settings via SysEx (needs SysEx permission): the colour of in-scale keys,
 *    the root-key colour, colour mode and brightness. We use these to blank the LUMI's
 *    own colours so that only the app's lights show ("app" mode).
 *
 * Firmware versions differ. If lights don't work, the game still runs; the LUMI test
 * screen lets the user check what their unit supports.
 */
import { LUMI_PALETTE } from './lumiPalette';

export type RGB = [number, number, number];

export interface MidiOut {
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

const ROLI_HEADER = [0xf0, 0x00, 0x21, 0x10, 0x77];
/** The LUMI's address in ROLI SysEx. 0x37 is what the community found; some units or
 *  connections (e.g. Bluetooth) answer to another one, which the Lights check can find. */
export const LUMI_DEVICE_ID = 0x37;

/** ROLI BLOCKS checksum over the 8 command bytes. */
export function checksum(bytes: number[]): number {
  let c = bytes.length;
  for (const b of bytes) c = (c * 3 + b) & 0xff;
  return c & 0x7f;
}

/** Pack values of arbitrary bit widths into 7-bit SysEx bytes, least significant bits first. */
export class BitPacker {
  private bits: number[] = [];
  append(value: number, width: number): this {
    for (let i = 0; i < width; i++) this.bits.push((value >> i) & 1);
    return this;
  }
  bytes(len = 8): number[] {
    const out: number[] = [];
    for (let i = 0; i < len; i++) {
      let b = 0;
      for (let j = 0; j < 7; j++) b |= (this.bits[i * 7 + j] ?? 0) << j;
      out.push(b);
    }
    return out;
  }
}

export function buildSysex(command: number[], deviceId = LUMI_DEVICE_ID): number[] {
  return [...ROLI_HEADER, deviceId & 0x7f, ...command, checksum(command), 0xf7];
}

/** Command to set colour slot 0 (in-scale key colour) or 1 (root key colour). */
export function colorCommand(slot: 0 | 1, [r, g, b]: RGB): number[] {
  return new BitPacker()
    .append(0x10, 7)
    .append(0x20 + 0x10 * slot, 7)
    .append(0b00100, 5)
    .append(b & 0xff, 8)
    .append(g & 0xff, 8)
    .append(r & 0xff, 8)
    .append(0xff, 8)
    .bytes();
}

export function brightnessCommand(percent: number): number[] {
  const v = Math.round(Math.max(0, Math.min(100, percent)));
  return new BitPacker().append(0x10, 7).append(0x40, 7).append(0b00100, 5).append(v, 7).bytes();
}

/** Octave-button setting, −4..+5. The LUMI's lowest key becomes C3 + 12 × octave (for one LUMI). */
export function octaveCommand(octave: number): number[] {
  const o = Math.max(-4, Math.min(5, Math.round(octave)));
  return new BitPacker().append(0x10, 7).append(0x40, 7).append(0b00000, 5).append(o >>> 0, 32).bytes();
}

export type LumiColorMode = 'rainbow' | 'single' | 'piano' | 'night';
const COLOR_MODES: Record<LumiColorMode, number> = { rainbow: 0, single: 1, piano: 2, night: 3 };

export function colorModeCommand(mode: LumiColorMode): number[] {
  return new BitPacker().append(0x10, 7).append(0x40, 7).append(0b00010, 5).append(COLOR_MODES[mode], 2).bytes();
}

/** Nearest palette index (1..127) for an RGB colour. Uses the "redmean" colour distance. */
export function nearestPaletteVelocity(rgb: RGB): number {
  const [r, g, b] = rgb;
  let best = 127;
  let bestD = Infinity;
  for (let i = 1; i < LUMI_PALETTE.length; i++) {
    const c = LUMI_PALETTE[i];
    const pr = (c >> 16) & 0xff;
    const pg = (c >> 8) & 0xff;
    const pb = c & 0xff;
    const rm = (r + pr) / 2;
    const d = (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The nearest colour a LUMI key can show, as #rrggbb. Use it for on-screen colours so they match the keys. */
export function snapToLumi(hex: string): string {
  return '#' + paletteRgb(nearestPaletteVelocity(hexToRgb(hex))).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function paletteRgb(velocity: number): RGB {
  const c = LUMI_PALETTE[Math.max(0, Math.min(127, velocity))];
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
}

export type LumiMode = 'app' | LumiColorMode;

export class LumiLights {
  /** note -> [velocity, brightness] currently shown, so we only send changes. */
  private lit = new Map<number, [number, number]>();
  channel = 0;

  constructor(
    private out: MidiOut,
    readonly sysexAllowed: boolean,
    readonly deviceId: number = LUMI_DEVICE_ID,
  ) {}

  /**
   * Light one key. `rgb` is matched to the nearest colour the LUMI can show.
   * @param brightness 0..1 (sent as poly aftertouch)
   */
  setKeyColor(note: number, rgb: RGB, brightness = 1): void {
    this.setKeyVelocity(note, nearestPaletteVelocity(rgb), brightness);
  }

  setKeyVelocity(note: number, velocity: number, brightness = 1): void {
    if (note < 0 || note > 127) return;
    const vel = Math.max(1, Math.min(127, Math.round(velocity)));
    const bri = Math.max(0, Math.min(127, Math.round(brightness * 127)));
    const prev = this.lit.get(note);
    if (prev && prev[0] === vel && prev[1] === bri) return;
    if (!prev || prev[1] !== bri) this.out.send([0xa0 | this.channel, note, bri]);
    if (!prev || prev[0] !== vel) this.out.send([0x90 | this.channel, note, vel]);
    this.lit.set(note, [vel, bri]);
  }

  clearKey(note: number): void {
    if (!this.lit.has(note)) return;
    this.out.send([0x80 | this.channel, note, 0]);
    this.lit.delete(note);
  }

  /** Turn every app-controlled light off. `sweep` also clears keys we don't know are lit. */
  clearAll(sweep = false): void {
    const notes = sweep ? Array.from({ length: 128 }, (_, i) => i) : [...this.lit.keys()];
    for (const n of notes) {
      this.out.send([0x80 | this.channel, n, 0]);
      this.out.send([0xa0 | this.channel, n, 127]); // restore full brightness
    }
    this.lit.clear();
  }

  /**
   * Send every lit key again. The LUMI can drop or misplace lights (e.g. right after an
   * octave change, or over a busy Bluetooth link), and we can't read its state back.
   */
  resendAll(): void {
    for (const [note, [vel, bri]] of this.lit) {
      this.out.send([0xa0 | this.channel, note, bri]);
      this.out.send([0x90 | this.channel, note, vel]);
    }
  }

  litNotes(): number[] {
    return [...this.lit.keys()];
  }

  /**
   * 'app'  – blank the LUMI's own key colours so only app lights show (needs SysEx).
   * others – the LUMI's built-in colour modes; 'rainbow' is the factory default.
   * Returns false if SysEx isn't available.
   */
  setMode(mode: LumiMode): boolean {
    if (!this.sysexAllowed) return false;
    try {
      if (mode === 'app') {
        this.sendSysex(colorModeCommand('single'));
        this.sendSysex(colorCommand(0, [0, 0, 0]));
        this.sendSysex(colorCommand(1, [0, 0, 0]));
      } else {
        this.sendSysex(colorModeCommand(mode));
        if (mode === 'single') {
          this.sendSysex(colorCommand(0, [0, 80, 255]));
          this.sendSysex(colorCommand(1, [255, 255, 255]));
        }
      }
      return true;
    } catch (e) {
      console.warn('LUMI SysEx failed', e);
      return false;
    }
  }

  setGlobalColor(slot: 0 | 1, rgb: RGB): boolean {
    if (!this.sysexAllowed) return false;
    this.sendSysex(colorCommand(slot, rgb));
    return true;
  }

  /** Move the LUMI's keys to an octave (like pressing its octave buttons). */
  setOctave(octave: number): boolean {
    if (!this.sysexAllowed) return false;
    this.clearAll(); // lit keys belong to the old position
    this.sendSysex(octaveCommand(octave));
    return true;
  }

  setBrightness(percent: number): boolean {
    if (!this.sysexAllowed) return false;
    this.sendSysex(brightnessCommand(percent));
    return true;
  }

  private sendSysex(command: number[]) {
    this.out.send(buildSysex(command, this.deviceId));
  }
}

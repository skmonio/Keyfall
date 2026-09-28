import type { LightRole, LightsSink } from '../engine/session';
import type { Hand } from '../model/song';
import { hexToRgb, LumiLights, nearestPaletteVelocity } from './lumiLights';

const WHITE = 127; // last palette entry is white
const HIT_FLASH_MS = 160;
const WRONG_FLASH_MS = 320;
/** Resend all lights this often, to heal anything the LUMI dropped. */
const RESYNC_MS = 1500;

/**
 * Turns the game's "which keys should be lit" into LumiLights calls.
 * The note to play now glows in the hand's "now" colour, the one after it in the hand's "next"
 * colour; a correct hit flashes white, a wrong key flashes red.
 * Only changes are sent, so the MIDI link isn't flooded.
 */
export class LightsDirector implements LightsSink {
  private nowVel: Record<Hand, number>;
  private nextVel: Record<Hand, number>;
  private redVel = nearestPaletteVelocity([255, 0, 0]);
  private flashes = new Map<number, { vel: number; until: number }>();
  private targets = new Map<number, { hand: Hand; role: LightRole }>();
  private lastResync = 0;

  constructor(
    private lights: LumiLights | undefined,
    colors: Record<Hand, string>,
    nextColors: Record<Hand, string> = colors,
    private now: () => number = () => performance.now(),
  ) {
    const vel = (c: Record<Hand, string>) => ({ L: nearestPaletteVelocity(hexToRgb(c.L)), R: nearestPaletteVelocity(hexToRgb(c.R)) });
    this.nowVel = vel(colors);
    this.nextVel = vel(nextColors);
  }

  /** Switch to another LUMI connection (after it reconnects) and light it up from scratch. */
  setLights(lights: LumiLights | undefined): void {
    this.lights = lights;
    lights?.clearAll();
    this.lastResync = 0;
    this.render();
  }

  setTargets(targets: Map<number, { hand: Hand; role: LightRole }>): void {
    this.targets = targets;
    this.render();
  }

  flash(pitch: number, kind: 'hit' | 'wrong'): void {
    this.flashes.set(pitch, {
      vel: kind === 'hit' ? WHITE : this.redVel,
      until: this.now() + (kind === 'hit' ? HIT_FLASH_MS : WRONG_FLASH_MS),
    });
    this.render();
  }

  private render() {
    if (!this.lights) return;
    const t = this.now();
    const want = new Map<number, [number, number]>();
    for (const [pitch, { hand, role }] of this.targets) {
      // "Next" uses its own colour rather than dimming, because not every LUMI dims single keys.
      want.set(pitch, role === 'now' ? [this.nowVel[hand], 1] : [this.nextVel[hand], 0.5]);
    }
    for (const [pitch, f] of this.flashes) {
      if (f.until < t) this.flashes.delete(pitch);
      else want.set(pitch, [f.vel, 1]);
    }
    for (const n of this.lights.litNotes()) if (!want.has(n)) this.lights.clearKey(n);
    for (const [n, [vel, bri]] of want) this.lights.setKeyVelocity(n, vel, bri);
    if (t - this.lastResync > RESYNC_MS) this.resync();
  }

  /** Send all current lights again (after an octave change, and periodically). */
  resync() {
    this.lastResync = this.now();
    this.lights?.resendAll();
  }

  clear() {
    this.targets.clear();
    this.flashes.clear();
    this.lights?.clearAll();
  }
}

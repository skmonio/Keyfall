import { isBlack } from '../model/song';

export interface KeyRect {
  pitch: number;
  x: number;
  w: number;
  black: boolean;
}

export interface KeyboardLayout {
  lo: number;
  hi: number;
  keys: Map<number, KeyRect>;
  whiteWidth: number;
  width: number;
}

export const PIANO_LO = 21; // A0
export const PIANO_HI = 108; // C8

/**
 * Choose which keys to show: the song's range plus a little margin, at least `minKeys`
 * wide (a LUMI is 24 keys), always starting and ending on white keys.
 */
export function visibleRange(songLo: number, songHi: number, minKeys = 24): [number, number] {
  let lo = Math.max(PIANO_LO, songLo - 2);
  let hi = Math.min(PIANO_HI, songHi + 2);
  while (hi - lo + 1 < minKeys) {
    if (lo > PIANO_LO) lo--;
    if (hi - lo + 1 < minKeys && hi < PIANO_HI) hi++;
    if (lo === PIANO_LO && hi === PIANO_HI) break;
  }
  while (isBlack(lo) && lo > PIANO_LO) lo--;
  while (isBlack(hi) && hi < PIANO_HI) hi++;
  return [lo, hi];
}

export function layoutKeyboard(lo: number, hi: number, width: number): KeyboardLayout {
  let whites = 0;
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites++;
  const ww = width / Math.max(1, whites);
  const bw = ww * 0.62;
  const keys = new Map<number, KeyRect>();
  let wi = 0;
  for (let p = lo; p <= hi; p++) {
    if (isBlack(p)) {
      keys.set(p, { pitch: p, x: wi * ww - bw / 2, w: bw, black: true });
    } else {
      keys.set(p, { pitch: p, x: wi * ww, w: ww, black: false });
      wi++;
    }
  }
  return { lo, hi, keys, whiteWidth: ww, width };
}

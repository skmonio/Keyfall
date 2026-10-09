import { estimateFingering } from '../model/fingering';
import { applyFit, planFit, resolveKeyboard, type FitPlan, type KeyboardSpec } from '../model/fit';
import type { Song } from '../model/song';
import { activeHands, type AppSettings } from '../engine/settings';
import { songHands, usableHands } from './help';

export interface FitResult {
  spec: KeyboardSpec;
  plan: FitPlan;
  /** The song as it will be played (moved notes, if fitting is on and needed). */
  song: Song;
  /** Whether the on-screen keyboard should show exactly the physical keyboard. */
  lockView: boolean;
}

/** Can the app move the LUMI itself? Only once we've seen its octave command work. */
export function lumiCanMove(settings: AppSettings, sysex: boolean): boolean {
  return sysex && settings.lumiAutoOctave && settings.lumiOctaveWorks === true;
}

export function computeFit(song: Song, settings: AppSettings, lumiConnected: boolean, canMoveLumi = false): FitResult {
  const spec = resolveKeyboard(settings.keyboard, lumiConnected);
  // A hand the song doesn't have falls back to the one it does (as in the play screen).
  const hands = activeHands(usableHands(settings.play.hands, songHands(song)));
  const songPos = settings.play.keyboardPos?.songId === song.id ? settings.play.keyboardPos.lo : undefined;
  // If the app can't move the LUMI, fit the song to wherever the LUMI is.
  const pos = songPos ?? (spec.lumi && !canMoveLumi && settings.lumiBase !== undefined ? settings.lumiBase : undefined);
  const plan = planFit(song.notes, hands, spec, pos);
  const lockView = spec.keys < 88;
  if (!lockView || plan.fitsAsWritten || !settings.play.fitToKeyboard) return { spec, plan, song, lockView };
  const fitted = applyFit(song, plan, hands);
  estimateFingering(fitted.notes);
  return { spec, plan, song: fitted, lockView };
}

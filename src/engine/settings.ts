import { DEFAULT_WINDOWS, type TimingWindows } from './judge';
import type { Hand } from '../model/song';
import type { KeyboardKind } from '../model/fit';

/** wait: the music waits for each chord · performance: it keeps going and you're scored ·
 *  free: it keeps going and nothing is judged, you just play along. */
export type GameMode = 'wait' | 'performance' | 'free';
export type HandsMode = 'both' | 'left' | 'right';
/**
 * full      – the whole song: the other hand at full volume, your own part quietly as a guide
 * mine      – "My hand": just your hand's part, quietly as a guide
 * metronome – "Metro": clicks
 * silent    – nothing from the song ("I play")
 * Your own key presses always sound too, unless "Play my keys" is switched off in Settings.
 * silent    – no sound at all (use if your keyboard makes its own sound)
 */
export type AudioMode = 'full' | 'mine' | 'metronome' | 'silent';

export interface PlaySettings {
  mode: GameMode;
  hands: HandsMode;
  autoPlayOtherHand: boolean;
  speed: number; // 0.25 .. 1.5
  audio: AudioMode;
  /** Bars to practise (0-based, inclusive). null = the whole song. */
  section: { fromMeasure: number; toMeasure: number } | null;
  /** The song the section belongs to; a section never carries over to another song. */
  sectionSongId?: string;
  /** Repeat the section (or the whole song) A to B. */
  loop: boolean;
  /** When looping, speed up 5% after each clean pass (max 150%). */
  speedUpOnClean: boolean;
  windows: TimingWindows;
  /** Seconds of notes visible above the hit line at 100% speed. */
  lookAheadSec: number;
  showFingers: boolean;
  countIn: boolean;
  /** For songs imported from a recording: play the original recording as the backing track (Performance mode). */
  useRecording: boolean;
  /** Show note names (C, D, E♭ …) on the keys, the falling notes and the sheet music. */
  showNoteNames: boolean;
  /** Show the note after the one to play now (faded on screen, its own colour on the LUMI). */
  showNextNotes: boolean;
  /** Play your own part quietly as a guide (Full and "My hand" sound), so you hear what to play next. */
  hearMyNotes: boolean;
  /** Free play: the music moves along by itself. Off: it stays put and you move it by hand. */
  freeAutoScroll: boolean;
  /** Free play: highlight the notes to play (sheet, keyboard, LUMI). */
  freeShowNotes: boolean;
  /** Practice view: falling notes, or reading from sheet music. */
  view: 'falling' | 'sheet';
  sheet: {
    layout: 'scroll' | 'lines' | 'page';
    zoom: number;
    /** Show which keys to press (on-screen keyboard and LUMI lights). Off = pure reading practice. */
    keyHints: boolean;
    /** Show the falling notes under the sheet as well. */
    showFalling: boolean;
  };
  /** Move hands/notes so the song fits your keyboard when it's too small. */
  fitToKeyboard: boolean;
  /** Manual keyboard position (lowest key) for one song; otherwise it's chosen automatically. */
  keyboardPos?: { songId: string; lo: number; source?: 'manual' | 'detected' };
}

export interface AppSettings {
  /** Bumped when a default changes in a way saved settings should pick up. */
  settingsVersion?: number;
  play: PlaySettings;
  /** Per-hand colour for "play this now" (keyboard, sheet, falling notes and LUMI). */
  colors: Record<Hand, string>;
  /** Per-hand colour for "the note after that". */
  nextColors: Record<Hand, string>;
  lumiEnabled: boolean;
  /** While playing, blank the LUMI's own key colours (SysEx) so only the app's lights show. */
  lumiAppMode: boolean;
  /** LUMI colour mode to put back when leaving the game. */
  lumiRestoreMode: 'rainbow' | 'single' | 'piano' | 'night';
  preferredInputId?: string;
  /** Your key presses make sound through the app (switch off if your keyboard has its own speakers). */
  keySound: boolean;
  /** Sound for your keys and the backing track (see audio/instruments.ts). */
  instrument: string;
  /** Short chimes for combo milestones, passed steps and new best scores. */
  gameSounds: boolean;
  /** Your keyboard's size. 'auto' = LUMI (24 keys) if one is connected, otherwise 88. */
  keyboard: KeyboardKind;
  /** The LUMI's lowest key, as last found (from "Find my LUMI" or the keys you press). */
  lumiBase?: number;
  /** Whether this LUMI obeys the octave command (checked once; undefined = not checked yet). */
  lumiOctaveWorks?: boolean;
  /** The LUMI's SysEx address, if the Lights check found one other than the usual 0x37. */
  lumiSysexId?: number;
  /** Set the LUMI's octave automatically (SysEx) so its keys cover the song. */
  lumiAutoOctave: boolean;
}

/** Latency calibration, stored per input device. */
export interface Calibration {
  deviceKey: string;
  /** Delay between a physical key press and its timestamp reaching us. Subtracted from presses. */
  inputLatencyMs: number;
  /** Delay between scheduling a sound and hearing it. Audio is scheduled this much earlier. */
  audioLatencyMs: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  play: {
    mode: 'wait',
    hands: 'both',
    autoPlayOtherHand: false,
    speed: 1,
    audio: 'full',
    section: null,
    loop: false,
    speedUpOnClean: false,
    windows: { ...DEFAULT_WINDOWS },
    lookAheadSec: 3,
    showFingers: true,
    countIn: true,
    fitToKeyboard: true,
    useRecording: true,
    showNextNotes: false,
    hearMyNotes: true,
    freeAutoScroll: false,
    freeShowNotes: false,
    showNoteNames: true,
    view: 'falling',
    sheet: { layout: 'scroll', zoom: 1, keyHints: true, showFalling: false },
  },
  // All four are entries from the LUMI's palette, so the screen and the keys match exactly.
  colors: { R: '#5877fd', L: '#ff8547' },
  nextColors: { R: '#29c6ea', L: '#ffd029' },
  lumiEnabled: true,
  lumiAppMode: true,
  lumiRestoreMode: 'rainbow',
  settingsVersion: 4,
  keySound: true,
  instrument: 'piano',
  gameSounds: true,
  keyboard: 'auto',
  lumiAutoOctave: true,
};

/** The section to practise for this song (null = whole song). */
export function sectionFor(play: PlaySettings, songId: string, measureCount: number): PlaySettings['section'] {
  const s = play.section;
  if (!s || play.sectionSongId !== songId || s.toMeasure >= measureCount) return null;
  return s;
}

export function activeHands(h: HandsMode): Set<Hand> {
  return new Set<Hand>(h === 'both' ? ['L', 'R'] : h === 'left' ? ['L'] : ['R']);
}

/** Hover help for the practice controls, shared by the setup screen and the play toolbar. */
import type { AudioMode, GameMode, HandsMode } from '../engine/settings';
import type { Song } from '../model/song';

export const MODE_HELP: Record<GameMode | 'listen', string> = {
  wait: 'Practice (Wait): the music stops at each note or chord until you play it. Scored.',
  performance: 'Perform: the music keeps going at the set speed, so play in time. Scored, with a results screen.',
  free: 'Free play: just the music and you, nothing is judged. It only moves if you turn on Auto-scroll (or play the shown notes when "Show notes to play" is on).',
  listen: 'Listen: hear the section played for you, with the notes shown.',
};

export const HANDS_HELP: Record<HandsMode, string> = {
  left: 'Play the left-hand part only',
  both: 'Play both hands',
  right: 'Play the right-hand part only',
};

export const SOUND_HELP: Record<AudioMode, string> = {
  full: 'Full: the whole song plays: the other hand, any backing parts, and (with "Hear my notes") your own part quietly as a guide.',
  mine: 'My hand: only your own part plays, quietly, as a guide to what comes next. Turn off "Hear my notes" for no guide.',
  metronome: 'Metro: metronome clicks only, nothing from the song.',
  silent: 'Silent: nothing from the song and no clicks: you hear only the keys you press.',
};

export const HEAR_MY_NOTES_HELP =
  'Hear my notes: your own part is played quietly as each note comes up, so you hear what to play next. This is only the guide: unlike Silent, the other hand and backing still play in Full.';
export const HEAR_MY_NOTES_OFF_HELP = 'No effect with Metro or Silent: they never play your part anyway.';

export const SPEED_HELP = 'How fast the music goes (100% = the written tempo). Free play with auto-scroll can go from 1% to 100%.';

/** Which hands this song has notes for (backing parts don't count). */
export function songHands(song: Pick<Song, 'notes'>): { L: boolean; R: boolean } {
  let L = false;
  let R = false;
  for (const n of song.notes) {
    if (n.backing) continue;
    if (n.hand === 'L') L = true;
    else R = true;
    if (L && R) break;
  }
  return { L, R };
}

/** The hands setting to use for this song: a hand it doesn't have falls back to the one it does. */
export function usableHands(h: HandsMode, has: { L: boolean; R: boolean }): HandsMode {
  if (has.L && has.R) return h;
  if (has.R) return 'right';
  if (has.L) return 'left';
  return h;
}

/** Hand buttons with hover help, disabled where the song has no such part. */
export function handOptions(has: { L: boolean; R: boolean }): [HandsMode, string, { title: string; disabled: boolean }][] {
  const missing = !has.L ? 'This song has no left-hand part' : !has.R ? 'This song has no right-hand part' : '';
  return [
    ['left', 'Left', { title: has.L ? HANDS_HELP.left : 'This song has no left-hand part', disabled: !has.L }],
    ['both', 'Both', { title: has.L && has.R ? HANDS_HELP.both : missing, disabled: !(has.L && has.R) }],
    ['right', 'Right', { title: has.R ? HANDS_HELP.right : 'This song has no right-hand part', disabled: !has.R }],
  ];
}

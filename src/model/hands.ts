import type { Hand, Note, Song } from './song';

/** Default rule: staff 1 (treble) = right hand, staff 2+ (bass) = left hand. */
export function handForStaff(staff: number): Hand {
  return staff <= 1 ? 'R' : 'L';
}

export function toggleNoteHand(song: Song, noteId: number): void {
  const n = song.notes.find((x) => x.id === noteId);
  if (n) {
    n.hand = n.hand === 'L' ? 'R' : 'L';
    n.finger = undefined;
    n.fingerSource = undefined;
  }
}

/** Override the hand for every note in measures [fromMeasure, toMeasure] (0-based, inclusive). */
export function setHandForMeasures(song: Song, fromMeasure: number, toMeasure: number, hand: Hand): number {
  let changed = 0;
  for (const n of song.notes) {
    if (!n.backing && n.measure >= fromMeasure && n.measure <= toMeasure && n.hand !== hand) {
      n.hand = hand;
      n.finger = undefined;
      n.fingerSource = undefined;
      changed++;
    }
  }
  return changed;
}

/** Assign by split point: pitch >= split goes to the right hand. */
export function splitHandsAt(notes: Note[], split: number, fromMeasure = 0, toMeasure = Infinity): void {
  for (const n of notes) {
    if (n.backing || n.measure < fromMeasure || n.measure > toMeasure) continue;
    const h: Hand = n.pitch >= split ? 'R' : 'L';
    if (h !== n.hand) {
      n.hand = h;
      if (n.fingerSource !== 'score') {
        n.finger = undefined;
        n.fingerSource = undefined;
      }
    }
  }
}

/** Restore staff-based assignment where staff info exists. */
export function resetHandsByStaff(notes: Note[]): void {
  for (const n of notes) if (n.staff !== undefined) n.hand = handForStaff(n.staff);
}

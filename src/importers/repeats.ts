/**
 * Work out the order bars are played in, from a score's repeat signs, voltas (1st/2nd-time
 * endings) and jumps (D.C., D.S., Fine, To Coda).
 *
 * Conventions followed:
 *  - A backward repeat without a matching forward repeat goes back to the start of the
 *    piece, or to just after the previous repeat section.
 *  - `times` on a backward repeat means the section is played that many times (default 2).
 *  - Voltas: a bar in ending "1" is played on pass 1, "2" on pass 2, "1, 2" on both, etc.
 *  - After a D.C. or D.S., repeats are not taken again (the usual "senza ripetizione"),
 *    and in voltas the last ending is played. "Fine" stops there; "To Coda" jumps to the coda.
 */
export interface BarRepeatInfo {
  /** Forward repeat barline at the start of this bar. */
  forward?: boolean;
  /** Backward repeat barline at the end of this bar: how many times the section is played. */
  backward?: number;
  /** Volta numbers this bar belongs to (e.g. [1] or [1, 2]). */
  ending?: number[];
  segno?: string;
  coda?: string;
  /** Jump back to the start at the end of this bar. */
  dacapo?: boolean;
  /** Jump back to this segno at the end of this bar. */
  dalsegno?: string;
  /** After a D.C./D.S., stop at the end of this bar. */
  fine?: boolean;
  /** After a D.C./D.S., jump to this coda at the end of this bar. */
  tocoda?: string;
}

export function hasRepeats(info: BarRepeatInfo[]): boolean {
  return info.some((b) => b.backward || b.ending || b.dacapo || b.dalsegno);
}

export function playbackOrder(info: BarRepeatInfo[]): number[] {
  const n = info.length;
  if (!hasRepeats(info)) return info.map((_, i) => i);

  // The highest volta number in each run of consecutive ending bars (used after a jump).
  const lastEnding = new Array<number>(n).fill(0);
  for (let i = 0; i < n; ) {
    if (!info[i].ending) {
      i++;
      continue;
    }
    let j = i;
    let max = 0;
    while (j < n && info[j].ending) max = Math.max(max, ...info[j++].ending!);
    for (let k = i; k < j; k++) lastEnding[k] = max;
    i = j;
  }
  const findMark = (key: 'segno' | 'coda', name: string) => {
    const exact = info.findIndex((b) => b[key] === name);
    return exact >= 0 ? exact : info.findIndex((b) => b[key] !== undefined);
  };

  const order: number[] = [];
  const taken = new Map<number, number>();
  let i = 0;
  let repeatStart = 0;
  let pass = 1;
  let jumped = false; // a D.C./D.S. has happened
  let viaRepeat = false; // we arrived at this bar by jumping back for a repeat
  let prevHadEnding = false;
  let guard = 0;

  while (i < n && guard++ < 20000) {
    const bar = info[i];
    const arrivedViaRepeat = viaRepeat;
    viaRepeat = false;
    if (bar.forward && !arrivedViaRepeat) {
      repeatStart = i;
      pass = 1;
    }

    if (bar.ending) {
      const include = jumped ? bar.ending.includes(lastEnding[i]) : bar.ending.includes(pass);
      if (!include) {
        i++;
        prevHadEnding = true;
        continue;
      }
    } else if (prevHadEnding && !arrivedViaRepeat) {
      // Leaving the voltas: what follows is a new section.
      repeatStart = i;
      pass = 1;
    }
    prevHadEnding = !!bar.ending;
    order.push(i);

    if (bar.backward && !jumped) {
      const t = taken.get(i) ?? 0;
      if (t < bar.backward - 1) {
        taken.set(i, t + 1);
        pass++;
        i = repeatStart;
        viaRepeat = true;
        prevHadEnding = false;
        continue;
      }
      if (!bar.ending) {
        // Section done (no voltas): the next section starts after it.
        repeatStart = i + 1;
        pass = 1;
      }
    }
    if (jumped && bar.fine) break;
    if (jumped && bar.tocoda) {
      const c = findMark('coda', bar.tocoda);
      if (c > i) {
        i = c;
        continue;
      }
    }
    if (!jumped && bar.dacapo) {
      jumped = true;
      i = 0;
      pass = 1;
      repeatStart = 0;
      continue;
    }
    if (!jumped && bar.dalsegno) {
      const sg = findMark('segno', bar.dalsegno);
      if (sg >= 0) {
        jumped = true;
        i = sg;
        pass = 1;
        repeatStart = sg;
        continue;
      }
    }
    i++;
  }
  return order;
}

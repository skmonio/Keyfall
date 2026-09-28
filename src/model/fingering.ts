/**
 * Fingering estimation.
 *
 * In the spirit of `pianoplayer` (Marco Musy): model the hand as five fingers over a
 * "hand position", and choose the finger sequence that minimises the total effort of
 * moving the hand. We run it as an exact dynamic program (Viterbi) over the note
 * events of one hand, where an event is a single note or a chord.
 *
 * Fingerings already present in the score are kept and constrain the search.
 */
import { isBlack, type Finger, type Hand, type Note } from './song';

const FINGERS: Finger[] = [1, 2, 3, 4, 5];

/** Semitone offset of each finger above the hand's lowest reach, in a relaxed five-finger position. */
const OFFSET: Record<Hand, Record<Finger, number>> = {
  R: { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7 },
  L: { 5: 0, 4: 2, 3: 4, 2: 5, 1: 7 },
};

interface Event {
  time: number;
  notes: Note[]; // sorted by pitch ascending
}

type State = Finger[]; // one finger per note in the event, same order as event.notes

function groupEvents(notes: Note[]): Event[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const events: Event[] = [];
  for (const n of sorted) {
    const last = events[events.length - 1];
    // Notes starting within 30ms are treated as one chord.
    if (last && Math.abs(n.start - last.time) < 0.03) last.notes.push(n);
    else events.push({ time: n.start, notes: [n] });
  }
  for (const e of events) {
    e.notes.sort((a, b) => a.pitch - b.pitch);
    // A hand only has five fingers; extra chord notes are left unfingered.
    if (e.notes.length > 5) e.notes = e.notes.slice(0, 5);
  }
  return events;
}

function combinations(k: number): Finger[][] {
  const out: Finger[][] = [];
  const rec = (start: number, acc: Finger[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < 5; i++) rec(i + 1, [...acc, FINGERS[i]]);
  };
  rec(0, []);
  return out;
}

/** Candidate fingerings for a chord: fingers increase with pitch in RH, decrease in LH. */
function candidates(ev: Event, hand: Hand): State[] {
  const combos = combinations(ev.notes.length);
  const states = combos.map((c) => (hand === 'R' ? c : [...c].reverse()));
  const fixed = ev.notes.map((n) => (n.fingerSource === 'score' ? n.finger : undefined));
  if (fixed.every((f) => f === undefined)) return states;
  const matching = states.filter((s) => s.every((f, i) => fixed[i] === undefined || fixed[i] === f));
  // If the score's fingering is unusual (e.g. crossing inside a chord), trust it as-is.
  if (matching.length) return matching;
  return [ev.notes.map((n, i) => (n.finger ?? states[0][i]) as Finger)];
}

function handPos(pitch: number, f: Finger, hand: Hand): number {
  return pitch - OFFSET[hand][f];
}

function stateCost(ev: Event, s: State, hand: Hand): number {
  let c = 0;
  const positions = s.map((f, i) => handPos(ev.notes[i].pitch, f, hand));
  // Stretching inside a chord.
  c += (Math.max(...positions) - Math.min(...positions)) * 0.8;
  ev.notes.forEach((n, i) => {
    const f = s[i];
    if (isBlack(n.pitch) && f === 1) c += 2;
    if (isBlack(n.pitch) && f === 5) c += 1;
    if (f === 4) c += 0.3;
    if (f === 5 && ev.notes.length === 1) c += 0.2;
  });
  return c;
}

function transitionCost(a: Event, sa: State, b: Event, sb: State, hand: Hand): number {
  const gap = Math.max(0.01, b.time - a.time);
  const posA = sa.reduce((m, f, i) => m + handPos(a.notes[i].pitch, f, hand), 0) / sa.length;
  const posB = sb.reduce((m, f, i) => m + handPos(b.notes[i].pitch, f, hand), 0) / sb.length;
  const speed = gap < 0.25 ? 1.6 : gap < 0.6 ? 1.0 : gap < 1.2 ? 0.6 : 0.3;
  let c = Math.abs(posB - posA) * speed;

  // Melodic step between single notes: check crossings and finger reuse.
  if (sa.length === 1 && sb.length === 1) {
    const pa = a.notes[0].pitch;
    const pb = b.notes[0].pitch;
    const fa = sa[0];
    const fb = sb[0];
    const up = pb > pa;
    // In RH, going up means finger numbers go up; in LH the reverse.
    const natural = hand === 'R' ? (up ? fb > fa : fb < fa) : up ? fb < fa : fb > fa;
    if (pa === pb) {
      c += fa === fb ? 0 : 0.8;
    } else if (fa === fb) {
      c += gap < 0.4 ? 6 : 3; // same finger on a different key
    } else if (!natural) {
      const thumbUnder = fb === 1 && fa !== 5; // thumb passes under 2/3/4
      const overThumb = fa === 1 && (fb === 3 || fb === 4 || fb === 2);
      const interval = Math.abs(pb - pa);
      if ((thumbUnder || overThumb) && interval <= 5) {
        c += 2 + (thumbUnder && isBlack(pb) ? 3 : 0);
        // Crossing makes the hand-position jump expected, so refund most of it.
        c -= Math.abs(posB - posA) * speed * 0.6;
      } else {
        c += 8;
      }
    }
  }
  return c;
}

/** Estimate fingers for one hand's notes. Mutates notes in place. */
export function estimateFingeringForHand(notes: Note[], hand: Hand): void {
  const events = groupEvents(notes);
  if (!events.length) return;
  const cands = events.map((e) => candidates(e, hand));
  // cost[i][j] = best total cost ending at event i in candidate j
  let prevCost = cands[0].map((s) => stateCost(events[0], s, hand));
  const back: number[][] = [cands[0].map(() => -1)];
  for (let i = 1; i < events.length; i++) {
    const cur: number[] = [];
    const bp: number[] = [];
    for (let j = 0; j < cands[i].length; j++) {
      const own = stateCost(events[i], cands[i][j], hand);
      let best = Infinity;
      let arg = 0;
      for (let k = 0; k < cands[i - 1].length; k++) {
        const v = prevCost[k] + transitionCost(events[i - 1], cands[i - 1][k], events[i], cands[i][j], hand);
        if (v < best) {
          best = v;
          arg = k;
        }
      }
      cur.push(best + own);
      bp.push(arg);
    }
    prevCost = cur;
    back.push(bp);
  }
  let j = prevCost.indexOf(Math.min(...prevCost));
  for (let i = events.length - 1; i >= 0; i--) {
    const s = cands[i][j];
    events[i].notes.forEach((n, idx) => {
      if (n.fingerSource !== 'score') {
        n.finger = s[idx];
        n.fingerSource = 'auto';
      }
    });
    j = back[i][j];
  }
}

/** Fill in fingering for every note without a score fingering. */
export function estimateFingering(notes: Note[]): void {
  for (const hand of ['L', 'R'] as Hand[]) {
    const own = notes.filter((n) => n.hand === hand && !n.backing);
    for (const n of own) {
      if (n.fingerSource === 'auto') {
        n.finger = undefined;
        n.fingerSource = undefined;
      }
    }
    estimateFingeringForHand(own, hand);
  }
}

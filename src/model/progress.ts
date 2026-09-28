/** Progress calculations: which bars of a song need work. */
import type { SessionResults } from '../engine/session';

export interface BarHeat {
  bar: number;
  notes: number;
  errors: number;
  /** errors per note, 0..1+ */
  rate: number;
  runs: number;
}

/** Error rate per printed bar over the most recent runs of a song. */
export function barHeat(results: SessionResults[], lastRuns = 10): BarHeat[] {
  const recent = [...results].filter((r) => r.barStats?.length).sort((a, b) => b.date - a.date).slice(0, lastRuns);
  const byBar = new Map<number, BarHeat>();
  for (const r of recent) {
    for (const b of r.barStats!) {
      const h = byBar.get(b.bar) ?? { bar: b.bar, notes: 0, errors: 0, rate: 0, runs: 0 };
      h.notes += b.notes;
      h.errors += b.errors;
      h.runs++;
      byBar.set(b.bar, h);
    }
  }
  for (const h of byBar.values()) h.rate = h.notes ? h.errors / h.notes : 0;
  return [...byBar.values()].sort((a, b) => a.bar - b.bar);
}

export function formatMinutes(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

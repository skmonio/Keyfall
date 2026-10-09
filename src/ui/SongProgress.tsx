import type { SessionResults } from '../engine/session';
import { barHeat, formatMinutes } from '../model/progress';
import { BarHeatStrip, LineChart } from './charts';

const MODE = { wait: 'Wait', performance: 'Performance', free: 'Free play' } as const;
const HANDS = { both: 'both hands', left: 'left hand', right: 'right hand' } as const;

/** Progress for one song: accuracy over time, and which bars need work. */
export function SongProgress({ results, onPracticeBar }: { results: SessionResults[]; onPracticeBar: (bar: number) => void }) {
  const runs = [...results].sort((a, b) => a.date - b.date);
  if (!runs.length) {
    return <div className="muted small">No runs yet. Your accuracy over time and your trickiest bars will show here.</div>;
  }
  const recent = runs.slice(-30);
  const best = Math.max(...runs.map((r) => r.accuracy));
  const time = runs.reduce((s, r) => s + (r.playedSec ?? 0), 0);
  const last = runs[runs.length - 1];
  const firstAcc = recent[0].accuracy;
  const trend = recent.length >= 3 ? last.accuracy - firstAcc : 0;
  const heat = barHeat(runs, 10);
  return (
    <div className="col">
      <div className="tiles">
        <div className="tile">
          <div className="v">{runs.length}</div>
          <div className="k">runs</div>
        </div>
        <div className="tile">
          <div className="v">{Math.round(best * 100)}%</div>
          <div className="k">best accuracy</div>
        </div>
        <div className="tile">
          <div className="v">{Math.round(last.accuracy * 100)}%</div>
          <div className="k">last run{trend ? ` (${trend > 0 ? '▲' : '▼'} ${Math.abs(Math.round(trend * 100))} pts over ${recent.length} runs)` : ''}</div>
        </div>
        <div className="tile">
          <div className="v">{formatMinutes(time)}</div>
          <div className="k">practised</div>
        </div>
      </div>
      <div className="small muted">Accuracy per run{runs.length > 30 ? ' (last 30)' : ''}</div>
      <LineChart
        label="Accuracy per run"
        points={recent.map((r) => ({
          x: r.date,
          y: r.accuracy * 100,
          tip: [
            new Date(r.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
            `${Math.round(r.accuracy * 100)}% accuracy · ${r.score.toLocaleString()} points`,
            `${MODE[r.mode]} · ${HANDS[r.hands]} · ${Math.round(r.speed * 100)}% speed`,
          ],
        }))}
      />
      <div className="small muted">Bars that need work (last {Math.min(10, runs.filter((r) => r.barStats?.length).length) || 10} runs)</div>
      <BarHeatStrip cells={heat} onPick={onPracticeBar} />
    </div>
  );
}

/**
 * Small, dependency-free SVG charts for the progress views.
 * Colours come from the data-viz reference palette (dark mode): one series each, so the
 * title names it and no legend box is needed. Every chart has a hover tooltip.
 */
import { useRef, useState } from 'react';

const SERIES = '#3987e5'; // series 1, dark mode
const GRID = 'rgba(255,255,255,0.08)';
const AXIS_TEXT = '#9ca3af';
// Sequential blue ramp (dark surface: low = recedes toward the surface, high = bright)
const RAMP = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#b7d3f6'];

export function rampColor(v: number): string {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1))));
  return RAMP[i];
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

function Tooltip({ tip, width }: { tip?: Tip; width?: number }) {
  if (!tip) return null;
  // Keep the tooltip inside the chart: anchor it left/right near the edges.
  const w = width ?? Infinity;
  const shift = tip.x < 110 ? '0%' : tip.x > w - 110 ? '-100%' : '-50%';
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y, transform: `translate(${shift}, calc(-100% - 10px))` }}>
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'chart-tip-title' : ''}>
          {l}
        </div>
      ))}
    </div>
  );
}

/** A line over time (e.g. accuracy per run), with a crosshair and tooltip. Values 0..max. */
export function LineChart({
  points,
  max = 100,
  unit = '%',
  height = 160,
  label,
}: {
  points: { x: number; y: number; tip: string[] }[];
  max?: number;
  unit?: string;
  height?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number>();
  const W = 600;
  const H = height;
  const pad = { l: 34, r: 12, t: 10, b: 18 };
  if (points.length === 0) return <div className="muted small">No runs yet.</div>;
  const xs = (i: number) => (points.length === 1 ? (W + pad.l - pad.r) / 2 : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r));
  const ys = (v: number) => pad.t + (1 - Math.min(max, Math.max(0, v)) / max) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.y).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(xs(i) - fx) < Math.abs(xs(best) - fx)) best = i;
    setHover(best);
  };
  const tip: Tip | undefined =
    hover !== undefined && ref.current
      ? {
          x: (xs(hover) / W) * ref.current.clientWidth,
          y: (ys(points[hover].y) / H) * ref.current.clientHeight,
          lines: points[hover].tip,
        }
      : undefined;
  return (
    <div ref={ref} className="chart" onMouseMove={onMove} onMouseLeave={() => setHover(undefined)} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={pad.l - 6} y={ys(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
              {Math.round(t)}
              {unit}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== undefined && <line x1={xs(hover)} x2={xs(hover)} y1={pad.t} y2={H - pad.b} stroke="rgba(255,255,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Markers as HTML so they stay round when the SVG stretches */}
      {points.map((p, i) => (
        <span
          key={i}
          className={`chart-dot ${hover === i ? 'on' : ''}`}
          style={{ left: `${(xs(i) / W) * 100}%`, top: `${(ys(p.y) / H) * 100}%`, background: SERIES }}
        />
      ))}
      <Tooltip tip={tip} width={ref.current?.clientWidth} />
    </div>
  );
}

/** One cell per bar of music, coloured by error rate (sequential blue). Click to practise it. */
export function BarHeatStrip({
  cells,
  onPick,
}: {
  cells: { bar: number; rate: number; notes: number; errors: number; runs: number }[];
  onPick?: (bar: number) => void;
}) {
  const [hover, setHover] = useState<number>();
  const ref = useRef<HTMLDivElement>(null);
  if (!cells.length) return <div className="muted small">Play the song once to see which bars need work.</div>;
  const maxRate = Math.max(0.25, ...cells.map((c) => c.rate));
  return (
    <div ref={ref} className="chart">
      <div className="heat">
        {cells.map((c, i) => (
          <button
            key={c.bar}
            className="heat-cell"
            style={{
              background: c.errors === 0 ? 'var(--panel-2)' : rampColor(c.rate / maxRate),
              // Text wears text colours: dark on the light end of the ramp, light elsewhere.
              color: c.errors > 0 && c.rate / maxRate > 0.6 ? '#0b0f19' : '#e5e7eb',
            }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(undefined)}
            onClick={() => onPick?.(c.bar)}
            aria-label={`Bar ${c.bar}: ${c.errors} errors in ${c.notes} notes`}
          >
            <span>{c.bar}</span>
          </button>
        ))}
      </div>
      <div className="heat-legend small muted">
        <span>Clean</span>
        <span className="heat-ramp" style={{ background: `linear-gradient(90deg, var(--panel-2), ${RAMP[0]}, ${RAMP[RAMP.length - 1]})` }} />
        <span>Most errors</span>
      </div>
      {hover !== undefined && ref.current && (
        <Tooltip
          width={ref.current.clientWidth}
          tip={{
            x: (ref.current.querySelectorAll('.heat-cell')[hover] as HTMLElement).offsetLeft + 14,
            y: (ref.current.querySelectorAll('.heat-cell')[hover] as HTMLElement).offsetTop,
            lines: [
              `Bar ${cells[hover].bar}`,
              `${cells[hover].errors} error${cells[hover].errors === 1 ? '' : 's'} in ${cells[hover].notes} notes (${Math.round(cells[hover].rate * 100)}%)`,
              `over the last ${cells[hover].runs} run${cells[hover].runs === 1 ? '' : 's'}`,
              onPick ? 'Click to practise this bar' : '',
            ].filter(Boolean),
          }}
        />
      )}
    </div>
  );
}

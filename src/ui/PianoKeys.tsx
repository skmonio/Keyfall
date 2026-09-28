import { isBlack, pitchName } from '../model/song';

/** A clickable on-screen keyboard with coloured keys (used by the games). */
export function PianoKeys({
  lo,
  hi,
  colors,
  onPress,
  height = 120,
}: {
  lo: number;
  hi: number;
  colors: Map<number, string>;
  onPress?: (pitch: number) => void;
  height?: number;
}) {
  const whites: number[] = [];
  for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
  const ww = 100 / whites.length;
  const xOf = (p: number) => whites.indexOf(p) * ww;
  return (
    <div className="piano-keys" style={{ height }}>
      {whites.map((p) => (
        <button
          key={p}
          className="pk white"
          style={{ left: `${xOf(p)}%`, width: `${ww}%`, background: colors.get(p) }}
          onPointerDown={() => onPress?.(p)}
          aria-label={pitchName(p)}
        >
          {p % 12 === 0 && <span>{pitchName(p)}</span>}
        </button>
      ))}
      {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
        .filter((p) => isBlack(p) && p > lo)
        .map((p) => (
          <button
            key={p}
            className="pk black"
            style={{ left: `${xOf(p - 1) + ww * 0.68}%`, width: `${ww * 0.64}%`, background: colors.get(p) }}
            onPointerDown={() => onPress?.(p)}
            aria-label={pitchName(p)}
          />
        ))}
    </div>
  );
}

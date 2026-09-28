import { isBlack, pitchName, type Hand, type Note } from '../model/song';

const LO = 21;
const HI = 108;

/** An 88-key overview: where the song's notes are, and where your keyboard sits. */
export function KeyboardStrip({ notes, lo, hi, colors, hands }: { notes: Note[]; lo: number; hi: number; colors: Record<Hand, string>; hands: Set<Hand> }) {
  const whites: number[] = [];
  for (let p = LO; p <= HI; p++) if (!isBlack(p)) whites.push(p);
  const ww = 1000 / whites.length;
  const xOf = (p: number) => {
    const wi = whites.findIndex((w) => w >= p);
    return isBlack(p) ? wi * ww - ww * 0.3 : wi * ww;
  };
  const widthOf = (p: number) => (isBlack(p) ? ww * 0.6 : ww);
  const used = new Map<number, Set<Hand>>();
  for (const n of notes) {
    if (!used.has(n.pitch)) used.set(n.pitch, new Set());
    used.get(n.pitch)!.add(n.hand);
  }
  const winX = xOf(lo);
  const winW = xOf(hi) + widthOf(hi) - winX;
  const keyY = 22;
  const keyH = 56;

  return (
    <svg viewBox="0 0 1000 96" style={{ width: '100%', display: 'block' }} role="img" aria-label={`Keyboard position ${pitchName(lo)} to ${pitchName(hi)}`}>
      {/* Notes the song uses, per hand, as dots above the keys */}
      {[...used.entries()].map(([p, hs]) =>
        [...hs].map((h, i) => (
          <rect
            key={`${p}${h}`}
            x={xOf(p) + 1}
            y={4 + i * 7}
            width={Math.max(2, widthOf(p) - 2)}
            height={5}
            rx={2}
            fill={colors[h]}
            opacity={hands.has(h) ? 1 : 0.35}
          />
        )),
      )}
      {whites.map((p) => (
        <rect key={p} x={xOf(p)} y={keyY} width={ww - 0.6} height={keyH} fill={p >= lo && p <= hi ? '#f3f4f6' : '#4b5563'} />
      ))}
      {Array.from({ length: HI - LO + 1 }, (_, i) => LO + i)
        .filter(isBlack)
        .map((p) => (
          <rect key={p} x={xOf(p)} y={keyY} width={ww * 0.6} height={keyH * 0.6} fill={p >= lo && p <= hi ? '#111827' : '#1f2937'} />
        ))}
      <rect x={winX} y={keyY - 2} width={winW} height={keyH + 4} fill="none" stroke="#818cf8" strokeWidth={3} rx={3} />
      {whites
        .filter((p) => p % 12 === 0)
        .map((p) => (
          <text key={p} x={xOf(p) + ww / 2} y={keyY + keyH + 13} fontSize={10} textAnchor="middle" fill="#9ca3af">
            {pitchName(p)}
          </text>
        ))}
    </svg>
  );
}

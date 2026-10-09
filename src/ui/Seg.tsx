/** A row of toggle buttons (segmented control). Each option can have hover help and be disabled. */
export type SegOption<T extends string> = [T, string] | [T, string, { title?: string; disabled?: boolean }];

export function Seg<T extends string>({ value, options, onChange, title }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; title?: string }) {
  return (
    <div className="seg" title={title}>
      {options.map(([v, label, extra]) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)} title={extra?.title} disabled={extra?.disabled}>
          {label}
        </button>
      ))}
    </div>
  );
}

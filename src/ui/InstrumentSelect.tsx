import { INSTRUMENTS } from '../audio/instruments';
import { ensureAudio, updateSettings, useSettings } from './services';

/** Pick the sound for your keys and the backing track. */
export function InstrumentSelect({ label = false }: { label?: boolean }) {
  const s = useSettings();
  const groups: [string, string][] = [
    ['piano', 'Piano'],
    ['sampled', 'Sampled instruments (download once)'],
    ['synth', 'Synth voices (work offline)'],
  ];
  return (
    <label className="row small" style={{ gap: 6 }}>
      {label && 'Instrument'}
      <select
        value={s.instrument}
        title="Sound for your keys and the backing track"
        onChange={(e) => {
          const id = e.target.value;
          updateSettings((x) => (x.instrument = id));
          ensureAudio().catch(() => {});
        }}
      >
        {groups.map(([kind, name]) => (
          <optgroup key={kind} label={name}>
            {INSTRUMENTS.filter((i) => i.kind === kind).map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

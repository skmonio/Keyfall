import { useAudioStatus, useDevices, useSettings } from './services';
import { INSTRUMENTS } from '../audio/instruments';

export function DeviceBadge() {
  const d = useDevices();
  const audio = useAudioStatus();
  const settings = useSettings();
  const lumiIn = d.inputs.find((i) => i.isLumi);
  const other = d.inputs.filter((i) => !i.isLumi);
  return (
    <div className="row small">
      {lumiIn ? (
        <span className="pill ok" title={lumiIn.name}>LUMI connected</span>
      ) : other.length ? (
        <span className="pill ok" title={other.map((o) => o.name).join(', ')}>MIDI: {other[0].name}</span>
      ) : (
        <span className="pill warn" title={d.midiError ?? 'No MIDI keyboard found. Use A–; keys on the computer keyboard.'}>
          Computer keyboard
        </span>
      )}
      {lumiIn && !d.lumiOutputName && settings.lumiEnabled && (
        <span className="pill warn" title="KeyFall hears the LUMI but has no MIDI output to send lights to. Try the Lights check on the LUMI test page.">
          No lights output
        </span>
      )}
      {d.lumiOutputName && settings.lumiEnabled && (
        <span className={`pill ${d.sysex ? 'ok' : 'warn'}`} title={d.sysex ? 'SysEx allowed' : 'SysEx denied: key lights work, LUMI mode switching does not'}>
          Lights {d.sysex ? 'on' : 'on (no SysEx)'}
        </span>
      )}
      <span className={`pill ${audio === 'ready' ? 'ok' : audio === 'fallback' ? 'warn' : ''}`}>
        {(() => {
          const name = INSTRUMENTS.find((i) => i.id === settings.instrument)?.name ?? 'Grand piano';
          return audio === 'idle' ? 'Audio: click to enable' : audio === 'loading' ? `Loading ${name.toLowerCase()}…` : audio === 'ready' ? name : `Simple synth (${name.toLowerCase()} unavailable offline)`;
        })()}
      </span>
    </div>
  );
}

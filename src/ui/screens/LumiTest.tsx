import { useEffect, useRef, useState } from 'react';
import { hexToRgb, LumiLights, paletteRgb, type LumiMode } from '../../midi/lumiLights';
import { input, useDevices, useSettings } from '../services';
import { pitchName } from '../../model/song';
import { LightsCheck } from '../LightsCheck';

const LOW = 36; // cover several octaves: only the ones in the LUMI's current window light up
const HIGH = 96;

export function LumiTest() {
  const d = useDevices();
  const settings = useSettings();
  const outs = input.outputs();
  const [outId, setOutId] = useState<string>(() => outs.find((o) => o.isLumi)?.id ?? outs[0]?.id ?? '');
  const [running, setRunning] = useState<string>();
  const [echo, setEcho] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const lightsRef = useRef<LumiLights | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!outId && outs.length) setOutId(outs.find((o) => o.isLumi)?.id ?? outs[0].id);
  }, [outs.length]);

  const out = outId ? input.output(outId) : undefined;
  useEffect(() => {
    lightsRef.current = out ? new LumiLights(out, d.sysex, settings.lumiSysexId) : undefined;
    return () => {
      stop();
      lightsRef.current?.clearAll();
    };
  }, [outId, d.sysex, settings.lumiSysexId]);

  const [lastPitch, setLastPitch] = useState<number>();
  useEffect(() => input.onKey((e) => e.type === 'on' && e.source === 'midi' && setLastPitch(e.pitch)), []);
  const lastKey = lastPitch !== undefined ? pitchName(lastPitch) : undefined;
  const lumiBase = lastPitch !== undefined ? lastPitch - (((lastPitch % 12) + 12) % 12) : 0;
  const lumiRange = `${pitchName(lumiBase - 12)}–${pitchName(lumiBase + 11)} or ${pitchName(lumiBase)}–${pitchName(lumiBase + 23)}`;

  const say = (m: string) => setLog((l) => [m, ...l].slice(0, 6));

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
    setRunning(undefined);
  };

  const cycle = () => {
    const l = lightsRef.current;
    if (!l) return;
    stop();
    setRunning('cycle');
    let step = 0;
    timer.current = window.setInterval(() => {
      for (let n = LOW; n <= HIGH; n++) l.setKeyVelocity(n, 1 + ((n * 5 + step * 4) % 126), 1);
      step++;
      if (step > 60) {
        stop();
        l.clearAll();
        say('Colour cycle finished.');
      }
    }, 100);
    say('Cycling colours on every key. Only the keys in the LUMI\'s current octave range light up.');
  };

  const hands = () => {
    const l = lightsRef.current;
    if (!l) return;
    stop();
    l.clearAll();
    for (let n = LOW; n <= HIGH; n++) l.setKeyColor(n, hexToRgb(n < 60 ? settings.colors.L : settings.colors.R), 1);
    say('Keys below middle C: left-hand colour. Middle C and up: right-hand colour.');
  };

  const clear = () => {
    stop();
    lightsRef.current?.clearAll(true);
    say('Cleared all app lights.');
  };

  const mode = (m: LumiMode) => {
    const ok = lightsRef.current?.setMode(m);
    say(ok ? `Sent SysEx: ${m} mode.` : 'SysEx is not available (permission denied, or no output). Key lights still work.');
  };

  useEffect(() => {
    if (!echo) return;
    return input.onKey((e) => {
      const l = lightsRef.current;
      if (!l) return;
      if (e.type === 'on') l.setKeyVelocity(e.pitch, 127, 1);
      else l.setKeyColor(e.pitch, hexToRgb(e.pitch < 60 ? settings.colors.L : settings.colors.R), 0.4);
    });
  }, [echo, settings.colors]);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>LUMI light test</h1>
      <div className="muted">
        Check that the app can light your LUMI's keys. LUMI LED control isn't officially documented. KeyFall uses the protocol the community has worked out:
        key colours are plain MIDI notes sent <i>to</i> the LUMI, and mode/colour settings use SysEx.
      </div>

      <LightsCheck />

      <div className="card col">
        <div className="row">
          <div className="field">
            <label>Send lights to</label>
            <select value={outId} onChange={(e) => setOutId(e.target.value)}>
              {outs.length === 0 && <option value="">No MIDI outputs</option>}
              {outs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{o.isLumi ? ' (LUMI)' : ''}</option>
              ))}
            </select>
          </div>
          <span className={`pill ${d.sysex ? 'ok' : 'warn'}`}>SysEx {d.sysex ? 'granted' : 'not granted'}</span>
          {!outs.some((o) => o.isLumi) && <span className="pill warn">No LUMI detected</span>}
        </div>
        <div className="row">
          <button className="primary" disabled={!out} onClick={cycle}>{running === 'cycle' ? 'Cycling…' : 'Cycle colours'}</button>
          <button disabled={!out} onClick={hands}>Show hand colours</button>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={echo} disabled={!out} onChange={(e) => setEcho(e.target.checked)} />
            Light the keys I press
          </label>
          <button disabled={!out} onClick={clear}>Clear all</button>
        </div>
        <h3 style={{ marginTop: 8 }}>LUMI modes (SysEx)</h3>
        <div className="row">
          <button disabled={!out || !d.sysex} onClick={() => mode('app')} title="Turn off the LUMI's own key colours so only the app's lights show">App mode (blank keys)</button>
          <button disabled={!out || !d.sysex} onClick={() => mode('rainbow')}>Rainbow</button>
          <button disabled={!out || !d.sysex} onClick={() => mode('single')}>Single colour</button>
          <button disabled={!out || !d.sysex} onClick={() => mode('piano')}>Piano</button>
          <button disabled={!out || !d.sysex} onClick={() => mode('night')}>Night</button>
        </div>
        <div className="row small">
          Octave (SysEx):
          {[-2, -1, 0, 1, 2].map((o) => (
            <button key={o} disabled={!out || !d.sysex} onClick={() => say(lightsRef.current?.setOctave(o) ? `Sent octave ${o > 0 ? '+' : ''}${o}: lowest key should now be ${pitchName(48 + 12 * o)}. Press a key to check.` : 'SysEx not available.')}>
              {o > 0 ? '+' : ''}{o}
            </button>
          ))}
          <span className="muted">Last key from your keyboard: <b>{lastKey ?? '–'}</b>{lastKey && ` → LUMI range ${lumiRange}`}</span>
        </div>
        <div className="row small">
          Brightness
          <input type="range" min={0} max={100} step={25} defaultValue={100} disabled={!out || !d.sysex} onChange={(e) => lightsRef.current?.setBrightness(Number(e.target.value))} />
        </div>
        {log.length > 0 && (
          <div className="small muted col" style={{ gap: 2 }}>
            {log.map((l, i) => (
              <div key={i} style={{ opacity: 1 - i * 0.15 }}>{l}</div>
            ))}
          </div>
        )}
      </div>

      <div className="card col small">
        <h3>Palette</h3>
        <div className="muted">These are the colours a LUMI can show on a single key (MIDI velocity 1–127). App colours snap to the nearest one.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(32, 1fr)', gap: 2 }}>
          {Array.from({ length: 127 }, (_, i) => i + 1).map((v) => {
            const [r, g, b] = paletteRgb(v);
            return <div key={v} title={`velocity ${v}`} style={{ height: 14, borderRadius: 2, background: `rgb(${r},${g},${b})` }} />;
          })}
        </div>
      </div>

      <div className="card small muted col">
        <h3>If nothing lights up</h3>
        <div>1. Make sure the LUMI shows up as a MIDI <i>output</i> above (over Bluetooth, pair it in the OS first; see README).</div>
        <div>2. Press the LUMI's octave buttons. It only lights keys inside its current 24-key window.</div>
        <div>3. Some firmware versions or custom LUMI programs ignore incoming notes. If so, update the firmware with ROLI Dashboard / LUMI app, or play without lights: the game works the same.</div>
        <div>4. If SysEx is "not granted", allow MIDI device control for this site in the browser's site settings and reload.</div>
      </div>
    </div>
  );
}


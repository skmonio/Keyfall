import { DEFAULT_WINDOWS } from '../../engine/judge';
import { DEFAULT_SETTINGS } from '../../engine/settings';
import { snapToLumi } from '../../midi/lumiLights';
import type { Navigate } from '../App';
import { db } from '../../storage/db';
import { KEYBOARDS, type KeyboardKind } from '../../model/fit';
import { InstrumentSelect } from '../InstrumentSelect';
import { ensureAudio, input, piano, updateSettings, useCalibration, useDevices, useSettings } from '../services';

export function Settings({ nav }: { nav: Navigate }) {
  const s = useSettings();
  const d = useDevices();
  const cal = useCalibration();


  const w = s.play.windows;
  const setWin = (k: keyof typeof w, v: number) => updateSettings((x) => (x.play.windows[k] = Math.max(5, v)));

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>Settings</h1>

      <div className="card col">
        <h3>Keyboard</h3>
        {d.midiError && <div className="notice">{d.midiError}</div>}
        {!d.midiError && d.inputs.length === 0 && (
          <div className="notice">No MIDI keyboard found. Plug one in (or pair a LUMI over Bluetooth, see README). The computer keyboard always works.</div>
        )}
        <div className="field">
          <label>Listen to</label>
          <select
            value={s.preferredInputId ?? ''}
            onChange={(e) => {
              const v = e.target.value || undefined;
              input.selectedInputId = v;
              updateSettings((x) => (x.preferredInputId = v));
            }}
          >
            <option value="">All MIDI inputs</option>
            {d.inputs.map((i) => (
              <option key={i.id} value={i.id}>{i.name}{i.isLumi ? ' (LUMI)' : ''}</option>
            ))}
          </select>
        </div>
        <div className="small muted">
          SysEx permission: {d.sysex ? <span style={{ color: 'var(--good)' }}>granted</span> : <span style={{ color: 'var(--warn)' }}>not granted</span>}
          {' · '}LUMI output: {d.lumiOutputName ?? 'not found'}
        </div>
        <div className="field">
          <label>Keyboard size</label>
          <select value={s.keyboard} onChange={(e) => updateSettings((x) => (x.keyboard = e.target.value as KeyboardKind))}>
            <option value="auto">Auto (LUMI = 24 keys if connected, otherwise 88)</option>
            {Object.values(KEYBOARDS).map((k) => (
              <option key={k.kind} value={k.kind}>{k.label}</option>
            ))}
          </select>
        </div>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.lumiAutoOctave} onChange={(e) => updateSettings((x) => (x.lumiAutoOctave = e.target.checked))} />
          Move the LUMI to the right octave automatically when a song starts (needs SysEx)
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.lumiEnabled} onChange={(e) => updateSettings((x) => (x.lumiEnabled = e.target.checked))} />
          Light up LUMI keys
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.lumiAppMode} onChange={(e) => updateSettings((x) => (x.lumiAppMode = e.target.checked))} />
          While playing, turn off the LUMI's own key colours (needs SysEx) and afterwards restore
          <select value={s.lumiRestoreMode} onChange={(e) => updateSettings((x) => (x.lumiRestoreMode = e.target.value as typeof s.lumiRestoreMode))}>
            <option value="rainbow">Rainbow</option>
            <option value="single">Single colour</option>
            <option value="piano">Piano</option>
            <option value="night">Night</option>
          </select>
        </label>
      </div>

      <div className="card col">
        <h3>Timing windows (ms either side)</h3>
        <div className="row">
          {(['perfect', 'great', 'good'] as const).map((k) => (
            <div className="field" key={k}>
              <label style={{ textTransform: 'capitalize' }}>{k}</label>
              <input type="number" value={w[k]} min={5} max={500} onChange={(e) => setWin(k, Number(e.target.value))} />
            </div>
          ))}
          <button onClick={() => updateSettings((x) => (x.play.windows = { ...DEFAULT_WINDOWS }))}>Reset (40 / 80 / 120)</button>
        </div>
        {!(w.perfect <= w.great && w.great <= w.good) && <div className="notice">Windows should grow: Perfect ≤ Great ≤ Good.</div>}
        <div className="small muted">Anything later than Good counts as a miss. Windows are in real time, so they feel the same at any speed.</div>
      </div>

      <div className="card col">
        <h3>Latency</h3>
        <div className="small">
          {cal ? (
            <>
              Calibrated for <b>{cal.deviceKey}</b>: input {Math.round(cal.inputLatencyMs)} ms, audio {Math.round(cal.audioLatencyMs)} ms.
            </>
          ) : (
            <span className="muted">Not calibrated for {input.deviceKey()} yet.</span>
          )}
        </div>
        <div className="row">
          <button onClick={() => nav({ name: 'calibrate' })}>Run calibration</button>
          {cal && (
            <button
              onClick={async () => {
                await db.deleteCalibration(cal.deviceKey);
                location.reload();
              }}
            >
              Clear calibration
            </button>
          )}
        </div>
      </div>

      <div className="card col">
        <h3>Sound</h3>
        <div className="row">
          <InstrumentSelect label />
          <button
            onClick={async () => {
              await ensureAudio();
              [60, 64, 67, 72].forEach((p, i) => setTimeout(() => {
                piano.keyDown(p, 90);
                setTimeout(() => piano.keyUp(p), 400);
              }, i * 180));
            }}
          >
            ▶ Try it
          </button>
        </div>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.keySound} onChange={(e) => updateSettings((x) => (x.keySound = e.target.checked))} />
          Play my keys through the app (switch off if your keyboard has its own speakers; a LUMI doesn't)
        </label>
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.gameSounds} onChange={(e) => updateSettings((x) => (x.gameSounds = e.target.checked))} />
          Game sounds (a fanfare when you pass a step or set a new best)
          <button className="link" onClick={async () => { await ensureAudio(); piano.fanfare(); }}>hear it</button>
        </label>
        <div className="small muted">
          Grand piano: Salamander Grand Piano by Alexander Holm (CC-BY 3.0). Harp, guitar, violin, cello, flute, organ and xylophone:
          tonejs-instruments by Nicholas Brosowsky (samples CC-BY 3.0). These download the first time you choose them. The synth voices are
          built in and work offline.
        </div>
      </div>

      <div className="card col">
        <h3>Look &amp; feel</h3>
        <div className="row">
          {(['R', 'L'] as const).map((h) => (
            <div className="field" key={h}>
              <label>{h === 'R' ? 'Right hand' : 'Left hand'}: play now / next</label>
              <div className="row" style={{ gap: 6 }}>
                <input type="color" title="Play now" value={s.colors[h]} onChange={(e) =>
                    updateSettings((x) => (x.colors[h] = snapToLumi(e.target.value)))
                  }
                />
                <input type="color" title="Next note" value={s.nextColors[h]} onChange={(e) =>
                    updateSettings((x) => (x.nextColors[h] = snapToLumi(e.target.value)))
                  }
                />
              </div>
            </div>
          ))}
          <button
            onClick={() =>
              updateSettings((x) => {
                x.colors = { ...DEFAULT_SETTINGS.colors };
                x.nextColors = { ...DEFAULT_SETTINGS.nextColors };
              })
            }
          >
            Reset colours
          </button>
          <div className="field">
            <label>Notes visible ahead: {s.play.lookAheadSec.toFixed(1)}s</label>
            <input type="range" min={1.5} max={6} step={0.5} value={s.play.lookAheadSec} onChange={(e) => updateSettings((x) => (x.play.lookAheadSec = Number(e.target.value)))} />
          </div>
        </div>
        <div className="small muted">
          The same colours are used on the screen (keyboard, sheet music, falling notes) and on the LUMI's keys. The LUMI can show 127 fixed
          colours, so any colour you pick snaps to the nearest one; that way the screen always matches the keys.
        </div>
      </div>

    </div>
  );
}

import { useState } from 'react';
import { buildSysex, colorCommand, colorModeCommand, LUMI_DEVICE_ID, LumiLights } from '../midi/lumiLights';
import { getSettings, input, requestSysex, sysexPermission, updateSettings, useDevices } from './services';

/**
 * A guided check for "my LUMI shows its own colours and none of KeyFall's": it tries each link
 * in the chain (MIDI output → SysEx → key lights) and writes a report that can be copied.
 */
type Step = 'start' | 'blank' | 'search' | 'bisect' | 'lights' | 'channels' | 'done';

const ALL_IDS = Array.from({ length: 128 }, (_, i) => i);

export function LightsCheck() {
  const d = useDevices();
  const [step, setStep] = useState<Step>('start');
  const [notes, setNotes] = useState<string[]>([]);
  const [perm, setPerm] = useState<string>();
  const [outIdx, setOutIdx] = useState(0);
  // Searching for the LUMI's SysEx address: the ids still in the running, and the half being tried.
  const [cands, setCands] = useState<number[]>(ALL_IDS);
  const [busy, setBusy] = useState(false);
  const add = (s: string) => setNotes((n) => [...n, s]);

  const lumiOuts = () => {
    const all: MIDIOutput[] = [];
    input.access?.outputs.forEach((o) => all.push(o));
    return all.filter((o) => /lumi|roli/i.test(`${o.name} ${o.manufacturer}`));
  };
  const allOuts = () => {
    const all: MIDIOutput[] = [];
    input.access?.outputs.forEach((o) => all.push(o));
    return all;
  };
  const current = () => lumiOuts()[outIdx];

  const begin = async () => {
    const p = await sysexPermission();
    setPerm(p);
    const outs = allOuts();
    const ins = input.inputs();
    setNotes([
      `Browser: ${navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[\d.]+/g)?.join(' ') ?? navigator.userAgent}`,
      `Page: ${location.host} · SysEx ${input.sysexGranted ? 'granted' : 'NOT granted'} (permission: ${p})`,
      `Inputs: ${ins.map((i) => `${i.name} [${i.state}]`).join(', ') || 'none'}`,
      `Outputs: ${outs.map((o) => `${o.name} [${o.state}/${o.connection}]`).join(', ') || 'none'}`,
      `Lights output KeyFall picked: ${input.lumiOutput()?.name ?? 'NONE'}`,
      `SysEx address in use: 0x${(getSettings().lumiSysexId ?? LUMI_DEVICE_ID).toString(16)}`,
    ]);
    if (!lumiOuts().length) return setStep('done');
    setStep('blank');
  };

  const sendBlank = () => {
    const o = current();
    if (!o) return;
    new LumiLights(o, true, getSettings().lumiSysexId ?? LUMI_DEVICE_ID).setMode('app');
  };

  /** Send SysEx commands to many addresses, spaced out so a Bluetooth link keeps up. */
  const sendTo = (ids: number[], cmds: number[][]) =>
    new Promise<void>((done) => {
      const o = current();
      if (!o) return done();
      let t = performance.now() + 5;
      for (const id of ids)
        for (const c of cmds) {
          o.send(buildSysex(c, id), t);
          t += 6;
        }
      setTimeout(done, t - performance.now() + 250);
    });
  const blankCmds = [colorModeCommand('single'), colorCommand(0, [0, 0, 0]), colorCommand(1, [0, 0, 0])];
  const relightCmds = [colorModeCommand('rainbow')];
  const tryAll = async () => {
    setBusy(true);
    await sendTo(ALL_IDS, blankCmds);
    setBusy(false);
  };
  /** Light the LUMI up again, then blank only the first half of the candidates. */
  const tryHalf = async (c: number[]) => {
    setBusy(true);
    await sendTo(c, relightCmds);
    await new Promise((r) => setTimeout(r, 500));
    await sendTo(c.slice(0, Math.ceil(c.length / 2)), blankCmds);
    setBusy(false);
  };
  const answerHalf = async (dark: boolean) => {
    const half = Math.ceil(cands.length / 2);
    const next = dark ? cands.slice(0, half) : cands.slice(half);
    if (next.length === 1) {
      const id = next[0];
      await sendTo(cands, relightCmds);
      new LumiLights(current()!, true, id).setMode('app');
      updateSettings((x) => (x.lumiSysexId = id === LUMI_DEVICE_ID ? undefined : id));
      add(`Found the LUMI's SysEx address: 0x${id.toString(16).padStart(2, '0')} (KeyFall used 0x37) ✔ — saved`);
      setCands(ALL_IDS);
      setStep('lights');
      return;
    }
    if (!next.length) {
      add('Address search: no single address found ✘');
      setStep('lights');
      return;
    }
    setCands(next);
    tryHalf(next);
  };
  const sendLights = (channels: number[]) => {
    const o = current();
    if (!o) return;
    for (const ch of channels)
      for (let n = 0; n < 128; n++) {
        o.send([0xa0 | ch, n, 127]);
        o.send([0x90 | ch, n, n % 12 === 0 ? 127 : 49]); // C keys white, the rest green
      }
  };
  const clearLights = () => {
    const o = current();
    if (!o) return;
    for (let ch = 0; ch < 16; ch++) for (let n = 0; n < 128; n++) o.send([0x80 | ch, n, 0]);
  };

  const report = notes.join('\n');
  const copy = () => navigator.clipboard?.writeText(report).catch(() => undefined);

  return (
    <div className="card col">
      <h3 style={{ margin: 0 }}>Lights check</h3>
      <div className="small muted">
        If your LUMI shows its own colours and not KeyFall's, this finds out where it goes wrong. Keep the LUMI in front of you and answer each
        question.
      </div>
      {step === 'start' && (
        <div className="row">
          <button className="primary" onClick={begin}>Start the lights check</button>
        </div>
      )}
      {step === 'blank' && (
        <>
          <div>
            Step 1 of 2 (using <b>{current()?.name}</b>): <button onClick={sendBlank}>Blank the LUMI</button> — did <b>all its keys go dark</b>?
          </div>
          {!input.sysexGranted && (
            <div className="small">
              SysEx isn't granted, so this can't work yet. <button onClick={async () => setPerm(await requestSysex())}>Allow LUMI lights</button>
              {perm === 'denied' && ' Chrome has blocked it: site settings (icon left of the address bar) → MIDI device control & reprogram → Allow, then reload.'}
            </div>
          )}
          <div className="row">
            <button onClick={() => { add('Step 1 (blank via SysEx): keys went dark ✔'); setStep('lights'); }}>Yes, dark</button>
            <button onClick={() => { add(`Step 1 (blank via SysEx, address 0x${(getSettings().lumiSysexId ?? LUMI_DEVICE_ID).toString(16)}): NO change ✘`); setStep(input.sysexGranted ? 'search' : 'lights'); }}>No, still lit</button>
          </div>
        </>
      )}
      {step === 'search' && (
        <>
          <div>
            Your LUMI may answer to a different SysEx address. <button onClick={tryAll} disabled={busy}>{busy ? 'Sending…' : 'Blank the LUMI at every address'}</button> (takes
            a few seconds) — did <b>the keys go dark</b> this time?
          </div>
          <div className="row">
            <button disabled={busy} onClick={() => { add('Address search: all addresses → keys went dark ✔'); setCands(ALL_IDS); setStep('bisect'); tryHalf(ALL_IDS); }}>Yes, dark</button>
            <button disabled={busy} onClick={() => { add('Address search: all addresses → NO change ✘ (the LUMI ignores these SysEx commands)'); setStep('lights'); }}>No, still lit</button>
          </div>
        </>
      )}
      {step === 'bisect' && (
        <>
          <div>
            Narrowing it down ({cands.length} addresses left, about {Math.ceil(Math.log2(cands.length))} more questions). The LUMI lights up, then KeyFall tries half
            of them: {busy ? <b>sending…</b> : <>did the keys <b>go dark</b>?</>}
          </div>
          <div className="row">
            <button disabled={busy} onClick={() => answerHalf(true)}>Yes, dark</button>
            <button disabled={busy} onClick={() => answerHalf(false)}>No, lit</button>
            <button className="link" disabled={busy} onClick={() => tryHalf(cands)}>Try that again</button>
          </div>
        </>
      )}
      {step === 'lights' && (
        <>
          <div>
            Step 2 of 2: <button onClick={() => sendLights([0])}>Light the keys</button> — do you see <b>green keys with white Cs</b>?
          </div>
          <div className="row">
            <button onClick={() => { add('Step 2 (key lights, channel 1): visible ✔'); clearLights(); setStep('done'); }}>Yes</button>
            <button onClick={() => { add('Step 2 (key lights, channel 1): NOT visible ✘'); setStep('channels'); }}>No</button>
          </div>
        </>
      )}
      {step === 'channels' && (
        <>
          <div>
            One more try: <button onClick={() => sendLights(Array.from({ length: 16 }, (_, i) => i))}>Light the keys on every MIDI channel</button> — green keys now?
          </div>
          <div className="row">
            <button onClick={() => { add('Step 3 (key lights, all channels): visible ✔ → LUMI listens on another channel'); clearLights(); setStep('done'); }}>Yes</button>
            <button onClick={() => { add('Step 3 (key lights, all channels): NOT visible ✘'); clearLights(); if (outIdx + 1 < lumiOuts().length) { add(`Trying the next LUMI output…`); setOutIdx(outIdx + 1); setStep('blank'); } else setStep('done'); }}>No</button>
          </div>
        </>
      )}
      {step === 'done' && (
        <>
          <div>
            {!lumiOuts().length
              ? 'KeyFall can’t find a LUMI output to send lights to (it may only see the LUMI as an input). Unplug and reconnect the LUMI, or connect it by USB, then reload.'
              : 'Done. Copy the report below and paste it into the chat, so the cause can be pinned down.'}
          </div>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{report}</pre>
          <div className="row">
            <button className="primary" onClick={copy}>Copy report</button>
            <button onClick={() => { setStep('start'); setOutIdx(0); setNotes([]); }}>Start again</button>
          </div>
        </>
      )}
      {d.inputs.length === 0 && step === 'start' && <div className="small muted">No MIDI keyboard is connected right now.</div>}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { requestSysex, sysexPermission, useDevices, useSettings } from './services';

/**
 * Shown when a LUMI is connected but Chrome hasn't allowed SysEx: without it KeyFall can't
 * switch off the LUMI's own colours or move its octave, so every key stays lit.
 */
export function SysexFix({ compact = false }: { compact?: boolean }) {
  const d = useDevices();
  const settings = useSettings();
  const [state, setState] = useState<string>();
  const [busy, setBusy] = useState(false);
  const needed = !!d.lumiOutputName && settings.lumiEnabled && !d.sysex;
  useEffect(() => {
    if (needed) sysexPermission().then(setState);
  }, [needed]);
  if (!needed) return null;

  const ask = async () => {
    setBusy(true);
    setState(await requestSysex());
    setBusy(false);
  };
  const blocked = state === 'denied';
  const where = `${location.hostname}:${location.port}`;
  return (
    <div className={`notice sysex-fix${compact ? ' compact' : ''}`}>
      <b>LUMI lights need one more permission.</b>{' '}
      {blocked ? (
        <>
          Chrome has blocked “control and reprogram MIDI devices” for <code>{where}</code>. Click the icon left of the address bar →{' '}
          <b>Site settings</b> → set <b>MIDI device control &amp; reprogram</b> to <b>Allow</b>, then reload. (Each address and port has its own
          permission, so always open KeyFall at the same one.)
        </>
      ) : (
        <>Without it the LUMI keeps its own colours (every key lit). Click below and choose <b>Allow</b> when Chrome asks.</>
      )}{' '}
      <button className="primary" onClick={ask} disabled={busy}>
        {busy ? 'Asking…' : blocked ? 'Try again' : 'Allow LUMI lights'}
      </button>
    </div>
  );
}

import { resolveKeyboard } from '../model/fit';
import { updateSettings, useDevices, useSettings } from './services';

/**
 * A LUMI is plugged in but "Your keyboard" says something else (e.g. Full 88 keys): the screen
 * then isn't laid out like the LUMI and its lights land on keys it doesn't have. Offer the fix.
 */
export function KeyboardMismatch({ compact = false }: { compact?: boolean }) {
  const d = useDevices();
  const settings = useSettings();
  const lumiConnected = d.inputs.some((i) => i.isLumi);
  const spec = resolveKeyboard(settings.keyboard, lumiConnected);
  if (!lumiConnected || spec.lumi) return null;
  return (
    <div className={`notice sysex-fix${compact ? ' compact' : ''}`}>
      <b>Your LUMI is connected, but “Your keyboard” is set to {spec.label}.</b> The screen won't match the LUMI and its lights can land on keys it
      doesn't have.
      <button className="primary" onClick={() => updateSettings((x) => (x.keyboard = 'auto'))}>Use my LUMI</button>
    </div>
  );
}

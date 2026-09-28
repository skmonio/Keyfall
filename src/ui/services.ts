/** App-wide singletons: MIDI input, audio, LUMI lights, settings. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { piano } from '../audio/piano';
import { DEFAULT_SETTINGS, type AppSettings, type Calibration } from '../engine/settings';
import { input } from '../midi/input';
import { LumiLights } from '../midi/lumiLights';
import { db } from '../storage/db';

export { input, piano };

// Handy for debugging and scripted testing in dev builds only.
if (import.meta.env.DEV) Object.assign(window, { __input: input, __updateSettings: (fn: (s: AppSettings) => void) => updateSettings(fn) });

// ------------------------------------------------------------ settings store

let settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
const settingsSubs = new Set<() => void>();
let loaded = false;

export async function loadSettings(): Promise<void> {
  try {
    settings = await db.getSettings();
  } catch (e) {
    console.warn('Could not load settings, using defaults', e);
  }
  loaded = true;
  settingsSubs.forEach((f) => f());
}

export function getSettings(): AppSettings {
  return settings;
}

export function updateSettings(fn: (s: AppSettings) => void) {
  const next = structuredClone(settings);
  fn(next);
  settings = next;
  settingsSubs.forEach((f) => f());
  db.saveSettings(settings).catch((e) => console.warn('Could not save settings', e));
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (cb) => {
      settingsSubs.add(cb);
      return () => settingsSubs.delete(cb);
    },
    () => settings,
  );
}

export const settingsLoaded = () => loaded;

// ------------------------------------------------------------ devices

export interface DeviceStatus {
  midiSupported: boolean;
  midiError?: string;
  sysex: boolean;
  inputs: ReturnType<typeof input.inputs>;
  lumiOutputName?: string;
}

let lumi: LumiLights | undefined;
let lumiOutId: string | undefined;
let lumiSysex = false;
let lumiId: number | undefined;
const deviceSubs = new Set<() => void>();
const lumiSubs = new Set<() => void>();

/** Called when a LUMI (re)connects: it starts in its own colours and octave, so screens set them again. */
export function onLumiChanged(cb: () => void): () => void {
  lumiSubs.add(cb);
  return () => lumiSubs.delete(cb);
}
let deviceStatus: DeviceStatus = { midiSupported: input.midiSupported, sysex: false, inputs: [] };

function refreshDevices() {
  // Only connected ports count; a LUMI that went away and came back (even with the same id)
  // gets fresh lights, because it forgot everything we'd sent it.
  const out = input.lumiOutput();
  let changed = false;
  if (out && (out.id !== lumiOutId || lumiSysex !== input.sysexGranted || lumiId !== settings.lumiSysexId)) {
    lumiOutId = out.id;
    lumiSysex = input.sysexGranted;
    lumiId = settings.lumiSysexId;
    lumi = new LumiLights(out, input.sysexGranted, settings.lumiSysexId);
    changed = true;
  } else if (!out && lumi) {
    lumi = undefined;
    lumiOutId = undefined;
    changed = true;
  }
  deviceStatus = {
    midiSupported: input.midiSupported,
    midiError: input.error,
    sysex: input.sysexGranted,
    inputs: input.connectedInputs(),
    lumiOutputName: out?.name ?? undefined,
  };
  deviceSubs.forEach((f) => f());
  if (changed) lumiSubs.forEach((f) => f());
}

let initPromise: Promise<void> | undefined;
export function initDevices(): Promise<void> {
  initPromise ??= input.init().then(() => {
    input.selectedInputId = settings.preferredInputId || undefined;
    input.onDevicesChanged(refreshDevices);
    refreshDevices();
  });
  return initPromise;
}

export function useDevices(): DeviceStatus {
  return useSyncExternalStore(
    (cb) => {
      deviceSubs.add(cb);
      return () => deviceSubs.delete(cb);
    },
    () => deviceStatus,
  );
}

/** Ask Chrome again for SysEx (LUMI colours and octave). Call from a click. */
export async function requestSysex() {
  const r = await input.requestSysex();
  // Anything learnt about the LUMI's octave without SysEx doesn't hold any more.
  if (r === 'granted' && settings.lumiOctaveWorks === false) updateSettings((x) => delete x.lumiOctaveWorks);
  refreshDevices();
  return r;
}
export const sysexPermission = () => input.sysexPermission();

/** The LUMI lights, if a LUMI is connected and lights are enabled. */
export function getLumi(): LumiLights | undefined {
  return settings.lumiEnabled ? lumi : undefined;
}

// ------------------------------------------------------------ calibration

export function useCalibration(): Calibration | undefined {
  const devices = useDevices();
  const [cal, setCal] = useState<Calibration>();
  useEffect(() => {
    db.getCalibration(input.deviceKey()).then(setCal).catch(() => setCal(undefined));
  }, [devices]);
  return cal;
}

// ------------------------------------------------------------ audio

let audioStatus: typeof piano.status = 'idle';
const audioSubs = new Set<() => void>();
export async function ensureAudio() {
  piano.sfxOn = settings.gameSounds;
  await piano.init((s) => {
    audioStatus = s;
    audioSubs.forEach((f) => f());
  }, settings.instrument);
}

// Follow sound settings as they change (and a new LUMI SysEx address from the Lights check).
settingsSubs.add(() => {
  if (settings.lumiSysexId !== lumiId && initPromise) refreshDevices();
  piano.sfxOn = settings.gameSounds;
  piano.keySoundOn = settings.keySound;
  if (piano.instrument !== settings.instrument) piano.setInstrument(settings.instrument);
});
export function useAudioStatus() {
  return useSyncExternalStore(
    (cb) => {
      audioSubs.add(cb);
      return () => audioSubs.delete(cb);
    },
    () => audioStatus,
  );
}

/**
 * Key input from Web MIDI (USB or Bluetooth MIDI) and the computer keyboard.
 * All events carry a performance.now()-based timestamp so they can be judged precisely.
 */
export interface KeyEvent {
  type: 'on' | 'off';
  pitch: number;
  velocity: number;
  /** performance.now() milliseconds. */
  time: number;
  source: 'midi' | 'computer';
  deviceId?: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  isLumi: boolean;
  state: string;
}

export type Listener = (e: KeyEvent) => void;

export function isLumiName(name: string, manufacturer = ''): boolean {
  return /lumi|roli/i.test(`${name} ${manufacturer}`);
}

/** Parse a raw MIDI message into a key event, or null if it's something else. */
export function parseMidiMessage(data: Uint8Array | number[], time: number, deviceId?: string): KeyEvent | null {
  if (data.length < 3) return null;
  const status = data[0] & 0xf0;
  const pitch = data[1];
  const velocity = data[2];
  if (status === 0x90 && velocity > 0) return { type: 'on', pitch, velocity, time, source: 'midi', deviceId };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) {
    return { type: 'off', pitch, velocity, time, source: 'midi', deviceId };
  }
  return null;
}

/**
 * Web MIDI timestamps should share performance.now()'s timebase, but some drivers
 * (notably Bluetooth MIDI) deliver stamps far in the past or future. A bad stamp makes
 * every press look early or late, so fall back to "now" when a stamp is implausible.
 */
export function sanitizeTimestamp(stamp: number | undefined, now: number, maxAgeMs = 250): { time: number; corrected: boolean } {
  if (!stamp || !Number.isFinite(stamp) || stamp > now + 5 || now - stamp > maxAgeMs) return { time: now, corrected: !!stamp };
  return { time: stamp, corrected: false };
}

// Computer keyboard: two rows like a piano, A = C.
const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17, BracketRight: 18, Backslash: 19,
};

export class InputManager {
  access?: MIDIAccess;
  sysexGranted = false;
  midiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  error?: string;
  /** Base note for the computer keyboard (A key). Z / X shift octaves. */
  computerBase = 60;
  /** Diagnostics shown in the play screen. */
  stats: { correctedStamps: number; last?: { pitch: number; source: string; at: number } } = { correctedStamps: 0 };
  /** Only listen to this input id; undefined = all inputs. */
  selectedInputId?: string;

  private listeners = new Set<Listener>();
  private deviceListeners = new Set<() => void>();
  private computerDown = new Map<string, number>();
  private keyboardAttached = false;

  async init(): Promise<void> {
    this.attachComputerKeyboard();
    if (!this.midiSupported) {
      this.error = 'This browser has no Web MIDI. Use Chrome or Edge on desktop, or play with the computer keyboard.';
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.sysexGranted = true;
    } catch {
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: false });
        this.sysexGranted = false;
      } catch (e) {
        this.error = `MIDI access was denied (${(e as Error).message}). You can still use the computer keyboard.`;
        return;
      }
    }
    this.access.onstatechange = () => {
      this.bindInputs();
      this.deviceListeners.forEach((l) => l());
    };
    this.bindInputs();
  }

  /**
   * The input to listen to: the chosen one while it's connected. If it's gone (a LUMI that
   * reconnected over USB instead of Bluetooth gets a new id), listen to everything instead,
   * so the keyboard never goes silent.
   */
  activeInputId(): string | undefined {
    const id = this.selectedInputId;
    if (!id) return undefined;
    return this.access?.inputs.get(id)?.state === 'connected' ? id : undefined;
  }

  /**
   * Ask again for full MIDI access (with SysEx, which the LUMI's colour and octave commands
   * need). Must be called from a click: Chrome only shows its prompt after a user gesture.
   * Returns the permission state afterwards.
   */
  async requestSysex(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    if (!this.midiSupported) return 'unknown';
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      if (this.access && this.access !== access) {
        // Stop the old access object's handlers, or every key would arrive twice.
        this.access.onstatechange = null;
        this.access.inputs.forEach((i) => (i.onmidimessage = null));
      }
      this.access = access;
      this.sysexGranted = true;
      this.error = undefined;
      access.onstatechange = () => {
        this.bindInputs();
        this.deviceListeners.forEach((l) => l());
      };
      this.bindInputs();
      this.deviceListeners.forEach((l) => l());
      return 'granted';
    } catch {
      return this.sysexPermission();
    }
  }

  /** Chrome's saved answer for "control and reprogram MIDI devices" on this site. */
  async sysexPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const st = await navigator.permissions.query({ name: 'midi', sysex: true } as unknown as PermissionDescriptor);
      return st.state;
    } catch {
      return 'unknown';
    }
  }

  private bindInputs() {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (ev: MIDIMessageEvent) => {
        const only = this.activeInputId();
        if (only && input.id !== only) return;
        if (!ev.data) return;
        const ts = sanitizeTimestamp(ev.timeStamp, performance.now());
        const k = parseMidiMessage(ev.data, ts.time, input.id);
        if (!k) return;
        if (ts.corrected) this.stats.correctedStamps++;
        if (k.type === 'on') this.stats.last = { pitch: k.pitch, source: input.name ?? 'MIDI', at: ts.time };
        this.emit(k);
      };
    });
  }

  /** Connected inputs only (unplugged ports stay listed by the browser). */
  connectedInputs(): DeviceInfo[] {
    return this.inputs().filter((i) => i.state === 'connected');
  }

  inputs(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    this.access?.inputs.forEach((i) =>
      out.push({ id: i.id, name: i.name ?? 'MIDI input', manufacturer: i.manufacturer ?? '', isLumi: isLumiName(i.name ?? '', i.manufacturer ?? ''), state: i.state }),
    );
    return out;
  }

  outputs(): DeviceInfo[] {
    const out: DeviceInfo[] = [];
    this.access?.outputs.forEach((o) =>
      out.push({ id: o.id, name: o.name ?? 'MIDI output', manufacturer: o.manufacturer ?? '', isLumi: isLumiName(o.name ?? '', o.manufacturer ?? ''), state: o.state }),
    );
    return out;
  }

  /** The LUMI's output for lights. Ports stay listed after unplugging, so prefer a connected one. */
  lumiOutput(): MIDIOutput | undefined {
    let found: MIDIOutput | undefined;
    this.access?.outputs.forEach((o) => {
      if (!isLumiName(o.name ?? '', o.manufacturer ?? '')) return;
      if (!found || (found.state !== 'connected' && o.state === 'connected')) found = o;
    });
    return found?.state === 'connected' ? found : undefined;
  }

  output(id: string): MIDIOutput | undefined {
    return this.access?.outputs.get(id);
  }

  /** Key used to store latency calibration for the current input. */
  deviceKey(): string {
    const inputs = this.inputs().filter((i) => i.state === 'connected');
    const sel = inputs.find((i) => i.id === this.selectedInputId) ?? inputs.find((i) => i.isLumi) ?? inputs[0];
    return sel ? `midi:${sel.name}` : 'computer-keyboard';
  }

  onKey(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onDevicesChanged(l: () => void): () => void {
    this.deviceListeners.add(l);
    return () => this.deviceListeners.delete(l);
  }

  private emit(e: KeyEvent) {
    this.listeners.forEach((l) => l(e));
  }

  private attachComputerKeyboard() {
    if (this.keyboardAttached || typeof window === 'undefined') return;
    this.keyboardAttached = true;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    window.addEventListener('keydown', (ev) => {
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || typing(ev.target)) return;
      if (ev.code === 'KeyZ') return void (this.computerBase = Math.max(24, this.computerBase - 12));
      if (ev.code === 'KeyX') return void (this.computerBase = Math.min(96, this.computerBase + 12));
      const off = KEYMAP[ev.code];
      if (off === undefined) return;
      ev.preventDefault();
      const pitch = this.computerBase + off;
      this.computerDown.set(ev.code, pitch);
      const time = sanitizeTimestamp(ev.timeStamp, performance.now()).time;
      this.stats.last = { pitch, source: 'computer keyboard', at: time };
      this.emit({ type: 'on', pitch, velocity: 90, time, source: 'computer' });
    });
    window.addEventListener('keyup', (ev) => {
      const pitch = this.computerDown.get(ev.code);
      if (pitch === undefined) return;
      this.computerDown.delete(ev.code);
      this.emit({ type: 'off', pitch, velocity: 0, time: sanitizeTimestamp(ev.timeStamp, performance.now()).time, source: 'computer' });
    });
    window.addEventListener('blur', () => {
      for (const [code, pitch] of this.computerDown) {
        this.emit({ type: 'off', pitch, velocity: 0, time: performance.now(), source: 'computer' });
        this.computerDown.delete(code);
      }
    });
  }
}

export const input = new InputManager();

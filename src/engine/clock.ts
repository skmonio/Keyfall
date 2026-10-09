/**
 * The single song clock. Rendering, audio scheduling and judging all read song time
 * from here, so they can't drift apart.
 *
 * Song time is in seconds at 100% speed. Real time comes from performance.now(), which
 * is also the timebase of Web MIDI event timestamps.
 */
export class SongClock {
  private anchorPerf = 0;
  private anchorSong = 0;
  private _rate = 1;
  private _running = false;
  /** Song time the clock may not pass (used by Wait mode to hold at the next chord). */
  private _limit = Infinity;

  constructor(private readonly perfNow: () => number = () => performance.now()) {}

  get rate(): number {
    return this._rate;
  }
  get running(): boolean {
    return this._running;
  }
  get limit(): number {
    return this._limit;
  }

  /** Song time corresponding to a performance.now() timestamp. Not clamped by the hold limit. */
  songTimeAt(perfMs: number): number {
    if (!this._running) return this.anchorSong;
    return this.anchorSong + ((perfMs - this.anchorPerf) / 1000) * this._rate;
  }

  /** Current song time, clamped at the hold limit. */
  now(perfMs = this.perfNow()): number {
    return Math.min(this.songTimeAt(perfMs), this._limit);
  }

  /** performance.now() timestamp at which the clock will reach `songTime` (if running). */
  perfAt(songTime: number): number {
    return this.anchorPerf + ((songTime - this.anchorSong) / this._rate) * 1000;
  }

  /** Is the clock currently sitting on its hold limit? */
  isHeld(perfMs = this.perfNow()): boolean {
    return this._running && this.songTimeAt(perfMs) >= this._limit;
  }

  private reanchor(perfMs: number) {
    this.anchorSong = this.now(perfMs);
    this.anchorPerf = perfMs;
  }

  start(perfMs = this.perfNow()) {
    if (this._running) return;
    this.anchorPerf = perfMs;
    this._running = true;
  }

  pause(perfMs = this.perfNow()) {
    if (!this._running) return;
    this.reanchor(perfMs);
    this._running = false;
  }

  seek(songTime: number, perfMs = this.perfNow()) {
    this.anchorSong = songTime;
    this.anchorPerf = perfMs;
    if (this._limit < songTime) this._limit = Infinity;
  }

  setRate(rate: number, perfMs = this.perfNow()) {
    this.reanchor(perfMs);
    this._rate = Math.max(0.01, rate);
  }

  /** Hold at `songTime` (or release with Infinity). Releasing resumes from the hold point, not from where real time would be. */
  setLimit(songTime: number, perfMs = this.perfNow()) {
    if (songTime > this._limit && this.isHeld(perfMs)) this.reanchor(perfMs);
    this._limit = songTime;
  }
}

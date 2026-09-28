/**
 * Plays an original recording as the backing track, locked to the song clock.
 * Uses an <audio> element with preservesPitch, so slowing down doesn't change the pitch.
 */
export class RecordingPlayer {
  readonly el: HTMLAudioElement;
  private url: string;
  private starting = false;

  constructor(blob: Blob, volume = 0.9) {
    this.url = URL.createObjectURL(blob);
    this.el = new Audio(this.url);
    this.el.preload = 'auto';
    this.el.volume = volume;
    this.el.preservesPitch = true;
  }

  /** Call every frame with the song clock's state. */
  sync(songTime: number, rate: number, playing: boolean) {
    const el = this.el;
    if (!playing || songTime < 0 || songTime >= (el.duration || Infinity)) {
      if (!el.paused) el.pause();
      if (songTime < 0 && Math.abs(el.currentTime) > 0.01) el.currentTime = 0;
      return;
    }
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (this.starting) return; // play() hasn't resolved yet
    // Re-align if we've drifted (seek, speed change, a hiccup).
    if (el.paused || Math.abs(el.currentTime - songTime) > 0.08) el.currentTime = songTime;
    if (el.paused) {
      this.starting = true;
      el.play()
        .catch(() => {})
        .finally(() => (this.starting = false));
    }
  }

  dispose() {
    this.el.pause();
    this.el.src = '';
    URL.revokeObjectURL(this.url);
  }
}

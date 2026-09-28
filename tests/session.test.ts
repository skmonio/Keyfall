import { describe, expect, it } from 'vitest';
import { SongClock } from '../src/engine/clock';
import { GameSession, type AudioSink } from '../src/engine/session';
import { DEFAULT_SETTINGS, type PlaySettings } from '../src/engine/settings';
import { buildMeasureGrid, finalizeSong, type Note, type Song } from '../src/model/song';

function makeSong(notes: Partial<Note>[]): Song {
  return finalizeSong({
    id: 's',
    title: 'T',
    notes: notes.map((n, i) => ({ id: i, pitch: 60, start: 0, duration: 0.4, hand: 'R', velocity: 80, measure: 0, ...n })),
    measures: buildMeasureGrid(8, 120),
    tempos: [{ time: 0, bpm: 120 }],
    sourceKind: 'midi',
    addedAt: 0,
  });
}

function settings(p: Partial<PlaySettings>): PlaySettings {
  return { ...structuredClone(DEFAULT_SETTINGS.play), countIn: false, ...p };
}

class FakeTime {
  t = 1000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

describe('SongClock', () => {
  it('runs at the playback rate and can be held', () => {
    const ft = new FakeTime();
    const c = new SongClock(ft.now);
    c.seek(0);
    c.start();
    ft.advance(1000);
    expect(c.now()).toBeCloseTo(1);
    c.setRate(0.5);
    ft.advance(1000);
    expect(c.now()).toBeCloseTo(1.5);
    c.setLimit(2);
    ft.advance(5000);
    expect(c.now()).toBe(2);
    expect(c.isHeld()).toBe(true);
    c.setLimit(Infinity); // release: resume from 2, not from where real time got to
    ft.advance(1000);
    expect(c.now()).toBeCloseTo(2.5);
  });

  it('maps MIDI timestamps to song time', () => {
    const ft = new FakeTime();
    const c = new SongClock(ft.now);
    c.seek(0);
    c.start();
    expect(c.songTimeAt(ft.t + 250)).toBeCloseTo(0.25);
  });
});

describe('GameSession – Performance mode', () => {
  it('scores hits, misses and wrong notes and finishes', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0 },
      { pitch: 62, start: 0.5 },
      { pitch: 64, start: 1 },
    ]);
    let finished = false;
    const s = new GameSession(song, settings({ mode: 'performance' }), { perfNow: ft.now, onFinish: () => (finished = true) });
    s.start();
    // lead-in without count-in is min(2s, bar) = 2s
    ft.advance(2000);
    s.noteOn(60, ft.t + 20); // 20ms late: perfect
    s.tick();
    ft.advance(500);
    s.noteOn(61, ft.t); // wrong key
    s.tick();
    ft.advance(700); // note 62 passes; note 64 at 1.0 (-0.2s)... is 200ms late
    s.tick();
    expect(s.scorer.byHand.R.perfect).toBe(1);
    expect(s.scorer.byHand.R.wrong).toBe(1);
    expect(s.scorer.byHand.R.miss).toBe(2);
    expect(s.scorer.combo).toBe(0);
    ft.advance(8000);
    s.tick();
    expect(finished).toBe(true);
    expect(s.results().worstMeasures[0].bar).toBe(1);
  });

  it('applies input latency compensation', () => {
    const ft = new FakeTime();
    const song = makeSong([{ pitch: 60, start: 0 }]);
    const s = new GameSession(song, settings({ mode: 'performance' }), { perfNow: ft.now, inputLatencyMs: 100 });
    s.start();
    ft.advance(2100);
    s.noteOn(60, ft.t); // arrives 100ms "late" but the device adds 100ms
    expect(s.scorer.byHand.R.perfect).toBe(1);
  });
});

describe('GameSession – Wait mode', () => {
  it('holds at each chord until all its notes are pressed, without losing combo', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0 },
      { pitch: 64, start: 0 },
      { pitch: 67, start: 1 },
    ]);
    const s = new GameSession(song, settings({ mode: 'wait' }), { perfNow: ft.now });
    s.start();
    ft.advance(5000);
    s.tick();
    expect(s.songTime).toBe(0);
    expect(s.waiting).toBe(true);
    s.noteOn(61, ft.t); // wrong: no combo loss in wait mode
    s.noteOn(60, ft.t);
    s.tick();
    expect(s.songTime).toBe(0); // still waiting for E
    s.noteOn(64, ft.t);
    expect(s.waiting).toBe(false);
    ft.advance(400);
    expect(s.songTime).toBeCloseTo(0.4);
    ft.advance(2000);
    expect(s.songTime).toBe(1);
    s.noteOn(67, ft.t);
    expect(s.scorer.combo).toBe(3);
    expect(s.scorer.byHand.R.wrong).toBe(1);
  });

  it('only waits for the practised hand', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 48, start: 0, hand: 'L' },
      { pitch: 72, start: 0.5, hand: 'R' },
    ]);
    const s = new GameSession(song, settings({ mode: 'wait', hands: 'right' }), { perfNow: ft.now });
    s.start();
    ft.advance(10000);
    s.tick();
    expect(s.songTime).toBe(0.5);
    expect(s.noteState(0).status).toBe('auto');
  });
});

describe('GameSession – loops, speed and audio', () => {
  it('loops a section and speeds up 5% after a clean pass', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0 },
      { pitch: 62, start: 2 },
    ]);
    const passes: [number, boolean, number][] = [];
    const s = new GameSession(
      song,
      settings({ mode: 'wait', section: { fromMeasure: 1, toMeasure: 1 }, loop: true, speedUpOnClean: true, speed: 1 }),
      { perfNow: ft.now, onLoop: (p, c, r) => passes.push([p, c, r]) },
    );
    expect(s.rangeStart).toBe(2);
    expect(s.rangeEnd).toBe(4);
    s.start();
    ft.advance(2000);
    s.tick();
    expect(s.songTime).toBe(2);
    s.noteOn(62, ft.t);
    ft.advance(2100);
    s.tick();
    expect(passes).toEqual([[1, true, 1.05]]);
    expect(s.songTime).toBeLessThan(2);
    expect(s.noteState(1).status).toBe('pending');
  });

  it('routes score audio by sound mode and auto-play', () => {
    const played = (audio: PlaySettings['audio'], autoPlayOtherHand: boolean) => {
      const ft = new FakeTime();
      const out: number[] = [];
      const sink: AudioSink = { scheduleNote: (p) => out.push(p), scheduleClick: () => {}, cancelScheduled: () => {} };
      const song = makeSong([
        { pitch: 48, start: 0, hand: 'L' },
        { pitch: 72, start: 0, hand: 'R' },
      ]);
      const s = new GameSession(song, settings({ mode: 'performance', hands: 'right', audio, autoPlayOtherHand }), { perfNow: ft.now, audio: sink });
      s.start();
      ft.advance(2000);
      s.tick();
      return out.sort();
    };
    // Full: the whole song, both hands (yours quietly as a guide).
    expect(played('full', false)).toEqual([48, 72]);
    // "My hand": just your part.
    expect(played('mine', false)).toEqual([72]);
    // Metro and Silent: nothing from the song.
    expect(played('metronome', false)).toEqual([]);
    expect(played('silent', false)).toEqual([]);
  });

  it('changes speed without jumping the song position', () => {
    const ft = new FakeTime();
    const s = new GameSession(makeSong([{ pitch: 60, start: 4 }]), settings({ mode: 'performance' }), { perfNow: ft.now });
    s.start();
    ft.advance(3000);
    const before = s.songTime;
    s.setSpeed(0.5);
    expect(s.songTime).toBeCloseTo(before);
    ft.advance(1000);
    expect(s.songTime).toBeCloseTo(before + 0.5);
    s.setSpeed(3);
    expect(s.rate).toBe(1.5);
  });
});

describe('GameSession – robustness', () => {
  it('clamps an absurd calibration so presses still register', () => {
    const ft = new FakeTime();
    const s = new GameSession(makeSong([{ pitch: 60, start: 0 }]), settings({ mode: 'performance' }), { perfNow: ft.now, inputLatencyMs: 900 });
    expect(s.inputLatencyMs).toBe(150);
    s.start();
    ft.advance(2000);
    // A press arriving 150ms late is fully corrected (not over-corrected by 900ms).
    s.noteOn(60, ft.t + 150);
    expect(s.scorer.byHand.R.perfect).toBe(1);
  });

  it('in Wait mode, counts a press while holding even if its timestamp looks early', () => {
    const ft = new FakeTime();
    const s = new GameSession(makeSong([{ pitch: 60, start: 0 }]), settings({ mode: 'wait' }), { perfNow: ft.now });
    s.start();
    ft.advance(5000);
    s.tick();
    expect(s.waiting).toBe(true);
    s.noteOn(60, ft.t - 4000); // stamp from 4s ago
    expect(s.noteState(0).status).toBe('hit');
  });
});

describe('GameSession – seeking', () => {
  it('jumps by bars and makes the notes there playable again', () => {
    const ft = new FakeTime();
    // 120 bpm 4/4 → 2s bars; one note per bar
    const song = makeSong([0, 2, 4, 6].map((start, i) => ({ pitch: 60 + i, start })));
    const s = new GameSession(song, settings({ mode: 'performance' }), { perfNow: ft.now });
    s.start();
    ft.advance(2000 + 4500); // into bar 3 (t = 4.5)
    s.tick();
    expect(s.currentMeasure).toBe(2);
    expect(s.noteState(1).status).toBe('missed');
    s.seekBars(-1); // 0.5s into the bar (< 35%) → previous bar
    expect(s.currentMeasure).toBe(1);
    expect(s.songTime).toBeLessThan(2);
    expect(s.noteState(1).status).toBe('pending');
    s.seekBars(2);
    expect(s.songTime).toBeGreaterThan(4);
    expect(s.songTime).toBeLessThan(6);
    s.seekToMeasure(99); // clamped
    expect(s.currentMeasure).toBe(3);
    expect(s.results().seeked).toBe(true);
  });

  it('in Wait mode, seeking holds at the first chord of the new bar', () => {
    const ft = new FakeTime();
    const song = makeSong([0, 2, 4].map((start, i) => ({ pitch: 60 + i, start })));
    const s = new GameSession(song, settings({ mode: 'wait' }), { perfNow: ft.now });
    s.start();
    s.seekToMeasure(2);
    ft.advance(5000);
    expect(s.songTime).toBe(4);
    expect(s.currentChord?.notes[0].pitch).toBe(62);
  });
});

describe('GameSession – key targets', () => {
  const song3 = () =>
    makeSong([
      { pitch: 60, start: 0, hand: 'R' },
      { pitch: 48, start: 0, hand: 'L' },
      { pitch: 62, start: 1, hand: 'R' },
      { pitch: 64, start: 2, hand: 'R' },
    ]);

  it('Performance: "now" is each hand\'s next chord, "next" the one after', () => {
    const ft = new FakeTime();
    const p = new GameSession(song3(), settings({ mode: 'performance', hands: 'right', showNextNotes: true }), { perfNow: ft.now });
    p.start();
    ft.advance(2000 - 300); // 0.3s before the first note
    const k = p.keyTargets();
    expect(k.get(60)).toEqual({ hand: 'R', role: 'now' });
    expect(k.get(62)).toEqual({ hand: 'R', role: 'next' });
    expect(k.has(64)).toBe(false); // only two steps ahead
    expect(k.has(48)).toBe(false); // not the hand you aren't playing
    p.noteOn(60, ft.t + 300);
    const after = p.keyTargets();
    expect(after.get(62)?.role).toBe('now');
    expect(after.get(64)?.role).toBe('next');
  });

  it('Wait mode: "now" is the chord being waited for, "next" the chord after', () => {
    const ft = new FakeTime();
    const w = new GameSession(song3(), settings({ mode: 'wait', hands: 'both', showNextNotes: true }), { perfNow: ft.now });
    w.start();
    ft.advance(5000);
    const k = w.keyTargets();
    expect(k.get(60)?.role).toBe('now');
    expect(k.get(48)).toEqual({ hand: 'L', role: 'now' });
    expect(k.get(62)?.role).toBe('next');
    // The LUMI gets exactly the same targets.
    const got: Map<number, { hand: string; role: string }>[] = [];
    const w2 = new GameSession(song3(), settings({ mode: 'wait', hands: 'both', showNextNotes: true }), {
      perfNow: ft.now,
      lights: { setTargets: (m) => got.push(m), flash: () => {} },
    });
    w2.start();
    ft.advance(5000);
    w2.tick();
    expect([...got[got.length - 1].entries()]).toEqual([...w2.keyTargets().entries()]);
  });
});

describe('GameSession – next notes toggle', () => {
  it('shows only "now" targets when next notes are switched off', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0 },
      { pitch: 62, start: 1 },
    ]);
    const s = new GameSession(song, settings({ mode: 'wait', showNextNotes: false }), { perfNow: ft.now });
    s.start();
    ft.advance(5000);
    expect([...s.keyTargets().entries()]).toEqual([[60, { hand: 'R', role: 'now' }]]);
    s.settings.showNextNotes = true; // switched back on mid-song
    expect(s.keyTargets().get(62)?.role).toBe('next');
  });
});

describe('GameSession – practice stats', () => {
  it('records practice time and per-bar notes and errors', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0, measure: 0 },
      { pitch: 62, start: 2.5, measure: 1 },
    ]);
    const s = new GameSession(song, settings({ mode: 'performance' }), { perfNow: ft.now });
    s.start();
    for (let i = 0; i < 40; i++) {
      ft.advance(100);
      s.tick();
    }
    s.noteOn(70, ft.t); // a wrong key at song time 2.0s = the start of bar 2
    const r = s.results();
    expect(r.playedSec).toBe(4);
    expect(r.barStats).toEqual([
      { bar: 1, notes: 1, errors: 1 }, // its note was missed
      { bar: 2, notes: 1, errors: 1 }, // the wrong key
    ]);
  });
});

describe('GameSession – loop results', () => {
  it('keeps the results of completed loop passes', () => {
    const ft = new FakeTime();
    const song = makeSong([{ pitch: 60, start: 0 }]);
    const s = new GameSession(song, settings({ mode: 'wait', section: { fromMeasure: 0, toMeasure: 0 }, loop: true }), { perfNow: ft.now });
    s.start();
    expect(s.completedPassResults).toBeUndefined();
    for (let pass = 0; pass < 2; pass++) {
      ft.advance(2100);
      s.tick();
      s.noteOn(60, ft.t);
      ft.advance(2100);
      s.tick();
    }
    expect(s.loopPasses).toBe(2);
    expect(s.completedPassResults).toMatchObject({ loopPasses: 2 });
    expect(s.completedPassResults!.accuracy).toBeGreaterThan(0);
    expect(s.completedPassResults!.counts.R.perfect + s.completedPassResults!.counts.R.great + s.completedPassResults!.counts.R.good).toBe(2);
  });
});

describe('GameSession – far-away notes still light up', () => {
  it('shows the next note even when it is several seconds away', () => {
    const ft = new FakeTime();
    const s = new GameSession(makeSong([{ pitch: 60, start: 6 }]), settings({ mode: 'performance', speed: 0.5 }), { perfNow: ft.now });
    s.start();
    ft.advance(500);
    expect(s.keyTargets().get(60)?.role).toBe('now');
  });
});

describe('GameSession – long gaps and listening first', () => {
  it('skips long stretches with nothing to play', () => {
    const ft = new FakeTime();
    const song = makeSong([
      { pitch: 60, start: 0, hand: 'R' },
      { pitch: 48, start: 1, hand: 'L' },
      { pitch: 62, start: 20, hand: 'R' },
    ]);
    const s = new GameSession(song, settings({ mode: 'performance', hands: 'right', audio: 'mine' }), { perfNow: ft.now, skipGaps: true });
    s.start();
    ft.advance(2000);
    s.noteOn(60, ft.t);
    ft.advance(500);
    s.tick();
    expect(s.songTime).toBeGreaterThan(18);
    expect(s.songTime).toBeLessThan(20);
    expect(s.secondsToNextNote()).toBeLessThan(2);
  });

  it('Listen first: every note sounds and nothing is judged', () => {
    const ft = new FakeTime();
    const played: number[] = [];
    const audio: AudioSink = { scheduleNote: (p) => played.push(p), scheduleClick: () => {}, cancelScheduled: () => {} };
    const song = makeSong([
      { pitch: 60, start: 0, hand: 'R' },
      { pitch: 48, start: 0, hand: 'L' },
    ]);
    const s = new GameSession(song, settings({ mode: 'wait', hands: 'right', audio: 'mine' }), { perfNow: ft.now, audio, demo: true });
    s.start();
    ft.advance(2100);
    s.tick();
    expect(played.sort()).toEqual([48, 60]);
    expect(s.waiting).toBe(false); // nothing to wait for
    expect(s.noteState(0).status).toBe('auto');
  });
});

describe('GameSession – metronome', () => {
  it('clicks at a steady tempo, even through a pickup and a short bar', async () => {
    const { parseMusicXml } = await import('../src/importers/musicxml');
    const { readFileSync } = await import('node:fs');
    const song = parseMusicXml(readFileSync('public/songs/amazing-grace.musicxml', 'utf8')); // 3/4, 80 bpm, 1-beat pickup
    const clicks: number[] = [];
    const ft = new FakeTime();
    const audio: AudioSink = { scheduleNote: () => {}, scheduleClick: (_a, d) => clicks.push(ft.t / 1000 + d), cancelScheduled: () => {} };
    const s = new GameSession(song, settings({ mode: 'performance', audio: 'metronome', countIn: true }), { perfNow: ft.now, audio });
    s.start();
    for (let i = 0; i < 120; i++) {
      ft.advance(50);
      s.tick();
    }
    const gaps = clicks.slice(1).map((c, i) => c - clicks[i]);
    expect(clicks.length).toBeGreaterThan(6);
    for (const g of gaps) expect(g).toBeCloseTo(60 / 80, 2);
  });
});

describe('GameSession – nothing left for your hand', () => {
  it('finishes instead of sitting through the other hand (Wait mode too)', () => {
    const ft = new FakeTime();
    let done = false;
    const song = makeSong([
      { pitch: 60, start: 0, hand: 'R' },
      { pitch: 48, start: 2, hand: 'L' },
      { pitch: 50, start: 6, hand: 'L' },
    ]);
    const s = new GameSession(song, settings({ mode: 'wait', hands: 'right', audio: 'mine' }), { perfNow: ft.now, skipGaps: true, onFinish: () => (done = true) });
    s.start();
    ft.advance(2100);
    s.tick();
    s.noteOn(60, ft.t);
    for (let i = 0; i < 20; i++) {
      ft.advance(100);
      s.tick();
    }
    expect(done).toBe(true);
  });
});

describe('GameSession – backing parts', () => {
  it('never asks you to play a backing part, but plays it in Full sound', () => {
    const ft = new FakeTime();
    const played: number[] = [];
    const audio: AudioSink = { scheduleNote: (p) => played.push(p), scheduleClick: () => {}, cancelScheduled: () => {} };
    const song = makeSong([
      { pitch: 60, start: 0, hand: 'R' },
      { pitch: 76, start: 0, hand: 'R', backing: true },
    ]);
    const s = new GameSession(song, settings({ mode: 'performance', audio: 'full' }), { perfNow: ft.now, audio });
    expect(s.keyTargets().has(76)).toBe(false);
    s.start();
    ft.advance(2000);
    s.tick();
    expect(played).toContain(76);
    expect(s.noteState(1).status).toBe('auto');
  });
});

describe('GameSession – fitted notes sound where you play them', () => {
  it('plays the moved pitch, not the written one', () => {
    const ft = new FakeTime();
    const played: number[] = [];
    const audio: AudioSink = { scheduleNote: (p) => played.push(p), scheduleClick: () => {}, cancelScheduled: () => {} };
    const song = makeSong([{ pitch: 48, origPitch: 36, start: 0, hand: 'L' }]);
    const s = new GameSession(song, settings({ mode: 'performance', hands: 'left', audio: 'mine' }), { perfNow: ft.now, audio });
    s.start();
    ft.advance(2000);
    s.tick();
    expect(played).toEqual([48]);
  });
});

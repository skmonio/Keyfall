import { useEffect, useMemo, useRef, useState } from 'react';
import { GameSession, type SessionResults } from '../../engine/session';
import { sectionFor, type Calibration } from '../../engine/settings';
import { LightsDirector } from '../../midi/lightsDirector';
import { toggleNoteHand } from '../../model/hands';
import { estimateFingering } from '../../model/fingering';
import { pitchName, prefersFlats, type Song } from '../../model/song';
import { HighwayRenderer } from '../../render/highway';
import { db } from '../../storage/db';
import type { Navigate } from '../App';
import { SysexFix } from '../SysexFix';
import { KeyboardMismatch } from '../KeyboardMismatch';
import { ensureAudio, getLumi, getSettings, input, onLumiChanged, piano, updateSettings, useSettings } from '../services';
import { describeKey, SheetView, type SheetLayout } from '../../render/sheet';
import { generateMusicXml } from '../../importers/notation';
import { computeFit, lumiCanMove, type FitResult } from '../fit';
import { RecordingPlayer } from '../../audio/recording';
import { InstrumentSelect } from '../InstrumentSelect';
import { detectPosition } from '../../model/fit';
import type { LessonStep } from '../../model/lesson';

interface Hud {
  score: number;
  combo: number;
  mult: number;
  acc: number;
  bar: number;
  speed: number;
  running: boolean;
  waiting: boolean;
  passes: number;
  started: boolean;
  lastKey?: string;
  outOfRange?: string;
  progress: number;
  /** Seconds until your next note, when it's a long wait. */
  gap?: number;
  latency: number;
  stampFixes: number;
}

export function Play({ song, lesson, nav }: { song: Song; lesson?: LessonStep; nav: Navigate }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const rendererRef = useRef<HighwayRenderer | null>(null);
  const [hud, setHud] = useState<Hud>({ score: 0, combo: 0, mult: 1, acc: 0, bar: 1, speed: 1, running: false, waiting: false, passes: 0, started: false, latency: 0, stampFixes: 0, progress: 0 });
  const [toast, setToast] = useState<string>();
  const [cal, setCal] = useState<Calibration | null>();
  const [recording, setRecording] = useState<Blob | null>();
  const [editCount, setEditCount] = useState(0);
  const startedRef = useRef(false);
  const fitRef = useRef<FitResult | null>(null);
  const followingRef = useRef(false);
  const sheetHostRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<SheetView | null>(null);
  const [sessionGen, setSessionGen] = useState(0);
  const [sheetInfo, setSheetInfo] = useState<string>();
  const live = useSettings();
  // Changing "Your keyboard" (e.g. from the LUMI warning) refits the song straight away.
  const firstKeyboard = useRef(true);
  useEffect(() => {
    if (firstKeyboard.current) return void (firstKeyboard.current = false);
    setEditCount((c) => c + 1);
  }, [live.keyboard]);
  const view = live.play.view;
  const sheetOpts = live.play.sheet;
  const generatedXml = useMemo(() => {
    if (song.musicXml) return song.musicXml;
    try {
      return generateMusicXml(song);
    } catch (e) {
      console.warn('Could not generate a score', e);
      return undefined;
    }
  }, [song]);
  // Sheet music needs a score: MusicXML songs have one; for MIDI/audio it's generated.
  const inSheet = view === 'sheet' && !!generatedXml;
  const hintsRef = useRef(true);
  const resumeAfterRebuild = useRef(false);
  // "Listen first": the section plays by itself once, then it's your turn.
  const [listening, setListening] = useState(false);
  const listenRef = useRef(false);
  listenRef.current = listening;
  const restartOnRebuild = useRef(false);
  // "Find my LUMI": ask for its lowest key, so we know exactly where it is.
  const [finding, setFinding] = useState<'lowest' | 'verify'>();
  const findingRef = useRef<'lowest' | 'verify' | undefined>(undefined);
  findingRef.current = finding;
  const [findMsg, setFindMsg] = useState<string>();
  const askedRef = useRef(false);
  const octaveSentRef = useRef(false);
  const octaveMiss = useRef<{ off: number; count: number } | undefined>(undefined);
  hintsRef.current = !inSheet || sheetOpts.keyHints;
  // MIDI and audio songs have no notation: generate a readable score from their notes.
  const sheetXml = inSheet ? generatedXml : undefined;

  // Load latency calibration for the current device before building the session.
  useEffect(() => {
    db.getCalibration(input.deviceKey())
      .then((c) => setCal(c ?? null))
      .catch(() => setCal(null));
    if (song.hasRecording) db.getRecording(song.id).then((b) => setRecording(b ?? null)).catch(() => setRecording(null));
    else setRecording(null);
  }, []);

  useEffect(() => {
    if (cal === undefined || recording === undefined || !canvasRef.current) return;
    const settings = getSettings();
    const play = structuredClone(settings.play);
    play.section = sectionFor(play, song.id, song.measures.length);
    if (lesson) {
      // A guided-practice step decides the section, hands, mode and speed.
      Object.assign(play, { mode: lesson.mode, speed: lesson.speed, loop: false, speedUpOnClean: false, section: { fromMeasure: lesson.from, toMeasure: lesson.to } });
      if (!resumeAfterRebuild.current) play.hands = lesson.hands;
      else play.hands = getSettings().play.hands;
    }
    const lumi = getLumi();
    // Made even without a LUMI, so one that connects (or reconnects) mid-song lights up.
    const director = settings.lumiEnabled ? new LightsDirector(lumi, settings.colors, settings.nextColors) : undefined;
    if (lumi && settings.lumiAppMode) lumi.setMode('app');
    // Fit the song to the player's keyboard, and move the LUMI to that position.
    const lumiConnected = input.connectedInputs().some((i) => i.isLumi);
    const canMove = lumiCanMove(settings, input.sysexGranted);
    const fit = computeFit(song, settings, lumiConnected, canMove);
    fitRef.current = fit;
    followingRef.current = false;
    const timers: number[] = [];
    const detected = settings.play.keyboardPos?.songId === song.id && settings.play.keyboardPos.source === 'detected';
    if (lumi && canMove && !detected && fit.plan.lumiOctave !== undefined && lumi.setOctave(fit.plan.lumiOctave)) {
      octaveSentRef.current = true;
      updateSettings((x) => (x.lumiBase = fit.plan.lo));
      // The LUMI applies a new octave on its next repaint; lights sent before that land on the wrong keys.
      for (const ms of [150, 600]) timers.push(window.setTimeout(() => director?.resync(), ms));
    }
    // Not sure where the LUMI is (never found, or it may not be where this song needs it and we
    // haven't confirmed the app can move it)? Ask once, before starting.
    const unsure = settings.lumiBase === undefined || (settings.lumiBase !== fit.plan.lo && !canMove);
    if (lumiConnected && fit.lockView && fit.spec.lumi && unsure && !askedRef.current && !listening && !startedRef.current) {
      askedRef.current = true;
      setFindMsg(undefined);
      setFinding('lowest');
    }

    const finish = async (r: SessionResults) => {
      try {
        await db.addResult(r);
      } catch (e) {
        console.warn('Could not save result', e);
      }
      nav({ name: 'results', song, results: r, lesson });
    };

    // Songs imported from audio can use the original recording as the backing track.
    // Wait mode stops and starts the music at every chord, so it keeps the synthesised piano.
    const rec = recording && play.useRecording && play.mode === 'performance' && play.audio === 'full' ? new RecordingPlayer(recording) : undefined;

    const prev = sessionRef.current;
    if (listening) play.audio = 'full';
    const session = new GameSession(fit.song, play, {
      demo: listening,
      skipGaps: true,
      audio: piano,
      // With key hints off (sheet reading practice) the LUMI only flashes hits and mistakes.
      lights:
        listening || !director
          ? undefined
          : {
              setTargets: (m) => director.setTargets(hintsRef.current ? m : new Map()),
              flash: (p, k) => director.flash(p, k),
            },
      inputLatencyMs: cal?.inputLatencyMs ?? 0,
      audioLatencyMs: cal?.audioLatencyMs ?? piano.outputLatencyMs(),
      muteScore: !!rec,
      onFinish: listening
        ? () => {
            restartOnRebuild.current = true;
            setToast('Your turn! Press Start when you are ready.');
            setTimeout(() => setToast(undefined), 2500);
            startedRef.current = false;
            setListening(false);
          }
        : finish,
      onLoop: (pass, clean, speed) => {
        setToast(clean ? `Clean run ${pass}!${play.speedUpOnClean ? ` Speed → ${Math.round(speed * 100)}%` : ''}` : `Run ${pass} done. Go again!`);
        if (play.speedUpOnClean) updateSettings((s) => (s.play.speed = speed));
        setTimeout(() => setToast(undefined), 1800);
      },
    });
    // After a hand edit or hand switch, keep the position (and keep playing if we were).
    if (prev && !restartOnRebuild.current) session.seekTo(prev.songTime);
    restartOnRebuild.current = false;
    if (prev && resumeAfterRebuild.current && startedRef.current) session.start();
    resumeAfterRebuild.current = false;
    if (listening) {
      startedRef.current = true;
      session.start();
    }
    sessionRef.current = session;
    // Handy for debugging and scripted testing in dev builds only.
    if (import.meta.env.DEV) Object.assign(window, { __keyfall: session, __keyfallRec: rec });
    piano.keySoundOn = settings.keySound;

    const renderer = new HighwayRenderer(canvasRef.current, session, highwayTheme(), fit.lockView ? [fit.plan.lo, fit.plan.hi] : undefined);
    rendererRef.current = renderer;
    setSessionGen((g) => g + 1);

    const offKey = input.onKey((e) => {
      if (findingRef.current && e.type === 'on' && e.source === 'midi') {
        onFindPress(e.pitch, fit);
        return;
      }
      // A small keyboard can only send notes inside its own range, so a note outside the
      // position we assumed means the keyboard is somewhere else: follow it.
      if (e.type === 'on' && e.source === 'midi' && fit.lockView) {
        const lo = detectPosition(e.pitch, fit.spec, fit.plan.lo);
        if (lo !== undefined && !followingRef.current) {
          followingRef.current = true;
          const sent = octaveSentRef.current;
          updateSettings((x) => {
            x.play.keyboardPos = { songId: song.id, lo, source: 'detected' };
            x.lumiBase = lo;
            // We told the LUMI to move and it didn't: stop relying on that.
            if (sent && fit.spec.lumi) x.lumiOctaveWorks = false;
          });
          setToast(`Your ${fit.spec.lumi ? 'LUMI' : 'keyboard'} is at ${pitchName(lo)}–${pitchName(lo + fit.spec.keys - 1)}. The screen now matches it.`);
          setTimeout(() => setToast(undefined), 2500);
          setEditCount((c) => c + 1);
          return;
        }
      }
      // The LUMI can be on another octave than we think (its octave buttons, or it restarted),
      // which also puts its lights out of reach. Playing the right note an octave (or two) away
      // twice in a row gives it away: shift the screen and lights to match.
      if (e.type === 'on' && e.source === 'midi' && fit.lockView && !followingRef.current) {
        const targets = [...session.keyTargets()].filter(([, v]) => v.role === 'now').map(([p]) => p);
        if (targets.length && !targets.includes(e.pitch)) {
          const off = targets.map((p) => e.pitch - p).find((d) => d !== 0 && d % 12 === 0 && Math.abs(d) <= 36);
          const o = octaveMiss.current;
          if (off !== undefined && o?.off === off) o.count++;
          else octaveMiss.current = off !== undefined ? { off, count: 1 } : undefined;
          if (octaveMiss.current && octaveMiss.current.count >= 2) {
            const lo = fit.plan.lo + octaveMiss.current.off;
            octaveMiss.current = undefined;
            if (lo >= 12 && lo + fit.spec.keys - 1 <= 120) {
              followingRef.current = true;
              updateSettings((x) => {
                x.play.keyboardPos = { songId: song.id, lo, source: 'detected' };
                x.lumiBase = lo;
              });
              setToast(`Your ${fit.spec.lumi ? 'LUMI' : 'keyboard'} seems to be at ${pitchName(lo)}–${pitchName(lo + fit.spec.keys - 1)}. The screen and lights now match it.`);
              setTimeout(() => setToast(undefined), 3000);
              setEditCount((c) => c + 1);
              return;
            }
          }
        } else if (targets.includes(e.pitch)) octaveMiss.current = undefined;
      }
      if (e.type === 'on') {
        session.noteOn(e.pitch, e.time);
        piano.keyDown(e.pitch, e.velocity);
      } else {
        session.noteOff(e.pitch);
        piano.keyUp(e.pitch);
      }
    });

    let raf = 0;
    let lastHud = 0;
    let errors = 0;
    const frame = () => {
      const now = performance.now();
      try {
        session.tick();
        rec?.sync(session.songTime, session.rate, session.running && !session.finished);
        renderer.draw(now);
        sheetRef.current?.update(session);
      } catch (e) {
        // Never let one bad frame stop the game loop.
        if (errors++ < 5) console.error('frame error', e);
      }
      if (now - lastHud > 90) {
        lastHud = now;
        setHud({
          score: session.scorer.score,
          combo: session.scorer.combo,
          mult: session.scorer.multiplier,
          acc: session.scorer.accuracy(),
          bar: song.measures[session.currentMeasure]?.number ?? 1,
          progress: Math.max(0, Math.min(1, (session.songTime - session.rangeStart) / Math.max(0.01, session.rangeEnd - session.rangeStart))),
          speed: session.rate,
          running: session.running,
          waiting: session.waiting,
          passes: session.loopPasses,
          started: startedRef.current,
          lastKey: input.stats.last ? `${pitchName(input.stats.last.pitch)} (${input.stats.last.source})` : undefined,
          latency: Math.round(session.inputLatencyMs),
          stampFixes: input.stats.correctedStamps,
          outOfRange: outOfRangeHint(input.stats.last, fitRef.current, now),
          gap: !listenRef.current && session.running && session.secondsToNextNote() > 4 && session.secondsToNextNote() !== Infinity ? session.secondsToNextNote() : undefined,
        });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Only re-layout when the canvas really changed size (a re-layout clears the canvas).
    let lastSize = '';
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      const size = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : '';
      if (size === lastSize) return;
      lastSize = size;
      renderer.resize();
    });
    ro.observe(canvasRef.current);

    // A LUMI that reconnects (or switches between Bluetooth and USB) comes back in its own
    // colours and octave: take it over again and relight the keys.
    const offLumi = onLumiChanged(() => {
      const l = getLumi();
      const s = getSettings();
      if (l && s.lumiAppMode) l.setMode('app');
      if (l && lumiCanMove(s, input.sysexGranted) && fit.plan.lumiOctave !== undefined && l.setOctave(fit.plan.lumiOctave)) {
        timers.push(window.setTimeout(() => director?.resync(), 300));
      }
      director?.setLights(l);
    });

    return () => {
      offLumi();
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      rec?.dispose();
      ro.disconnect();
      offKey();
      session.pause();
      // A loop never "finishes": when you leave (or switch hands), save the completed passes.
      if (!listening && !session.finished && session.completedPassResults) {
        db.addResult(session.completedPassResults).catch((e) => console.warn('Could not save loop result', e));
      }
      director?.clear();
      piano.cancelScheduled();
    };
  }, [cal, recording, song, editCount, listening]);

  // The sheet-music view: built for the current session, rebuilt when its options change.
  useEffect(() => {
    const host = sheetHostRef.current;
    const session = sessionRef.current;
    if (!inSheet || !host || !session || !sheetXml) return;
    const sv = new SheetView(host, session.song, sheetXml, {
      layout: sheetOpts.layout,
      zoom: sheetOpts.zoom,
      showFingers: getSettings().play.showFingers,
      showNames: getSettings().play.showNoteNames,
      colors: getSettings().colors,
      nextColors: getSettings().nextColors,
    });
    let alive = true;
    sv.init()
      .then(() => {
        if (!alive) return;
        sheetRef.current = sv;
        if (import.meta.env.DEV) Object.assign(window, { __sheet: sv });
        const moved = session.song.notes.some((n) => n.origPitch !== undefined);
        setSheetInfo(
          [
            describeKey(sv.keyFifths),
            !song.musicXml && song.sourceKind !== 'exercise' ? `Score generated from the ${song.sourceKind === 'audio' ? 'recording' : 'MIDI file'}, so it's a simplified reading of the notes.` : '',
            moved ? 'Some notes are moved an octave to fit your keyboard: the score shows where they are written.' : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      })
      .catch((e) => setSheetInfo(`Could not show the score: ${(e as Error).message}`));
    // Line breaks depend on the width, so re-render when it changes.
    let lastW = host.clientWidth;
    let t = 0;
    const ro = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - lastW) < 20) return;
      lastW = host.clientWidth;
      clearTimeout(t);
      t = window.setTimeout(() => sheetRef.current?.render(), 200);
    });
    ro.observe(host);
    return () => {
      alive = false;
      ro.disconnect();
      clearTimeout(t);
      sheetRef.current = null;
      sv.dispose();
    };
  }, [inSheet, sheetXml, sheetOpts.layout, sheetOpts.zoom, sessionGen]);

  // Falling notes and key hints follow the view settings.
  function highwayTheme() {
    const st = getSettings();
    const sheet = st.play.view === 'sheet';
    return {
      colors: st.colors,
      nextColors: st.nextColors,
      showFingers: st.play.showFingers,
      lookAheadSec: st.play.lookAheadSec,
      hints: !sheet || st.play.sheet.keyHints,
      highway: !sheet || st.play.sheet.showFalling,
      // Practising one hand: the other hand is hidden (it may still be auto-played).
      // While listening first, everything is shown.
      showOtherHand: st.play.hands === 'both' || listenRef.current,
      listen: listenRef.current,
      noteNames: st.play.showNoteNames,
      flats: prefersFlats(song),
    };
  }
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.theme = highwayTheme();
    r.rezoom(fitRef.current?.lockView ? [fitRef.current.plan.lo, fitRef.current.plan.hi] : undefined);
    sheetRef.current?.setShowFingers(getSettings().play.showFingers);
    sheetRef.current?.setShowNames(getSettings().play.showNoteNames);
  }, [view, sheetOpts.keyHints, sheetOpts.showFalling, live.play.showFingers, live.play.showNoteNames, listening, sessionGen]);

  // Change hands mid-song: rebuild the session at the same place (the score starts again).
  // Switch practice/perform mid-song: rebuild at the same place, and keep playing if we were.
  const switchMode = (m: 'wait' | 'performance') => {
    if (listening) {
      updateSettings((x) => (x.play.mode = m));
      toggleListen(false);
      return;
    }
    if (m === getSettings().play.mode) return;
    const wasRunning = sessionRef.current?.running;
    sessionRef.current?.pause();
    updateSettings((x) => (x.play.mode = m));
    resumeAfterRebuild.current = !!wasRunning;
    setEditCount((c) => c + 1);
  };
  // Listen on/off from here (unlike "Listen first", which starts from the beginning).
  const toggleListen = async (on: boolean) => {
    await ensureAudio();
    const wasRunning = sessionRef.current?.running;
    restartOnRebuild.current = false;
    resumeAfterRebuild.current = !on && !!wasRunning;
    if (!on) startedRef.current = true;
    setListening(on);
  };

  const switchHands = (h: 'left' | 'both' | 'right') => {
    if (h === getSettings().play.hands) return;
    const wasRunning = sessionRef.current?.running;
    sessionRef.current?.pause();
    updateSettings((x) => (x.play.hands = h));
    resumeAfterRebuild.current = !!wasRunning;
    setEditCount((c) => c + 1);
  };

  // Scrub the sheet: drag the scrolling line (mouse or finger), or tap a bar to jump there.
  const drag = useRef<{ x: number; lastX: number; moved: boolean; wasRunning: boolean; id: number } | null>(null);
  // Paused by scrubbing the sheet: show a small Play button, not the big pause box.
  const [quietPause, setQuietPause] = useState(false);
  const onSheetDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = sessionRef.current;
    if (!s || !sheetRef.current) return;
    drag.current = { x: e.clientX, lastX: e.clientX, moved: false, wasRunning: s.running, id: e.pointerId };
    if (sheetOpts.layout === 'scroll') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* not every pointer can be captured; dragging still works while over the sheet */
      }
    }
  };
  const onSheetMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const s = sessionRef.current;
    const sv = sheetRef.current;
    if (!d || !s || !sv || d.id !== e.pointerId || sheetOpts.layout !== 'scroll') return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 6) return;
    if (!d.moved) {
      d.moved = true;
      setQuietPause(true);
      s.pause();
    }
    // Keep the music under your finger: what was just left of the playhead comes to it as you drag right.
    const delta = e.clientX - d.lastX;
    d.lastX = e.clientX;
    const box = e.currentTarget.getBoundingClientRect();
    const hit = sv.timeAt(sv.playheadClientX() - delta, box.top + box.height / 2, s.songTime);
    if (hit) {
      s.seekTo(Math.max(s.rangeStart - s.leadIn, Math.min(s.rangeEnd, hit.t)));
      s.seeked = true;
    }
  };
  const onSheetUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    const s = sessionRef.current;
    const sv = sheetRef.current;
    if (!d || !s || !sv || d.id !== e.pointerId) return;
    if (!d.moved) {
      // A tap: jump to the start of that bar.
      const hit = sv.timeAt(e.clientX, e.clientY, s.songTime);
      if (hit) s.seekToMeasure(hit.measure);
      return;
    }
    if (d.wasRunning) {
      s.start();
      setQuietPause(false);
    }
  };

  const setSheet = (fn: (sh: typeof sheetOpts) => void) => updateSettings((x) => fn(x.play.sheet));

  // Restore the LUMI's own colours when leaving the play screen.
  useEffect(
    () => () => {
      const s = getSettings();
      const lumi = getLumi();
      if (lumi && s.lumiAppMode) lumi.setMode(s.lumiRestoreMode);
    },
    [],
  );

  /** A key pressed while finding the LUMI: its lowest key tells us exactly where it is. */
  function onFindPress(pitch: number, fit: FitResult) {
    const phase = findingRef.current;
    if (pitch % 12 !== 0) {
      setFindMsg(`That was ${pitchName(pitch)}. Please press the very lowest key on the left (it's a C).`);
      return;
    }
    const base = pitch;
    const s = getSettings();
    const wanted = fit.plan.lo;
    const lumi = getLumi();
    const done = (msg: string, useBase: boolean) => {
      setFinding(undefined);
      setFindMsg(undefined);
      updateSettings((x) => {
        x.lumiBase = base;
        if (useBase && base !== wanted) x.play.keyboardPos = { songId: song.id, lo: base, source: 'detected' };
      });
      setToast(msg);
      setTimeout(() => setToast(undefined), 3500);
      if (useBase && base !== wanted) setEditCount((c) => c + 1);
    };
    const range = (lo: number) => `${pitchName(lo)}–${pitchName(lo + 23)}`;
    if (phase === 'verify') {
      if (base === wanted) {
        updateSettings((x) => (x.lumiOctaveWorks = true));
        done(`Your LUMI moved to ${range(base)}. From now on it will move by itself for each song.`, false);
      } else {
        updateSettings((x) => (x.lumiOctaveWorks = false));
        done(`Your LUMI stayed at ${range(base)}, so songs will be fitted to where it is. If you use its octave buttons, just play: the screen follows your keys.`, true);
      }
      return;
    }
    if (base === wanted) return done(`Your LUMI is at ${range(base)}: just right for this song.`, false);
    // Try moving it once, to learn whether this LUMI obeys the octave command.
    if (lumi && input.sysexGranted && s.lumiAutoOctave && s.lumiOctaveWorks !== false && fit.plan.lumiOctave !== undefined && lumi.setOctave(fit.plan.lumiOctave)) {
      octaveSentRef.current = true;
      setFindMsg(`Your LUMI is at ${range(base)}. I've asked it to move to ${range(wanted)} for this song. Press its lowest key once more.`);
      setFinding('verify');
      return;
    }
    done(
      `Your LUMI is at ${range(base)}, so the song is fitted to it. To play it as written instead, press the LUMI's octave ${wanted < base ? '▼' : '▲'} button ${Math.abs(wanted - base) / 12}× and play: the screen follows your keys.`,
      true,
    );
  }

  const start = async () => {
    await ensureAudio();
    startedRef.current = true;
    sessionRef.current?.start();
    setQuietPause(false);
  };
  // Whether the music is really running right now (the HUD numbers refresh a little later).
  const runningNow = sessionRef.current?.running ?? hud.running;
  const listenFirst = async () => {
    await ensureAudio();
    restartOnRebuild.current = true;
    setListening(true);
  };
  const stopListening = () => {
    restartOnRebuild.current = true;
    startedRef.current = false;
    setListening(false);
  };
  const toggle = () => {
    const s = sessionRef.current;
    if (!s) return;
    if (!startedRef.current || !s.running) start();
    else s.pause();
  };
  const restart = () => {
    sessionRef.current?.restart();
    start();
  };
  const exit = () => nav({ name: 'setup', song });
  const setSpeed = (v: number) => {
    sessionRef.current?.setSpeed(v);
    updateSettings((s) => (s.play.speed = sessionRef.current?.rate ?? v));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.code === 'Escape') exit();
      else if (e.code === 'Minus') setSpeed((sessionRef.current?.rate ?? 1) - 0.05);
      else if (e.code === 'Equal') setSpeed((sessionRef.current?.rate ?? 1) + 0.05);
      else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) restart();
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        sessionRef.current?.seekBars(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        sessionRef.current?.seekBars(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // While paused, click a note to move it to the other hand.
  const onCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = sessionRef.current;
    const r = rendererRef.current;
    if (!s || !r || s.running) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const n = r.noteAt(e.clientX - rect.left, e.clientY - rect.top);
    if (!n) return;
    toggleNoteHand(song, n.id);
    estimateFingering(song.notes);
    await db.saveSong(song);
    setToast(`Note moved to the ${song.notes.find((x) => x.id === n.id)?.hand === 'L' ? 'left' : 'right'} hand (score reset)`);
    setTimeout(() => setToast(undefined), 1800);
    setEditCount((c) => c + 1);
  };

  const s = getSettings().play;
  const sec = sectionFor(s, song.id, song.measures.length);
  const bars = song.measures.slice(sec?.fromMeasure ?? 0, (sec?.toMeasure ?? song.measures.length - 1) + 1);
  return (
    <div className="play">
      {lesson && (
        <div className="lesson-banner">
          <b>Step:</b> {lesson.group} · {lesson.title} · goal <b>{Math.round(lesson.goal * 100)}%</b> accuracy
        </div>
      )}
      <div className="hud">
        <button onClick={exit}>✕</button>
        <div className="stat">
          <small>Score</small>
          <b>{hud.score.toLocaleString()}</b>
        </div>
        <div className="stat">
          <small>Combo</small>
          <b>
            {hud.combo} {hud.mult > 1 && <span className="mult">×{hud.mult}</span>}
          </b>
        </div>
        <div className="stat">
          <small>Accuracy</small>
          <b>{Math.round(hud.acc * 100)}%</b>
        </div>
        <div className="stat">
          <small>Bar</small>
          <b>{hud.bar}</b>
        </div>
        {s.loop && (
          <div className="stat">
            <small>Loop runs</small>
            <b>{hud.passes}</b>
          </div>
        )}
        <div className="spacer" />
        <div className="seg" title="How to show the music">
          <button className={!inSheet ? 'on' : ''} onClick={() => updateSettings((x) => (x.play.view = 'falling'))}>Falling notes</button>
          {generatedXml && <button className={inSheet ? 'on' : ''} onClick={() => updateSettings((x) => (x.play.view = 'sheet'))}>Sheet music</button>}
        </div>
        {inSheet && (
          <>
            <select value={sheetOpts.layout} onChange={(e) => setSheet((sh) => (sh.layout = e.target.value as SheetLayout))} title="Sheet layout">
              <option value="scroll">One scrolling line</option>
              <option value="lines">Two lines</option>
              <option value="page">Whole sheet</option>
            </select>
            <button onClick={() => setSheet((sh) => (sh.zoom = Math.max(0.5, +(sh.zoom - 0.1).toFixed(2))))} title="Smaller notes">A−</button>
            <button onClick={() => setSheet((sh) => (sh.zoom = Math.min(2, +(sh.zoom + 0.1).toFixed(2))))} title="Bigger notes">A+</button>
            <label className="row small" style={{ gap: 4 }} title="Show which keys to press on the keyboard and the LUMI">
              <input type="checkbox" checked={sheetOpts.keyHints} onChange={(e) => setSheet((sh) => (sh.keyHints = e.target.checked))} /> Key hints
            </label>
            <label className="row small" style={{ gap: 4 }}>
              <input type="checkbox" checked={sheetOpts.showFalling} onChange={(e) => setSheet((sh) => (sh.showFalling = e.target.checked))} /> Falling notes
            </label>
          </>
        )}
        <div className="seg" title="Practice: the notes wait for you. Perform: the music keeps going. Listen: hear how it sounds.">
          <button className={!listening && live.play.mode === 'wait' ? 'on' : ''} onClick={() => switchMode('wait')} disabled={!!lesson}>Practice</button>
          <button className={!listening && live.play.mode === 'performance' ? 'on' : ''} onClick={() => switchMode('performance')} disabled={!!lesson}>Perform</button>
          <button className={listening ? 'on' : ''} onClick={() => toggleListen(!listening)}>🎧 Listen</button>
        </div>
        <div className="seg" title="Which hand(s) you play. Switch any time: you stay at the same place in the music.">
          {(['left', 'both', 'right'] as const).map((h) => (
            <button key={h} className={live.play.hands === h ? 'on' : ''} onClick={() => switchHands(h)}>
              {h === 'left' ? 'Left' : h === 'both' ? 'Both' : 'Right'}
            </button>
          ))}
        </div>
        <div className="seg" title="Full: the whole song · My hand: just your part as a guide · Metro: clicks · Silent: only the keys you press">
          {(
            [
              ['full', 'Full'],
              ['mine', 'My hand'],
              ['metronome', 'Metro'],
              ['silent', 'Silent'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={live.play.audio === v ? 'on' : ''}
              onClick={() => {
                updateSettings((x) => (x.play.audio = v));
                sessionRef.current?.setAudioMode(v);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <InstrumentSelect />
        <label className="row small" style={{ gap: 4 }} title="Also show the note after the one to play now (faded on screen, and on the LUMI)">
          <input
            type="checkbox"
            checked={live.play.showNextNotes}
            onChange={(e) => {
              const v = e.target.checked;
              updateSettings((x) => (x.play.showNextNotes = v));
              if (sessionRef.current) sessionRef.current.settings.showNextNotes = v; // takes effect immediately
            }}
          />{' '}
          Next notes
        </label>
        <label className="row small" style={{ gap: 4 }} title="Note names (C, D, E♭ …) on the keys, the falling notes and the sheet music">
          <input type="checkbox" checked={live.play.showNoteNames} onChange={(e) => updateSettings((x) => (x.play.showNoteNames = e.target.checked))} /> Note names
        </label>
        <label className="row small" style={{ gap: 4 }} title="Finger numbers on the falling notes and the sheet music">
          <input type="checkbox" checked={live.play.showFingers} onChange={(e) => updateSettings((x) => (x.play.showFingers = e.target.checked))} /> Finger numbers
        </label>
        <div className="row small">
          Speed
          <input type="range" min={25} max={150} step={5} value={Math.round(hud.speed * 100)} onChange={(e) => setSpeed(Number(e.target.value) / 100)} />
          <b style={{ width: 40 }}>{Math.round(hud.speed * 100)}%</b>
        </div>
        <button onClick={() => sessionRef.current?.seekBars(-1)} title="Back a bar (←)">⏮</button>
        <button onClick={() => sessionRef.current?.seekBars(1)} title="Forward a bar (→)">⏭</button>
        <button onClick={restart} title="Restart (R)">↺</button>
        <button className="primary" onClick={toggle} title="Play / pause (Space)">
          {hud.running ? '❚❚' : '▶'}
        </button>
      </div>
      <Progress
        progress={hud.progress}
        bars={bars}
        onSeek={(i) => sessionRef.current?.seekToMeasure(i)}
      />
      <SysexFix compact />
      <KeyboardMismatch compact />
      <div className="play-body">
        {/* Things that come and go during a song float here, so the toolbar never changes size
            (a changing toolbar resizes the canvas, which made the notes stutter). */}
        <div className="play-status">
          {hud.waiting && <span className="pill warn">Waiting for you…</span>}
          {quietPause && hud.started && !hud.running && (
            <button className="primary" onClick={() => start()} title="Play from here (Space)">
              ▶ Play from here
            </button>
          )}
          {listening && (
            <>
              <span className="pill ok">🎧 Listening first…</span>
              <button onClick={stopListening}>Stop listening</button>
            </>
          )}
          {hud.gap !== undefined && (
            <button onClick={() => sessionRef.current?.skipToNextNote()} title="Jump to just before your next note">
              ⏭ Skip to my next note ({Math.round(hud.gap)}s)
            </button>
          )}
          {hud.outOfRange && <span className="pill bad">{hud.outOfRange}</span>}
          {hud.lastKey && (
            <span className="pill" title={`Input latency correction: ${hud.latency} ms${hud.stampFixes ? ` · ${hud.stampFixes} bad MIDI timestamps corrected` : ''}`}>
              Last key: {hud.lastKey}
              {hud.stampFixes > 0 && ' · clock fixed'}
            </span>
          )}
        </div>
        {inSheet && (
          <div
            className={`sheet-area layout-${sheetOpts.layout} ${sheetOpts.showFalling ? '' : 'fill'}`}
            onPointerDown={onSheetDown}
            onPointerMove={onSheetMove}
            onPointerUp={onSheetUp}
            onPointerCancel={onSheetUp}
            style={{ touchAction: sheetOpts.layout === 'scroll' ? 'none' : 'pan-y', cursor: sheetOpts.layout === 'scroll' ? 'grab' : 'pointer' }}
            title={sheetOpts.layout === 'scroll' ? 'Drag to move through the music, or tap a bar to jump to it' : 'Tap a bar to jump to it'}
          >
            <div ref={sheetHostRef} />
            {sheetInfo && <div className="sheet-info small">{sheetInfo}</div>}
          </div>
        )}
        <div className="canvas-wrap" style={inSheet ? { flex: sheetOpts.showFalling ? '1 1 45%' : '0 0 150px' } : undefined}>
          <canvas ref={canvasRef} onClick={onCanvasClick} style={{ cursor: hud.running ? 'default' : 'pointer' }} />
        </div>
        {finding && (
          <div className="overlay">
            <div className="box col">
              <h2>📍 Where is your LUMI?</h2>
              <div>
                {finding === 'lowest' ? 'Press the lowest key on your LUMI (the C at the far left).' : 'Press the lowest key on your LUMI again.'}
              </div>
              {findMsg && <div className="small" style={{ color: 'var(--warn)' }}>{findMsg}</div>}
              <div className="small muted">
                This song needs {fitRef.current ? `${pitchName(fitRef.current.plan.lo)}–${pitchName(fitRef.current.plan.hi)}` : 'a certain octave'}. KeyFall uses your answer to match the screen to your keys.
              </div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button onClick={() => setFinding(undefined)}>Skip</button>
              </div>
            </div>
          </div>
        )}
        {!runningNow && !finding && !(quietPause && hud.started) && (
          <div className="overlay">
            <div className="box col">
              {!hud.started ? (
                <>
                  <h2>{song.title}</h2>
                  <div className="muted small">
                    {s.mode === 'wait' ? 'The notes wait for you at each chord.' : 'The music keeps going: stay in time!'} Space = play/pause,{' '}
                    <span className="kbd">-</span>/<span className="kbd">=</span> speed, <span className="kbd">←</span>/<span className="kbd">→</span> bar back/forward, R = restart, Esc = exit.
                  </div>
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="primary" onClick={start}>Start</button>
                    <button onClick={listenFirst} title="Hear it played first (all notes, with the falling notes), then it's your turn">
                      🎧 Listen first
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Paused</h2>
                  {(!inSheet || sheetOpts.showFalling) && <div className="muted small">Click a falling note to move it to the other hand.</div>}
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <button className="primary" onClick={start}>Resume</button>
                    <button onClick={restart}>Restart</button>
                    {!listening && <button onClick={listenFirst}>🎧 Listen</button>}
                    <button onClick={exit}>Exit</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {toast && (
          <div className="overlay" style={{ alignItems: 'flex-start', paddingTop: 30 }}>
            <div className="box">{toast}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** If the last key pressed is outside the keyboard position, say how to move the keyboard. */
function outOfRangeHint(last: { pitch: number; at: number } | undefined, fit: FitResult | null, now: number): string | undefined {
  if (!last || !fit || !fit.lockView || now - last.at > 4000) return undefined;
  const { lo, hi } = fit.plan;
  if (last.pitch >= lo && last.pitch <= hi) return undefined;
  const octaves = last.pitch < lo ? Math.ceil((lo - last.pitch) / 12) : Math.ceil((last.pitch - hi) / 12);
  const dir = last.pitch < lo ? 'up' : 'down';
  const btn = fit.spec.lumi ? `press the LUMI's octave ${dir === 'up' ? '▲' : '▼'} button ${octaves}×` : `shift your keyboard ${dir} ${octaves} octave${octaves > 1 ? 's' : ''}`;
  return `${pitchName(last.pitch)} is outside ${pitchName(lo)}–${pitchName(hi)}: ${btn}`;
}

/** Song progress with one tick per bar. Click a bar to jump there. */
function Progress({ progress, bars, onSeek }: { progress: number; bars: Song['measures']; onSeek: (index: number) => void }) {
  if (!bars.length) return null;
  const start = bars[0].start;
  const total = bars[bars.length - 1].start + bars[bars.length - 1].duration - start;
  return (
    <div className="progress" title="Click a bar to jump to it">
      <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      {bars.map((m) => (
        <button
          key={m.index}
          className="progress-bar"
          style={{ left: `${((m.start - start) / total) * 100}%`, width: `${(m.duration / total) * 100}%` }}
          onClick={() => onSeek(m.index)}
          title={`Bar ${m.number}`}
        >
          {bars.length <= 40 || m.number % 4 === 1 ? m.number : ''}
        </button>
      ))}
    </div>
  );
}

# KeyFall

A rhythm-game piano trainer (think Guitar Hero / Rock Band) for **ROLI LUMI Keys** and any MIDI keyboard.
Load sheet music, and notes fall toward an on-screen keyboard in each hand's colour. Hit the right key in time.
On a LUMI, the keys you need to press next light up.

- **Import:** MusicXML (`.musicxml`, `.mxl`, `.xml`), MIDI (`.mid`), audio (MP3, WAV, M4A, OGG, FLAC) through in-browser transcription. PDFs and photos of sheet music aren't read; convert them to MusicXML first (see below).
- **One colour scheme everywhere:** each hand has a **play now** colour and a **next note** colour (right: blue / cyan, left: orange / yellow). The on-screen keyboard, the sheet-music highlights and the LUMI's keys all show the same notes in the same colours. The colours are taken from the LUMI's palette, so they match exactly; you can change them in Settings, and any colour you pick snaps to one the LUMI can show. "Now" is the chord being waited for (Wait mode) or each hand's next chord (Performance), shown solid with an outline; "next" is the chord after it, shown faded. Next-note hints are off by default; tick **Next notes** (play toolbar) or **Show next notes** (setup) to show them, on screen and on the LUMI.
- **Rename songs** from the library (Rename) or the song's setup screen (✎ Rename). A held key shows your hand's colour when it's right and red when it's wrong. When you practise one hand, the other hand is hidden and the keyboard zooms to your hand's range. Switch **Left / Both / Right** in the play toolbar at any time: the song carries on from the same place (the score for the run starts again).
- **Hands and fingering:** treble staff = right hand, bass staff = left hand. You can override this per section, by split point, or per note (pause, then click the note). Fingering comes from the score if it has any, and is estimated otherwise.
- **Modes:** Wait (the music stops at each chord until you play it), Performance (the music keeps going), Free play (the music moves along and you play with it, nothing judged or scored, just like reading sheet music; it stops back at the start when it ends), left / right / both hands with optional auto-play of the other hand, A–B loops with an optional +5% speed-up after each clean run, 25–150% speed without pitch change, and four audio modes.
- **Scoring:** Perfect / Great / Good / Miss (±40 / 80 / 120 ms, adjustable), combo, ×2/×3/×4 multiplier, accuracy, 1–5 stars, per-hand stats, the bars with the most errors, and personal bests.
- **LUMI lights:** upcoming notes glow in the hand colour, a correct hit flashes white and a wrong key flashes red. There's a LUMI test screen to check the lights.
- **Latency calibration:** tap-along tests, stored per device.
- Everything is stored locally in IndexedDB. There is no backend.

## Setup

Requirements: Node 20+ and **Chrome or Edge on desktop**, the browsers that support Web MIDI with SysEx.

```bash
cd keyfall
npm install
npm start            # http://localhost:5173, opens the browser (or double-click KeyFall.command on the Desktop)
```

**Online, nothing to install:** KeyFall is published with GitHub Pages at **https://skmonio.github.io/Keyfall/**. Open it in Chrome or Edge on any computer (plug the LUMI in by USB and allow MIDI when asked). Every push to `main` runs the tests, rebuilds and republishes it (`.github/workflows/pages.yml`); the one-time setup is repo **Settings → Pages → Source: GitHub Actions**. Songs, progress and settings are stored per site, so the online copy and a local copy each keep their own.

**One-click start:** double-click **KeyFall.command** (Mac) or **KeyFall.bat** (Windows) in this folder. It installs what's needed the first time, starts KeyFall at http://localhost:5173 and opens the browser; close the window to stop it.

**On another computer:** clone the repo, then use the launcher above (Node.js 20+ needed: https://nodejs.org). Your imported songs, progress and settings live in the browser on each computer, so they don't come along; re-import songs there, and allow the LUMI permission again. On Windows, connect the LUMI with a USB cable (browsers on Windows usually can't see Bluetooth MIDI devices).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (importers, timing judge, session/modes, fingering, LUMI encoding) |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run make-samples` | Regenerate the bundled test pieces in `public/songs/` |

Web MIDI only works in a secure context. `localhost` is fine. If you host the built app anywhere else, serve it over **https**.

The first time the app opens, Chrome asks for permission to **"control and reprogram your MIDI devices"**. That is the SysEx permission. Allow it if you want the app to change the LUMI's own colour mode. Key lighting and playing both work without it.

### Bundled songs (public domain)

- **Ode to Joy** (Beethoven): MusicXML, both hands. Bars 1–8 have fingering in the score and bars 9–16 are estimated by the app.
- **Twinkle Twinkle Little Star** (traditional): a 2-track MIDI file, to exercise the MIDI importer.
- **Minuet in G** (Petzold, simplified left hand): MusicXML in 3/4 with F♯s.
- **Au clair de la lune** (traditional), with a repeat sign.
- **Hot Cross Buns**, **Frère Jacques**, **London Bridge**, **Yankee Doodle**, **Old MacDonald Had a Farm** and **Row, Row, Row Your Boat** (6/8), all traditional.
- **Mary Had a Little Lamb** (traditional), with fingering.
- **Jingle Bells** (chorus; J. L. Pierpont, 1857).
- **Amazing Grace** (traditional melody "New Britain"), in 3/4 with a pickup.
- **Canon in D** (Pachelbel, simplified): the famous bass line with the opening melody.
- **Für Elise** (Beethoven), the opening, in 3/8 with a pickup.
- **Prelude in C, BWV 846** (Bach), bars 1–8.

A test checks that every bar of every bundled score has the right number of beats in both hands.

## Connecting a LUMI Keys

### USB
Plug it in. It appears as a MIDI input and output called something like "LUMI Keys BLOCK". The badge in the top bar turns green ("LUMI connected").

### Bluetooth MIDI on macOS
1. Switch the LUMI on.
2. Open **Audio MIDI Setup** (in Applications › Utilities), then choose **Window › Show MIDI Studio**.
3. Click the **Bluetooth** icon in the toolbar (or double-click the "Bluetooth" device). Find the LUMI in the list and click **Connect**.
4. Reload KeyFall. The LUMI shows up like a USB device.

A few ms of Bluetooth latency is normal. Run **Calibrate** once per connection type, because USB and Bluetooth are stored as separate devices.

### Bluetooth MIDI on Windows
Browser support for Bluetooth LE MIDI on Windows is limited. Options, from most to least reliable:
1. Use **USB**.
2. On Windows 11 with the new *Windows MIDI Services*, pair the LUMI in Bluetooth settings. It should then appear to Chrome.
3. Otherwise, use a bridge such as **MIDIberry + loopMIDI**. Lights may not pass through a bridge.

### Small keyboards: positioning a 24-key LUMI
A LUMI has 24 keys (14 white), but many songs span more. On each song's setup screen, the **Your keyboard** card shows an 88-key overview with the song's notes and a frame marking where your keyboard sits.
- **Keyboard size:** *Auto* means 24 keys when a LUMI is connected, otherwise 88. You can also choose 2 chained LUMIs (48), or 25, 37, 49, 61 or 88 keys.
- **Automatic position:** KeyFall picks the octave that covers the most notes. With SysEx allowed, it **moves the LUMI there itself** when you press Play (it sends the same message as the octave buttons). Otherwise it tells you, for example, "press the LUMI's octave ▲ button 1× from the default".
- **Manual position:** use **◀ Octave / Octave ▶** to move it yourself (remembered per song). **Auto position** goes back to the automatic choice.
- **Fit the song to my keyboard:** if the practised part is wider than the keyboard, whole hands are shifted by octaves and any stray notes are folded in by an octave. Where both hands then need the same key at the same time, the notes are merged. The backing track still plays the notes as written, and the setup screen lists exactly what was changed.
- **"SysEx not granted" / every key lit:** the LUMI's colour and octave commands need Chrome's "control and reprogram MIDI devices" permission. If it's missing, KeyFall shows a banner with an **Allow LUMI lights** button (choose Allow when Chrome asks). If Chrome has blocked it, click the icon left of the address bar → Site settings → MIDI device control & reprogram → Allow, then reload. The permission belongs to the exact address and port (`localhost:5173` and `localhost:5174` are different sites to Chrome), so always open KeyFall at the same address.
- **Lights check:** the LUMI test page has a step-by-step check (blank the LUMI via SysEx → light keys → try every MIDI channel → try other LUMI outputs) that ends with a report you can copy. If the LUMI ignores the blank command, the check searches for the LUMI's SysEx address (some units or Bluetooth connections don't answer to the usual 0x37): it blanks every address, then narrows it down in about 7 yes/no questions and saves the one that works. The top bar shows **No lights output** when KeyFall hears the LUMI but has no MIDI output to send lights to.
- **No key lights?** Two things put the lights out of reach, and KeyFall now catches both. (1) "Your keyboard" set to something other than Auto/LUMI while a LUMI is connected: a banner offers **Use my LUMI**. (2) The LUMI on a different octave than KeyFall thinks (its octave buttons, or it restarted): if you play the right note an octave away twice in a row, KeyFall shifts the screen and lights to where the LUMI really is. What KeyFall learnt about the LUMI's octave while SysEx was blocked is forgotten, so the next song checks it again ("press the lowest key").
- **Reconnecting:** if the LUMI drops out or reconnects another way (Bluetooth ↔ USB, or after switching it off and on), KeyFall picks up the new connection by itself, including mid-song: it takes over the lights again and moves the octave back if it can. A keyboard chosen in Settings that's no longer there no longer blocks the others.
- **Find my LUMI:** the first time (or whenever KeyFall isn't sure where your LUMI is), the play screen asks you to **press the lowest key on your LUMI**. If the song needs a different octave, KeyFall tries moving the LUMI once and asks you to press the lowest key again, which tells it whether your LUMI obeys the octave command. If it does, it's moved automatically from then on; if not, songs are fitted to wherever your LUMI is. After that it's automatic: if you move the LUMI with its own octave buttons, just play and the screen follows your keys. (One key press can't always tell on its own: a C3 is on the LUMI whether it's at C2–B3 or C3–B4, so asking for the lowest key settles it.)
- **It follows your keyboard:** a 24-key LUMI can only send notes inside its own range. So if you press a key outside the range KeyFall assumed (for example, the automatic octave move didn't happen), KeyFall works out where the LUMI really is and moves the screen to match. The setup screen then shows "Detected from your keys".
- The app resends the LUMI's lights shortly after an octave change, and every 1.5 s. The LUMI applies a new octave on its next repaint, so lights sent in between can land on the wrong key.
- While playing, the on-screen keyboard shows exactly your physical keys. If you press a key outside that range, a hint tells you which way to move.
- Tip: for wide pieces such as Minuet in G (37 keys) on one LUMI, practise hands separately. The right hand fits as written at C4–B5, and the left hand needs just one note moved.

### Chained LUMIs
Two or more LUMIs snapped together act as one wider keyboard. KeyFall zooms the on-screen keyboard to the song's range (at least 24 keys) and sends light messages for every note, so whichever LUMI covers that note lights up.

### No MIDI keyboard?
Use the computer keyboard: <kbd>A</kbd> = C, <kbd>W</kbd> = C♯, <kbd>S</kbd> = D … <kbd>K</kbd> = the next C, <kbd>;</kbd> <kbd>'</kbd> above that. <kbd>Z</kbd>/<kbd>X</kbd> shift the octave (the default is middle C).
Keys while playing: <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> back/forward one bar, <kbd>-</kbd>/<kbd>=</kbd> speed, <kbd>R</kbd> restart, <kbd>Esc</kbd> exit. You can also use the ⏮ ⏭ buttons, or click any bar in the progress strip under the toolbar. Runs where you jumped around don't count as personal bests.

## How the LUMI lights work

ROLI never documented the LUMI's LED protocol. KeyFall uses what the community has reverse-engineered, mainly [benob/LUMI-lights](https://github.com/benob/LUMI-lights) (its `SYSEX.txt` and the LUMI's default LittleFoot program). Everything is in `src/midi/lumiLights.ts` behind a `LumiLights` class:

| Method | How it works | Needs SysEx? |
| --- | --- | --- |
| `setKeyColor(note, rgb, brightness)` | A MIDI **note-on sent to the LUMI**. Its firmware lights that key using the velocity (1–127) as an index into a fixed 127-colour palette (`lumiPalette.ts`). KeyFall picks the nearest palette colour. Poly aftertouch sets per-key brightness, so "coming soon" notes are dimmer. | No |
| `clearKey(note)` / `clearAll()` | Note-off. | No |
| `setMode('app')` | SysEx: sets the LUMI's own in-scale and root key colours to black, so only the app's lights show. | Yes |
| `setMode('rainbow' \| 'single' \| 'piano' \| 'night')` | SysEx: the LUMI's built-in colour modes. The app restores one of these when you leave the game (choose which in Settings). | Yes |
| `setBrightness(%)`, `setGlobalColor(slot, rgb)` | SysEx config commands. | Yes |

The SysEx encoder is unit-tested byte for byte against the examples in `SYSEX.txt`.
If SysEx is denied, or the LUMI ignores the messages, the game carries on without them.

## Learning tools

### Guided practice ("Learn it step by step")
On a song's setup screen. Choose **Both hands**, **Right hand** or **Left hand**. The song is cut into sections of 2, 4 or 8 bars.
- **Both hands:** for each section, each hand on its own (notes wait for you, 70% speed), then both hands, then both hands in time at 70% and at full speed.
- **One hand:** the same, with that hand only: slowly (the notes wait for you), then in time at 70% and at full speed.

Every two sections are joined up, and the lesson ends with the whole song. Each step has an accuracy goal (90% in Wait mode, 85% in time). Every step you've tried shows your best score in stars (★★★★☆), and a ✓ once it's passed. The results screen shows the stars for that attempt and offers the next step. Progress is saved per song, and one-hand and two-hand lessons are kept separately.

### Progress
- **Per song** (setup screen): runs, best and latest accuracy with the trend, time practised, accuracy per run over time (hover for date, speed and mode), and a strip of the song's bars coloured by error rate over the last 10 runs. Click a bar to loop it in Wait mode.
- **Loops count too:** a loop never "finishes", so when you leave the play screen (or switch hands) the passes you completed are saved as a run, with the number of passes.
- Personal bests compare like with like: the same mode, hands and section.

### Exercises
In the library, all with standard textbook fingering:
- **Five-finger positions:** C, G (both hands together, so either hand can practise it alone).
- **Major scales:** all 12 (C, G, D, A, E, B, F♯, F, B♭, E♭, A♭, D♭).
- **Minor scales:** natural (A, E, D), harmonic (A, D, E, G, C) and A melodic.
- **Other scales:** chromatic, C major over two octaves, and C major in contrary motion.
- **Arpeggios:** C, G, F major and A, D, E minor.
- **Chords:** I–IV–V–I in C, G and F; I–V–vi–IV (the pop progression) in C and G; ii–V–I in C; 12-bar blues in C.
- **Technique:** Alberti bass; Hanon No. 1. They're normal songs, so every mode, the sheet music view, guided practice and progress tracking work with them.

### Games (one-minute rounds)
- **Note Reader:** a note appears on the staff; play it. Treble, bass or both clefs, in four levels: around middle C, every line and space, ledger lines, and sharps and flats. There's an "any octave counts" option for small keyboards.
- **Key Finder:** a note name appears (optionally with ♯/♭); find that key in any octave.
- After a wrong answer the right key lights up on screen and on the LUMI. Best scores are kept per game and setting. You can play on a MIDI keyboard, the computer keyboard, or by clicking the keys on screen.

### Practice, Perform and Listen
The play toolbar has a **Practice | Perform | 🎧 Listen** switch that works mid-song and keeps your place: *Practice* waits for you at each note, *Perform* keeps going in time, and *Listen* plays the music by itself so you can hear how a section sounds; switch back to Practice or Perform to play it yourself. (In a guided-practice step, Practice/Perform are set by the step.)

### Listen first, and skipping gaps
- **🎧 Listen first** (on the play screen before you start, and when paused): the section plays by itself once, with every note shown and heard, then it's your turn from the start.
- When you practise one hand without hearing the other (any sound except Full), long stretches where you have nothing to play (over 4 seconds) are skipped automatically; at the end, once your hand has nothing left, the run finishes. With Full sound you hear the other hand play those stretches, and a **⏭ Skip to my next note** button appears instead.

### Fixing notes (note editor)
Imported files (especially ones made by music-scanning apps) can have wrong or missing notes. On a song's setup screen, **✏️ Edit notes** opens a piano-roll editor:
- Time runs left to right with the bars marked, pitch goes up the page; notes are coloured by hand. The whole score is shown above as one scrolling line, with a blue line at the cursor (and following along while it plays). Drag the music to move through it, or tap a note to put the cursor there; the note grid scrolls to match. **Note names** labels the keys and notes (on the sheet too).
- Press on an empty spot and a new note appears under the pointer: drag it to the pitch and beat you need (you hear each pitch as you pass it) and let go. On a touchscreen, tap to add a note (a one-finger drag on empty space scrolls), then drag the note where you want it. Choose the new note's hand and length above; notes snap to beats, eighths, 16ths or triplets. Click a note to select it (Shift for several), drag to move it, drag its right edge to change its length. **Delete** removes, **↑/↓** change the pitch (Shift: an octave), **←/→** move it in time, **H** switches hand; undo/redo with Cmd/Ctrl+Z.
- **Enter notes from my keyboard:** play keys on your LUMI to add them at the cursor (keys pressed together make a chord); the cursor then moves on by the chosen length. Option/Alt-click sets the cursor.
- **Moving the cursor:** click or drag the **ruler** above the notes (it snaps onto notes when close, and plays them, otherwise to the grid; small dots show where notes start). **◀ Note / Note ▶** (or **,** / **.**) step note by note, selecting and playing each note or chord, so you can fix them one at a time with the arrow keys. **⏮ / ⏭** (Home/End) jump to the start or the last note; **←/→** move the cursor when nothing is selected. The cursor's bar and beat are shown.
- **Selecting, copy and paste:** Shift-drag on empty space (or switch the mouse to **⬚ Select**) to draw a box around notes; Cmd/Ctrl+A selects all, Esc none. **Copy / Cut / Paste / Duplicate** (Cmd/Ctrl+C / X / V / D) — Paste puts the notes at the cursor with both hands kept, Duplicate puts a copy straight after the selection. Copied notes can be pasted into another song too. Pasting past the end adds bars, and undo covers bar, key and tempo changes too.
- **▶ Play from cursor** to check by ear; **■ Stop** (or Space) stops it straight away.
- **Save** rewrites the sheet music from your notes (as a simplified score: one voice per hand). **Undo all edits** puts the notes back as they were imported.
- **Sheet shows: Your version / Original:** "Your version" is the sheet music written from the notes as they are now, updated as you edit (what Save stores); "Original" is the imported score.
- **Key signature, tempo and bars:** choose the key the sheet is written in, change the tempo (notes stay on their beats), add 4 bars at the end, or remove an empty last bar.
- **⬇ Download MusicXML** saves the sheet music as a file: open it in MuseScore (free) to print it, share it, or polish the layout.

### Writing your own music
**✍️ Write your own music** on the songs page starts a blank score: give it a title, time signature, key, tempo and number of bars, then fill it in with the note editor (click notes in, or play them on your LUMI with "Enter notes from my keyboard"). The sheet music is written as you go, and once saved the song can be practised like any other.

### Importing a piece in several files
Pick or drop several MusicXML files at once. Files named alike apart from a number ("Song 1.mxl", "Song 2.mxl", "Song part 3.mxl", "Song (4).mxl") are joined into one song in number order (1, 2 … 10), with bars running on; key or time changes between files are kept. Other files in the batch are imported separately.

## Sheet-music practice view

To learn to read music, switch **View → Sheet music** on the setup screen, or with the toggle in the play screen's toolbar. The game works exactly the same (Wait or Performance mode, scoring, loops, seeking, LUMI lights), but you read from the score:

- **Note names:** letter names on the falling notes, on every key of the on-screen keyboard (C with its octave) and under/over each note on the sheet. Turn them off with **Note names** in the toolbar or on the setup screen.
- **Scrub and jump:** in the scrolling-line layout, drag the music with your mouse or finger to move backwards or forwards (it pauses while you drag, and carries on when you let go if it was playing; if it was paused, a small "▶ Play from here" button appears instead of the pause box). In any layout, tap a bar to jump to it.
- **Layouts:** *One scrolling line* (the music slides past a fixed playhead, with the clef and key signature pinned at the left so you always know which notes are sharp or flat), *Two lines* (the current line and the next, turning automatically) or *Whole sheet* (scrolls to keep the current line in view).
- **Feedback on the score:** notes turn **green** when hit and **red** when missed; the chord to play next is highlighted in indigo; the hand you're not practising is grey.
- **Customise:** note size (**A− / A+**), **Finger numbers** (one toggle for both the sheet and the falling notes; the sheet shows all fingerings, the score's own and the estimated ones: right hand above the notes, left hand below), **Key hints** (switch off for real reading practice: the keyboard and the LUMI stop showing which key is next, though hits and mistakes still flash), and **Falling notes** (show the falling notes under the sheet too).
- **MIDI and audio songs** have no notation, so KeyFall generates a score from their notes. It quantises to 16ths, puts the right hand on the treble staff and the left on the bass, estimates the key signature, spells accidentals to suit it, and closes small gaps so slightly-short notes aren't written with rests. It's a simplified reading; each hand is written as a single voice.
- The key signature is also spelled out under the music, e.g. "4 flats (B♭ E♭ A♭ D♭). Every B, E, A and D is played flat unless marked ♮."
- If notes were moved to fit a small keyboard, the score still shows them where they're written, and a note on screen says so. The guide sound plays them where you play them, so what you hear matches your keys.

## Audio import (MP3, WAV, M4A…)

Drop a recording on the Songs page. Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch-ts) model (Apache-2.0, bundled in `public/models/basic-pitch`) transcribes it into notes **in your browser**; nothing is uploaded. A review screen then lets you:
- check or change the detected **tempo** (×2 / ÷2 if the bars look too long or too short) and the **beats per bar**
- choose where to **split the hands** (C4 by default)
- turn off **octave-echo removal**: ghost notes an octave above a louder note, caused by overtones
- keep the **original recording as the backing track**

In Performance mode with Full sound, the recording plays locked to the song clock. It slows down without changing pitch (the browser's `preservesPitch`), and follows seeks and pauses. Wait mode uses the piano sound instead, because it stops at every chord.

Works best on clear, solo piano. Band mixes, vocals and heavy reverb produce many wrong notes. Tempo and bar lines only affect bar numbers, the metronome and loops; the notes keep their real times from the recording.

## PDFs and photos of sheet music

KeyFall doesn't read PDFs or photos: optical music recognition was tried (a local Audiveris/oemer helper) but wasn't reliable enough, so it was removed. To practise a piece you only have on paper or as a PDF:

- Look for it as MusicXML or MIDI first (MuseScore.com, IMSLP, and many publishers offer MusicXML downloads).
- Or scan it with a music-scanning app (for example PlayScore 2, ScanScore or Soundslice), export **MusicXML**, and import that.
- Then fix any wrong or missing notes in KeyFall's note editor (**✏️ Edit notes**), or write the piece in yourself with **✍️ Write your own music**.

## Architecture

```
src/
  importers/   musicxml.ts (partwise XML + .mxl), midi.ts (tracks/channels → hands)
  model/       song.ts (Song, Note {pitch, start, duration, hand, finger}), hands.ts (overrides), fingering.ts (DP fingering)
  engine/      clock.ts (the one song clock), judge.ts (timing windows, Judge, Scorer), session.ts (modes, loops, audio
               scheduling, light targets), settings.ts
  render/      keyboard.ts (layout / zoom), highway.ts (Canvas 2D highway + keyboard, 60 fps)
  audio/       piano.ts (Tone.js Salamander grand + metronome, fallback synth)
  midi/        input.ts (Web MIDI + computer keyboard), lumiLights.ts (LED protocol), lightsDirector.ts (diffs light state)
  storage/     db.ts (IndexedDB: songs, results, settings, calibration)
  ui/          React screens: Library, Setup (OSMD preview, section, hands), Play, Results, Settings, Calibrate, LumiTest
tests/         vitest unit tests
```

**One clock drives everything.** `SongClock` maps `performance.now()` (the same timebase as Web MIDI event timestamps) to song time, taking playback speed into account. On every animation frame the session reads it to render, judge misses, update lights, and schedule audio. Audio is scheduled at most 150 ms ahead on the AudioContext. Tone.Transport isn't used, so there is no second clock to drift. Wait mode works by putting a *hold limit* on the clock at the next chord. Key presses are judged by their MIDI timestamps minus the calibrated input latency, not by when the JavaScript handler happened to run.

**Speed without pitch change:** the backing track is synthesised from note data, so changing the clock rate never changes pitch.

**Fingering** (`model/fingering.ts`) follows the `pianoplayer` approach. The hand is modelled as five fingers over a "hand position", and the Viterbi dynamic program picks the finger sequence with the lowest total effort. The costs cover hand movement (worse when fast), same-finger repeats, thumb-under and over-thumb crossings, the thumb or 5th finger on black keys, and chord stretch. Fingerings in the score are kept and constrain the search. Estimated numbers show slightly dimmer than score numbers.

## Sounds

Pick the sound of your keys and the backing track on the setup screen (next to Sound) or in Settings:
- **Grand piano:** Salamander Grand Piano by Alexander Holm, CC-BY 3.0.
- **Sampled instruments:** harp, nylon guitar, violin, cello, flute, organ and xylophone, from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) by Nicholas Brosowsky (samples CC-BY 3.0). They download the first time you choose them; the browser caches them afterwards.
- **Synth voices:** electric piano, music box, soft pad and 8-bit. These are built in and work offline.
- You can also change the instrument while playing, from the play screen's toolbar.
- **Game sounds** (on by default, switch off in Settings): a fanfare when you pass a step or set a new best, and a soft "try again" when a step isn't passed yet.

If an instrument can't load (for example, offline), KeyFall uses a simple built-in synth and the status badge says so.

## Sound modes

Pick on the setup screen, or switch any time in the play toolbar:

| Sound | What you hear |
| --- | --- |
| Full | The whole song: the hand you're not practising at full volume, your own part quietly as a guide, and any backing parts. |
| My hand | Just your hand's part, quietly as a guide (in Wait mode it sounds as the music reaches each note, so you hear what comes next). |
| Metro | Metronome clicks. |
| Silent | Nothing from the song: you play. |

**Hear my notes** (toolbar and setup screen, on by default) switches the guide off: your own part is then never played for you, so in Full you hear only the other hand and backing, and "My hand" becomes silent apart from your own key presses.

In every mode the keys you press sound too, unless you switch off **Play my keys through the app** in Settings (for keyboards with their own speakers; a LUMI has none). A one-bar count-in click plays in every mode except Silent (you can turn it off). The metronome follows the tempo, so its clicks stay evenly spaced through pickups and bars that are short in the file. (In Wait mode it pauses while the music waits for you.)

## Known limitations

- **LUMI lights are best-effort.** Colours on some LUMI units don't match the screen, because firmware versions map colours differently from the community-documented table. The protocol is unofficial. Per-key lighting relies on the LUMI running its default program, which lights keys on incoming notes. Other firmware or custom programs may ignore it. Only keys inside the LUMI's current 24-key octave window light up, so use its octave buttons. Colours snap to the LUMI's 127-colour palette. "App mode" can't read your previous LUMI colours, so on exit it restores the mode you pick in Settings (default: Rainbow), not your exact old setup. **Tested with unit tests and a fake MIDI output only. Not yet tested on physical LUMI hardware.**
- **Parts:** in a score with a piano part and other parts (e.g. a voice), you play the piano part; the others are *backing*: heard in Full sound and shown grey on the sheet. A score that's a single melody line (a voice or flute part, a lead sheet) is all right hand (use "Split at" on the setup screen to share it between the hands). Parts for transposing instruments (clarinet, sax, …) are read at sounding pitch.
- **MusicXML:** repeats, 1st/2nd endings, D.C., D.S., Fine and To Coda are played in order. After a D.C./D.S. the repeats aren't taken again and the last ending is used, which is the usual convention; a score that means otherwise will play differently. Grace notes and ornaments (trills, turns) are skipped. Timewise MusicXML isn't supported. Tempo comes from `<sound tempo>` or metronome marks (default 100 bpm).
- **MIDI:** there is no notation, so there's no score preview (pick bars by number). Hands come from track names, then track pitch, then channels (type-0 files), and finally a split at middle C. Bar lines assume the file's time signatures are right.
- **Fingering** is a heuristic. It's fine for simple melodies and scales, but not a substitute for a teacher's fingering on hard passages. Chords with more than five notes in one hand leave the extra notes unfingered.
- **Audio:** the piano and sampled instruments load from the internet the first time (Tone.js and tonejs-instruments hosting). Without it you get a simple synth; the synth voices always work. When you pause or seek, up to about 150 ms of already-scheduled sound can still play.
- **Wait mode** accepts a chord's notes up to 0.6 s (real time) early, and doesn't penalise pressing a key of the current chord again.
- The metronome in pickup (anacrusis) bars spaces its clicks evenly across the shortened bar.
- Computer-keyboard input has no velocity, and browsers can hold only a few keys at once (key rollover).
- Desktop Chrome/Edge first. Safari and Firefox don't support Web MIDI, so only the computer keyboard works there. The layout isn't designed for phones.

## Tests

```bash
npm test
```

173 tests cover:
- the MusicXML importer (pitches, chords, ties, backup/staves, fingering, tempo changes, multi-part scores, pickups, grace notes, `.mxl` unzip, errors)
- the MIDI importer (hand assignment by pitch and track name, type-0 channel split, drums, measures, errors)
- the timing judge (windows, speed scaling, matching, misses, loop reset) and scoring (multiplier, accuracy, stars)
- the song clock and session (Performance, Wait, hands-only, loops with speed-up, audio routing, latency compensation)
- merging numbered files, gap skipping and Listen first
- repeats and endings (playing order, importer, written positions), guided-practice plans, progress maths, exercises and note games
- notation generation for the sheet view (key estimation, spelling, note values, ties, round trips through the MusicXML importer)
- audio import (tempo/beat detection, bars, noise and octave-echo cleanup, hand split) and seeking by bar
- fitting songs to small keyboards (positions, hand shifts, folding, merging) and the LUMI octave SysEx
- fingering, LUMI SysEx byte encoding and palette mapping, the lights director, keyboard layout, and MIDI message parsing

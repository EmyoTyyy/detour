// music.js — the menu's music.
//
// Generated rather than played back, for the same reason the sounds are: there is no build
// step, no server, and file:// has to work. A file can still take over — drop one at the
// path in TRACK and it is used instead, with everything else here (the fade, the mute, the
// unlock, the stop when you start a game) unchanged. Nothing detects it but an attempted
// load, because a HEAD request is not available from file:// either.
//
// The generative side is deliberately slow and unshaped: chords that swap every eight bars
// and a sparse bell line over a pentatonic, so there is nothing to catch the ear and no
// loop point to notice. It sits well under the sound effects and ducks out the moment a
// game starts — this is a menu, not a soundtrack.
//
// window.Music

(function () {
  'use strict';

  const TRACK = 'assets/menu.mp3';   // supply this and it is used instead of the generator

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, bus = null, enabled = true, playing = false;
  let el = null, elFailed = false, blocked = false;
  let timer = null, step = 0;
  const VOL = 0.22;                  // under the effects, which peak around 0.4

  // A2 pentatonic. Minor-ish without committing to a mode, which keeps it from sounding
  // like it is going somewhere.
  const ROOT = 55;                                   // A1
  const SCALE = [0, 3, 5, 7, 10];                    // minor pentatonic, in semitones
  const CHORDS = [[0, 7, 15], [0, 8, 15], [-2, 5, 12], [3, 10, 19]];
  const hz = semis => ROOT * Math.pow(2, semis / 12);

  function ensure() {
    if (!AC || !enabled) return null;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return null; }
      bus = ctx.createGain();
      bus.gain.value = 0;
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 900;                    // take the edge off every voice at once
      soft.Q.value = 0.4;
      bus.connect(soft);
      soft.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  const ramp = (to, secs) => {
    if (!bus || !ctx) return;
    const t = ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(to, t + secs);
  };

  // one long, soft voice — the pad
  function voice(c, at, freq, len, peak) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, at);
    // a touch of drift, so two voices never sit perfectly still against each other
    o.detune.setValueAtTime((Math.random() * 12) - 6, at);
    const g = c.createGain();
    // The attack is a fraction of the note, but a small one. At 0.35 of a 7-second pad the
    // voice took two and a half seconds to reach level, and under a four-second fade-in that
    // multiplied out to something you could not hear at all unless you sat and waited —
    // which, on a menu, nobody does.
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + len * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g); g.connect(bus);
    o.start(at);
    o.stop(at + len + 0.1);
  }

  // an occasional bell, high above the pad
  function bell(c, at, freq) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
    o.connect(g); g.connect(bus);
    o.start(at);
    o.stop(at + 2.8);
  }

  // Scheduled a bar at a time rather than all at once: the page can be left for an hour and
  // nothing accumulates, and stopping is immediate because only one bar is ever pending.
  const BAR = 4.0;
  function tick() {
    const c = ensure();
    if (!c || !playing) return;
    const at = c.currentTime + 0.05;
    const chord = CHORDS[(step >> 3) % CHORDS.length];
    for (const s of chord) voice(c, at, hz(s + 24), BAR * 1.8, 0.10);
    if (step % 2 === 0) voice(c, at, hz(chord[0] + 12), BAR * 1.6, 0.07);
    if (Math.random() < 0.45) {
      const s = SCALE[Math.floor(Math.random() * SCALE.length)] + 48 + (Math.random() < 0.3 ? 12 : 0);
      bell(c, at + Math.random() * BAR * 0.6, hz(s));
    }
    step++;
    timer = setTimeout(tick, BAR * 1000);
  }

  // The file, if there is one. An <audio> element rather than a decoded buffer because
  // fetch() of a local file is blocked from a file:// page, which this has to survive.
  function tryFile() {
    if (elFailed || el) return el;
    try {
      el = new Audio(TRACK);
      el.loop = true;
      el.preload = 'auto';
      el.volume = VOL;
      el.addEventListener('error', () => { elFailed = true; el = null; if (playing) startGenerated(); }, { once: true });
    } catch (e) { elFailed = true; el = null; }
    return el;
  }

  function startGenerated() {
    if (!ensure()) return;
    if (timer) return;
    step = 0;
    ramp(1, 1.2);       // present within a second; see the note on the envelope above
    tick();
  }

  function stopGenerated() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    ramp(0, 0.6);
  }

  // The file could not be loaded or decoded — that is what makes it "no track here".
  function fileIsNoGood() {
    elFailed = true; el = null;
    if (playing) startGenerated();
  }

  function begin() {
    if (!playing || !enabled) return;
    const f = tryFile();
    if (!f) return startGenerated();
    if (!f.paused) return;                    // already running
    const p = f.play();
    if (p && p.then) p.then(stopGenerated, err => {
      // A refused autoplay is NOT a broken file, and telling them apart is the whole game
      // here. The first start() happens at load, before the page has been interacted with,
      // so the browser refuses — and treating that as "there is no track" marked the file
      // bad for the rest of the session and left the generator playing over a perfectly
      // good mp3. NotAllowedError means "not yet": keep the file and retry on a gesture.
      if (err && err.name === 'NotAllowedError') { blocked = true; return; }
      fileIsNoGood();
    });
  }

  // Deliberately not guarded by `playing`: a call that arrives after a refused autoplay is
  // exactly the retry this needs, and it is cheap when the track is already running.
  function start() {
    if (!enabled) return;
    playing = true;
    begin();
  }

  // The page has been interacted with, so a previously refused track can be asked again.
  function retry() {
    if (!blocked) return;
    blocked = false;
    begin();
  }

  function stop() {
    playing = false;
    blocked = false;
    if (el) { try { el.pause(); el.currentTime = 0; } catch (e) {} }
    if (timer) { clearTimeout(timer); timer = null; }
    ramp(0, 1.2);
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) stop();
  }

  window.Music = { start, stop, retry, setEnabled, usingFile: () => !!el && !elFailed };
})();

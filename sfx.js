// sfx.js — the game's sounds, synthesised rather than loaded.
//
// Every other asset in this project is code (the background is canvas, the icon is inline
// SVG, there is no build step and file:// has to work), so the sounds are code too: short
// envelopes over one or two oscillators and the odd noise burst. Nothing to download,
// nothing to cache, and the whole set costs about four kilobytes.
//
// They are woody rather than electronic. This is a slow, flat, paper-and-ink game; arcade
// blips would be wearing by the tenth move, and you hear these about a hundred times a game.
// They were also too quiet to hear over anything else, so the whole set was lifted and a
// limiter put across the output to absorb two sounds landing on the same frame.
//
// Browsers refuse to start audio before the user has interacted with the page, so the
// context is created on the first pointer or key event and not a moment earlier — asking
// for one on load gets a suspended context and a console warning on every visit.
//
// window.Sfx

(function () {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null, enabled = true, unlocked = false;

  function ensure() {
    if (!AC || !enabled) return null;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = 1.0;         // every sound below is mixed under this
      // A limiter, not an effect. The sounds are loud enough now that two landing together
      // (your move and a fast bot's reply) would sum past full scale and crackle. A high
      // ratio above a threshold just under 0dB catches that without being audible on a
      // single sound, which is the only time it does anything.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      master.connect(limiter);
      limiter.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // one short burst of filtered noise — the "wood" in a knock, and the click in a step
  let noiseBuf = null;
  function noiseBuffer(c) {
    if (noiseBuf) return noiseBuf;
    const n = Math.floor(c.sampleRate * 0.2);
    noiseBuf = c.createBuffer(1, n, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // A percussive envelope: near-instant attack, exponential decay. setValueAtTime before
  // the ramp matters — without it the ramp starts from whatever the gain happened to be.
  function envelope(c, at, peak, decay) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    return g;
  }

  function tone(c, at, opts) {
    const o = c.createOscillator();
    o.type = opts.type || 'triangle';
    o.frequency.setValueAtTime(opts.freq, at);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, at + opts.decay);
    const g = envelope(c, at, opts.peak, opts.decay);
    o.connect(g); g.connect(master);
    o.start(at);
    o.stop(at + opts.decay + 0.02);
  }

  function knock(c, at, opts) {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(opts.centre, at);
    f.Q.value = opts.q || 1.2;
    const g = envelope(c, at, opts.peak, opts.decay);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(at);
    s.stop(at + opts.decay + 0.02);
  }

  // Each sound is a recipe rather than a file. The pawn gets a light tap, a wall gets the
  // same tap an octave down with more wood behind it, so the two are told apart without
  // looking — which is the whole point of having them.
  const SOUNDS = {
    move(c, t) {
      tone(c, t, { type: 'triangle', freq: 340, to: 300, peak: 0.273, decay: 0.09 });
      knock(c, t, { centre: 1500, peak: 0.105, decay: 0.035 });
    },
    wall(c, t) {
      tone(c, t, { type: 'triangle', freq: 168, to: 132, peak: 0.42, decay: 0.16 });
      knock(c, t, { centre: 720, q: 0.9, peak: 0.252, decay: 0.07 });
    },
    illegal(c, t) {
      tone(c, t, { type: 'sawtooth', freq: 126, to: 96, peak: 0.189, decay: 0.13 });
    },
    win(c, t) {
      [523.25, 659.25, 783.99].forEach((f, i) =>
        tone(c, t + i * 0.085, { type: 'triangle', freq: f, peak: 0.336, decay: 0.24 }));
    },
    lose(c, t) {
      [392, 293.66].forEach((f, i) =>
        tone(c, t + i * 0.12, { type: 'triangle', freq: f, peak: 0.294, decay: 0.3 }));
    },
    notify(c, t) {
      tone(c, t, { type: 'sine', freq: 660, peak: 0.147, decay: 0.1 });
      tone(c, t + 0.09, { type: 'sine', freq: 880, peak: 0.147, decay: 0.12 });
    },
    chat(c, t) {
      tone(c, t, { type: 'sine', freq: 920, peak: 0.105, decay: 0.07 });
    },

    // The two interface sounds. They are the quietest things here by a distance, because
    // they fire far more often than anything else: a pawn move happens fifty times a game,
    // a hover can happen fifty times crossing the menu. Both are pitched well above the
    // board's sounds so a button can never be mistaken for a move.
    hover(c, t) {
      knock(c, t, { centre: 2600, q: 1.6, peak: 0.032, decay: 0.018 });
      tone(c, t, { type: 'sine', freq: 1320, peak: 0.022, decay: 0.026 });
    },
    click(c, t) {
      tone(c, t, { type: 'triangle', freq: 520, to: 430, peak: 0.16, decay: 0.05 });
      knock(c, t, { centre: 2100, q: 1.0, peak: 0.085, decay: 0.022 });
    },
  };

  // ---------- sampled sounds ----------
  //
  // Almost everything here is synthesised, but a recorded voice is not something oscillators
  // can fake, so the one sample is a file. It is played through an <audio> element rather
  // than decoded into the Web Audio graph on purpose: decoding needs fetch(), and fetch()
  // of a local file is blocked from a file:// page, which this project has to work from.
  // The cost is that it misses the limiter, so its own level is set here instead.
  const SAMPLES = { brilliant: { url: 'assets/fahhh.mp3', vol: 0.85 } };
  const samples = {};
  function sample(name) {
    const spec = SAMPLES[name];
    if (!spec) return false;
    try {
      let a = samples[name];
      if (!a) {
        a = samples[name] = new Audio(spec.url);
        a.preload = 'auto';
      }
      a.currentTime = 0;
      a.volume = spec.vol;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});   // a blocked autoplay is not worth an error
    } catch (e) { /* a sound is never worth an exception */ }
    return true;
  }

  // Two moves can land in the same frame (yours, then a bot's reply on a fast machine);
  // stacking identical sounds on the same millisecond just sounds like one louder one, so
  // the later of a pair is nudged along.
  let lastAt = 0;
  function play(name) {
    if (!enabled) return;
    if (sample(name)) return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const c = ensure();
    if (!c) return;
    const at = Math.max(c.currentTime, lastAt + 0.03);
    lastAt = at;
    try { fn(c, at); } catch (e) { /* a sound is never worth an exception */ }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled && ctx) { try { ctx.suspend(); } catch (e) {} }
    else if (enabled && ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // The first gesture is the only chance to open the context without a warning, so take it
  // and then stop listening.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensure();
  }
  const onFirst = () => { unlock(); window.removeEventListener('pointerdown', onFirst); window.removeEventListener('keydown', onFirst); };
  window.addEventListener('pointerdown', onFirst, { passive: true });
  window.addEventListener('keydown', onFirst, { passive: true });

  // Is the context already open? A hover is not a user gesture, so it must not be what
  // creates one — browsers hand back a suspended context and log a warning for every visit.
  // Callers that fire on mere pointer movement check this first and stay silent until some
  // real interaction has opened the context.
  const ready = () => !!ctx && ctx.state === 'running';

  window.Sfx = { play, setEnabled, unlock, ready, names: () => Object.keys(SOUNDS).concat(Object.keys(SAMPLES)) };
})();

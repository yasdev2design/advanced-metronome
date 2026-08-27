/* audio-engine.js — Web Audio synthesis + sound profiles.
   All sounds are generated programmatically: oscillators, noise, filters,
   envelopes, panning. No external audio files, ever. */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let comp = null;
  let noiseBuffer = null;
  let volume = 0.8;
  let muted = false;

  /* ---- Built-in sound profiles --------------------------------------
     wave     oscillator type
     freq     base frequency (Hz)
     bend     frequency multiplier at end of decay (pitch envelope)
     attack   ms to peak
     decay    ms from peak to silence
     noise    0..1 noise blend (adds transient character)
     filter   none | lowpass | bandpass | highpass
     cutoff   filter frequency (Hz)
     q        filter resonance
     pan      -1..1 stereo position
     gain     output scaling
     accent   0..1 extra gain on accented hits                        */
  const BUILT_IN = {
    classic: { label: 'Classic Click', wave: 'square', freq: 1700, bend: 0.55, attack: 0.4, decay: 38, noise: 0.24, filter: 'bandpass', cutoff: 2300, q: 1.1, pan: 0, gain: 0.95, accent: 0.45 },
    digital: { label: 'Digital Click', wave: 'square', freq: 1050, bend: 0.70, attack: 0.3, decay: 24, noise: 0, filter: 'none', cutoff: 4000, q: 1, pan: 0, gain: 0.85, accent: 0.5 },
    wood: { label: 'Wood', wave: 'triangle', freq: 860, bend: 0.50, attack: 0.6, decay: 92, noise: 0.30, filter: 'lowpass', cutoff: 3200, q: 1, pan: 0, gain: 1.0, accent: 0.4 },
    softwood: { label: 'Soft Wood', wave: 'sine', freq: 620, bend: 0.60, attack: 1.0, decay: 115, noise: 0.18, filter: 'lowpass', cutoff: 1800, q: 0.8, pan: 0, gain: 1.0, accent: 0.35 },
    rim: { label: 'Rim', wave: 'square', freq: 1200, bend: 0.80, attack: 0.3, decay: 30, noise: 0.75, filter: 'bandpass', cutoff: 3400, q: 4, pan: 0.15, gain: 1.0, accent: 0.4 },
    tick: { label: 'Tick', wave: 'sine', freq: 2600, bend: 0.85, attack: 0.2, decay: 14, noise: 0.10, filter: 'highpass', cutoff: 2000, q: 1, pan: 0, gain: 0.7, accent: 0.5 },
    pulse: { label: 'Pulse', wave: 'sine', freq: 440, bend: 0.92, attack: 3.0, decay: 150, noise: 0, filter: 'lowpass', cutoff: 2400, q: 0.7, pan: 0, gain: 1.05, accent: 0.3 },
    electronic: { label: 'Electronic', wave: 'sawtooth', freq: 1240, bend: 0.65, attack: 0.3, decay: 22, noise: 0.14, filter: 'bandpass', cutoff: 2400, q: 3, pan: 0, gain: 0.85, accent: 0.55 },
    deep: { label: 'Deep Click', wave: 'sine', freq: 220, bend: 0.70, attack: 1.2, decay: 145, noise: 0.10, filter: 'lowpass', cutoff: 900, q: 1, pan: 0, gain: 1.15, accent: 0.3 },
    beep: { label: 'Short Beep', wave: 'sine', freq: 1000, bend: 1.0, attack: 2.0, decay: 90, noise: 0, filter: 'none', cutoff: 4000, q: 1, pan: 0, gain: 0.85, accent: 0.45 },
    synth: { label: 'Synth', wave: 'sawtooth', freq: 660, bend: 0.90, attack: 2.5, decay: 170, noise: 0, filter: 'lowpass', cutoff: 4200, q: 2, pan: 0, gain: 0.75, accent: 0.4 },
    mechanical: { label: 'Mechanical', wave: 'square', freq: 700, bend: 0.75, attack: 0.3, decay: 18, noise: 0.50, filter: 'bandpass', cutoff: 1600, q: 2, pan: -0.1, gain: 0.9, accent: 0.5 },
    minimal: { label: 'Minimal', wave: 'sine', freq: 1500, bend: 1.0, attack: 0.3, decay: 26, noise: 0, filter: 'none', cutoff: 4000, q: 1, pan: 0, gain: 0.75, accent: 0.5 }
  };

  const DEFAULT_PROFILE = BUILT_IN.digital;

  function clampNum(v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  }

  /** Sanitize a profile object coming from storage or imported files. */
  function sanitizeProfile(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = {};
    p.wave = ['sine', 'square', 'triangle', 'sawtooth'].includes(raw.wave) ? raw.wave : 'sine';
    p.freq = clampNum(raw.freq, 200, 4000, 1000);
    p.bend = clampNum(raw.bend, 0.3, 1, 0.6); // pitch-envelope depth (1 = none)
    p.attack = clampNum(raw.attack, 0, 20, 0.4);
    p.decay = clampNum(raw.decay, 5, 400, 40);
    p.noise = clampNum(raw.noise, 0, 1, 0);
    p.filter = ['none', 'lowpass', 'bandpass', 'highpass'].includes(raw.filter) ? raw.filter : 'none';
    p.cutoff = clampNum(raw.cutoff, 300, 8000, 4000);
    p.q = clampNum(raw.q, 0.5, 18, 1);
    p.pan = clampNum(raw.pan, -1, 1, 0);
    p.gain = clampNum(raw.gain, 0.1, 1.5, 1);
    p.accent = clampNum(raw.accent, 0, 1, 0.4);
    return p;
  }

  /** Resolve a sound key ('digital' builtin or 'user:Name') to a profile. */
  function getProfile(key, customSounds) {
    if (typeof key === 'string' && key.indexOf('user:') === 0) {
      const name = key.slice(5);
      if (customSounds && customSounds[name]) {
        const p = sanitizeProfile(customSounds[name]);
        if (p) { p.label = name; return p; }
      }
      return DEFAULT_PROFILE;
    }
    return BUILT_IN[key] || DEFAULT_PROFILE;
  }

  /* ---- Context management ------------------------------------------- */
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume * volume;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    // Short reusable white-noise buffer for transient clicks.
    const len = Math.floor(ctx.sampleRate * 0.25);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function resume() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().catch(function () { /* autoplay policy — will retry on next gesture */ });
    }
    return true;
  }

  function applyVolume() {
    if (master) master.gain.setTargetAtTime(muted ? 0 : volume * volume, ctx.currentTime, 0.01);
  }

  function setVolume(v) {
    volume = clampNum(v, 0, 1, 0.8);
    applyVolume();
  }

  function setMuted(m) {
    muted = !!m;
    applyVolume();
  }

  /* ---- Voice triggering ---------------------------------------------- */
  const LEVEL_GAIN = { 0: 0, 1: 0.5, 2: 1, 3: 1 };

  // Registry of scheduled-but-maybe-not-yet-played sources so stop() can
  // silence clicks that were queued inside the look-ahead window.
  let scheduledSrcs = [];
  function registerSource(src, t) {
    scheduledSrcs.push({ src, t });
    if (scheduledSrcs.length > 96) {
      const nowT = ctx.currentTime;
      scheduledSrcs = scheduledSrcs.filter(function (e) { return e.t > nowT; });
    }
  }
  /** Immediately silence every source scheduled in the future (used on stop). */
  function cancelUpcoming() {
    if (ctx) {
      const cut = ctx.currentTime;
      scheduledSrcs.forEach(function (e) {
        if (e.t > cut && e.src.stop) {
          try { e.src.stop(cut); } catch (err) { /* already ended */ }
        }
      });
    }
    scheduledSrcs.length = 0;
  }

  /**
   * Trigger one click.
   * @param {object} p      sound profile
   * @param {number} when   AudioContext time to fire
   * @param {number} level  1 soft · 2 normal · 3 accent
   * @param {number} volMult optional extra gain scaling (layer volume)
   */
  function trigger(p, when, level, volMult) {
    if (!ensure() || !p) return;
    const t = Math.max(when, ctx.currentTime + 0.001);
    const lvl = LEVEL_GAIN[level] !== undefined ? level : 2;
    if (lvl === 0) return;
    const lvlGain = lvl === 3 ? 1 + (p.accent || 0) : LEVEL_GAIN[lvl];
    const vm = volMult === undefined ? 1 : volMult;
    const peak = 0.45 * (p.gain || 1) * lvlGain * vm;
    if (peak < 0.0015) return;
    const attack = (p.attack || 0) / 1000;
    const decay = (p.decay || 40) / 1000;
    const dur = attack + decay;

    let out;
    if (p.filter && p.filter !== 'none') {
      const f = ctx.createBiquadFilter();
      f.type = p.filter;
      f.frequency.value = p.cutoff || 4000;
      f.Q.value = p.q || 1;
      out = f;
      f.connect(master);
    } else {
      out = master;
    }

    let tail = out;
    if (typeof ctx.createStereoPanner === 'function' && p.pan) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p.pan;
      pan.connect(out);
      tail = pan;
    }

    // Oscillator with pitch envelope (the "click" character).
    const osc = ctx.createOscillator();
    osc.type = p.wave;
    osc.frequency.setValueAtTime(p.freq, t);
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, p.freq * (p.bend === undefined ? 0.6 : p.bend)),
      t + Math.max(0.008, dur)
    );
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(peak * (1 - (p.noise || 0) * 0.6), t + attack);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(og);
    og.connect(tail);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    registerSource(osc, t);

    // Noise transient for wood/rim/mechanical characters.
    if ((p.noise || 0) > 0.02 && noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(peak * p.noise, t + attack + 0.001);
      ng.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(ng);
      ng.connect(tail);
      src.start(t);
      src.stop(t + dur + 0.05);
      registerSource(src, t);
    }
  }

  /** Immediate preview used by the sound designer. */
  function preview(p, level, volMult) {
    if (!resume()) return;
    trigger(p, ctx.currentTime + 0.02, level, volMult);
  }

  function state() { return ctx ? ctx.state : 'unavailable'; }
  function sampleRate() { return ctx ? ctx.sampleRate : null; }
  function latency() {
    if (!ctx) return null;
    // Prefer outputLatency (includes hardware path); fall back to baseLatency.
    if (ctx.outputLatency !== undefined && isFinite(ctx.outputLatency)) {
      return ctx.outputLatency * 1000;
    }
    if (ctx.baseLatency !== undefined && isFinite(ctx.baseLatency)) {
      return ctx.baseLatency * 1000;
    }
    return null;
  }
  function now() { return ctx ? ctx.currentTime : 0; }

  window.AudioEngine = {
    BUILT_IN,
    sanitizeProfile,
    getProfile,
    ensure,
    resume,
    setVolume,
    setMuted,
    trigger,
    cancelUpcoming,
    preview,
    state,
    sampleRate,
    latency,
    now,
    get ctx() { return ctx; }
  };
})();

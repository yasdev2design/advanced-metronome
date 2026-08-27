/* metronome.js — precision scheduler.
   Audio-clock lookahead scheduling (never setInterval-driven audio):
   a 25 ms timer fills a ~150 ms scheduling window using AudioContext.currentTime;
   the UI clock (rAF) only *consumes* pre-scheduled draw events, never drives audio.
   Handles: main pattern, subdivisions, polyrhythm + polymeter layers,
   practice sessions and tempo automation. */
(function () {
  'use strict';

  const TICK_MS = 25;
  const LOOK_FORE = 0.15;   // scheduling window while visible
  const LOOK_BACK = 2.0;    // widened window when tab is hidden (timers throttle to ~1s)

  let running = false;
  let timer = null;
  let look = LOOK_FORE;

  let stepIdx = 0;          // global subdivision step counter (main layer)
  let bar = 1;
  let mainNext = 0;
  let auxNext = 0;          // poly / meter layer
  let auxIdx = 0;
  let t0 = 0;               // audio-clock start time (automation/practice origin)
  let effBpm = 120;         // effective tempo (may be driven by practice/automation)
  let queue = [];           // draw events {t, kind, ...} consumed by the UI loop
  let measureStartT = 0;
  let measureDur = 1;
  let schedCount = 0;

  // Callbacks provided by app.js
  let cb = {
    getState: null,        // -> state object
    onBpmLive: null,       // (bpm, source) when practice/automation changes tempo
    onMeasure: null,       // (bar)
    onPractice: null,      // ({phase, rep, reps, progress, resting, bpm})
    onEnd: null            // ('practice') when a practice session completes
  };

  function init(callbacks) {
    Object.assign(cb, callbacks || {});
    document.addEventListener('visibilitychange', function () {
      look = document.hidden ? LOOK_BACK : LOOK_FORE;
    });
  }

  const S = function () { return cb.getState ? cb.getState() : {}; };

  function customs() { return (S().customSounds || {}); }

  function pulseDur(bpm) {
    const unit = (S().timeSig && S().timeSig.unit) || 4;
    return 60 / bpm * (4 / unit);
  }

  /* ---- Practice session -------------------------------------------- */
  let pSession = null; // {t0, start, target, step, every, restBars, reps, lastRep, wasResting}

  function startPractice() {
    const st = S();
    const p = st.practice || {};
    pSession = {
      t0,
      start: p.start || 80,
      target: p.target || 120,
      step: Math.abs(p.step || 5) * (p.target >= p.start ? 1 : -1),
      every: Math.max(5, p.every || 60),
      restBars: Math.max(0, p.restBars || 0),
      reps: Math.max(1, p.reps || 1),
      lastRep: -1,
      wasResting: false
    };
  }

  /** Compute practice tempo/rest state for an audio time t. Returns null when inactive. */
  function practiceAt(t) {
    if (!pSession) return null;
    const s = pSession;
    const md = measureDur || 1;
    const cycle = s.every + s.restBars * md;
    const elapsed = Math.max(0, t - s.t0);
    const rep = Math.floor(elapsed / cycle);
    const pos = elapsed - rep * cycle;
    const resting = s.restBars > 0 && pos >= s.every;

    if (rep >= s.reps) {
      pSession = null;
      if (cb.onEnd) cb.onEnd('practice');
      return null;
    }

    let bpm = s.start + s.step * rep;
    bpm = s.step >= 0 ? Math.min(s.target, bpm) : Math.max(s.target, bpm);

    if (rep !== s.lastRep || resting !== s.wasResting) {
      s.lastRep = rep;
      s.wasResting = resting;
      if (cb.onPractice) {
        cb.onPractice({
          phase: 'running',
          rep: rep + 1,
          reps: s.reps,
          progress: Math.min(1, elapsed / (s.reps * cycle)),
          resting,
          bpm
        });
      }
    }
    return { bpm, resting, progress: Math.min(1, elapsed / (s.reps * cycle)) };
  }

  /* ---- Tempo automation --------------------------------------------- */
  function autoPoints() {
    const pts = (S().automation && S().automation.points) || [];
    return pts
      .map(function (p) { return { t: Number(p.t), bpm: Number(p.bpm) }; })
      .filter(function (p) { return isFinite(p.t) && isFinite(p.bpm) && p.t >= 0 && p.bpm >= 20 && p.bpm <= 300; })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function autoBpmAt(t) {
    const pts = autoPoints();
    if (!pts.length) return null;
    const st = S();
    const mode = (st.automation && st.automation.mode) || 'ramp';
    const elapsed = t - t0;
    if (elapsed <= pts[0].t) return pts[0].bpm;
    for (let i = 1; i < pts.length; i++) {
      if (elapsed <= pts[i].t) {
        if (mode === 'step') return pts[i - 1].bpm;
        const span = pts[i].t - pts[i - 1].t;
        const f = span > 0 ? (elapsed - pts[i - 1].t) / span : 1;
        return pts[i - 1].bpm + (pts[i].bpm - pts[i - 1].bpm) * f;
      }
    }
    return pts[pts.length - 1].bpm;
  }

  /* ---- Layer scheduling ---------------------------------------------- */
  function restingAt(t) {
    const p = practiceAt(t);
    return p ? p.resting : false;
  }

  function scheduleMain(t) {
    const st = S();
    const beats = (st.timeSig && st.timeSig.beats) || 4;
    const count = (st.subdiv && st.subdiv.count) || 1;
    const total = beats * count;
    const posIdx = ((stepIdx % total) + total) % total;
    const beatIdx = Math.floor(posIdx / count);
    const subIdx = posIdx % count;
    const resting = restingAt(t);

    if (subIdx === 0) {
      const b = (st.pattern && st.pattern[beatIdx]) || { level: 2, prob: 100 };
      const probPass = (b.prob || 100) >= 100 || Math.random() * 100 < b.prob;
      const audible = b.level > 0 && probPass && !resting;
      if (audible) {
        AudioEngine.trigger(
          AudioEngine.getProfile(b.sound || st.sound, customs()), t, b.level, 1
        );
      }
      queue.push({ t, kind: 'beat', beatIdx, level: audible ? b.level : 0, bar, muted: resting });
      if (posIdx === 0) {
        measureStartT = t;
        queue.push({ t, kind: 'bar', bar });
        bar += 1;
        if (cb.onMeasure) cb.onMeasure(bar - 1);
      }
    } else {
      const slot = (st.subdiv.slots && st.subdiv.slots[subIdx]) || 0;
      const beatSilent = st.pattern && st.pattern[beatIdx] && st.pattern[beatIdx].level === 0;
      const audible = slot !== 0 && !beatSilent && !resting;
      if (audible) {
        const prof = (st.subSound && st.subSound.enabled)
          ? AudioEngine.getProfile(st.subSound.sound, customs())
          : AudioEngine.getProfile(st.sound, customs());
        AudioEngine.trigger(prof, t, slot === 2 ? 3 : 1, 1);
      }
      queue.push({ t, kind: 'sub', beatIdx, subIdx, on: audible, muted: resting });
    }
    stepIdx += 1;
    schedCount += 1;
  }

  function schedulePoly(t) {
    const st = S();
    const p = st.poly || {};
    const a = Math.max(2, p.a || 3);
    const b = Math.max(2, p.b || 4);
    const idx = ((auxIdx % a) + a) % a;
    const level = idx === 0 ? 3 : 2;
    if (!restingAt(t)) {
      AudioEngine.trigger(AudioEngine.getProfile(p.sound, customs()), t, level, p.vol === undefined ? 0.7 : p.vol);
    }
    queue.push({ t, kind: 'poly', idx });
    auxIdx += 1;
  }

  function scheduleMeter(t) {
    const st = S();
    const m = st.meter || {};
    const n = Math.max(2, m.beats || 3);
    const idx = ((auxIdx % n) + n) % n;
    const level = idx === 0 ? 3 : 2;
    if (!restingAt(t)) {
      AudioEngine.trigger(AudioEngine.getProfile(m.sound, customs()), t, level, m.vol === undefined ? 0.7 : m.vol);
    }
    queue.push({ t, kind: 'meter', idx });
    auxIdx += 1;
  }

  /* ---- Effective tempo ------------------------------------------------ */
  function updateEffective(now) {
    const st = S();
    let bpm = st.bpm || 120;
    let source = 'manual';

    if (pSession) {
      const p = practiceAt(now + 0.05);
      if (p) { bpm = p.bpm; source = 'practice'; }
    } else if (st.automation && st.automation.enabled) {
      const a = autoBpmAt(now + 0.05);
      if (a !== null) { bpm = a; source = 'auto'; }
    }

    const lo = st.bpmMin || 20, hi = st.bpmMax || 300;
    bpm = Math.min(hi, Math.max(lo, bpm));
    if (Math.abs(bpm - effBpm) > 0.04) {
      effBpm = bpm;
      if (source !== 'manual' && cb.onBpmLive) cb.onBpmLive(bpm, source);
    } else {
      effBpm = bpm;
    }
    return bpm;
  }

  function tick() {
    const ctx = AudioEngine.ctx;
    if (!running || !ctx) return;
    const now = ctx.currentTime;
    const horizon = now + look;
    const st = S();

    // Resync if we fell behind (mode switches, tab throttling, breakpoints):
    // never dump a burst of overdue clicks.
    if (mainNext < now) mainNext = now + 0.02;
    if ((st.mode === 'polyrhythm' || st.mode === 'polymeter') && auxNext < now) {
      auxNext = now + 0.02;
    }

    const bpm = updateEffective(now);
    const beatDur = pulseDur(bpm);
    measureDur = beatDur * ((st.timeSig && st.timeSig.beats) || 4);

    while (running && mainNext < horizon) {
      scheduleMain(mainNext);
      mainNext += beatDur / ((st.subdiv && st.subdiv.count) || 1);
    }

    if (st.mode === 'polyrhythm') {
      const p = st.poly || {};
      const cycle = beatDur * Math.max(2, p.b || 4);
      const stepDur = cycle / Math.max(2, p.a || 3);
      while (running && auxNext < horizon) {
        schedulePoly(auxNext);
        auxNext += stepDur;
      }
    } else if (st.mode === 'polymeter') {
      const m = st.meter || {};
      const stepDur = beatDur * (m.ratio || 1);
      while (running && auxNext < horizon) {
        scheduleMeter(auxNext);
        auxNext += stepDur;
      }
    }

    // Trim draw events that were scheduled before a stop() call.
    if (queue.length > 512) queue.splice(0, queue.length - 512);
  }

  /* ---- Public API ------------------------------------------------------ */
  function start() {
    if (running) return true;
    if (!AudioEngine.resume()) return false;
    const ctx = AudioEngine.ctx;
    if (!ctx) return false;

    running = true;
    stepIdx = 0;
    bar = 1;
    auxIdx = 0;
    queue.length = 0;
    schedCount = 0;
    t0 = ctx.currentTime + 0.08;
    mainNext = t0;
    auxNext = t0;

    const st = S();
    if (st.practice && st.practice.running) {
      startPractice();
      if (cb.onPractice) cb.onPractice({ phase: 'running', rep: 1, reps: pSession.reps, progress: 0, resting: false, bpm: pSession.start });
    } else if (st.automation && st.automation.enabled) {
      updateEffective(t0);
    }

    timer = setInterval(tick, TICK_MS);
    tick();
    return true;
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    // Silence any clicks already queued inside the look-ahead window.
    AudioEngine.cancelUpcoming();
    queue.length = 0;
    if (pSession) {
      pSession = null;
      if (cb.onPractice) cb.onPractice({ phase: 'idle' });
    }
  }

  function toggle() {
    if (running) stop(); else start();
    return running;
  }

  /** Remove pending draw events after a live edit (so visuals resync quickly). */
  function flushQueue() { queue.length = 0; }

  window.Metro = {
    init,
    start,
    stop,
    toggle,
    flushQueue,
    get running() { return running; },
    get queue() { return queue; },
    get measureStartT() { return measureStartT; },
    get measureDur() { return measureDur; },
    get effBpm() { return effBpm; },
    get scheduled() { return schedCount; },
    get lookahead() { return look; },
    get elapsed() {
      const c = AudioEngine.ctx;
      return (running && c) ? Math.max(0, c.currentTime - t0) : 0;
    },
    get bpmSource() { return pSession ? 'practice' : ((S().automation && S().automation.enabled) ? 'auto' : 'manual'); }
  };
})();

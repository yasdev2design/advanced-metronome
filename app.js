/* app.js — UI wiring, visualizer, gestures, shortcuts, panels, PWA.
   The UI clock (requestAnimationFrame) only consumes pre-scheduled draw
   events from Metro.queue; it never drives audio timing. */
(function () {
  'use strict';

  const R = window.Rhythm;
  const AE = window.AudioEngine;
  const Metro = window.Metro;
  const Presets = window.Presets;
  const Store = window.Store;

  const $ = function (id) { return document.getElementById(id); };
  const clamp = R.clamp;
  const clampInt = function (v, lo, hi, dflt) { return Math.round(clamp(v, lo, hi, dflt)); };

  const LEVEL_NAMES = { 3: 'accent', 2: 'normal', 1: 'soft', 0: 'silent' };
  const LEVEL_SHORT = { 3: 'ACC', 2: 'NRM', 1: 'SFT', 0: 'SIL' };
  const LEVEL_BY_NAME = { accent: 3, normal: 2, soft: 1, silent: 0 };

  /* ================= STATE ================= */
  const DEFAULT_SHORTCUTS = {
    play: 'space', tap: 't', inc: 'arrowup', dec: 'arrowdown',
    inc5: 'arrowright', dec5: 'arrowleft', mute: 'm', reset: 'r',
    fullscreen: 'f', lock: 'l'
  };
  const SHORTCUT_LABELS = {
    play: 'Play / pause', tap: 'Tap tempo', inc: 'Tempo + step', dec: 'Tempo − step',
    inc5: 'Tempo + 5', dec5: 'Tempo − 5', mute: 'Mute', reset: 'Reset pattern',
    fullscreen: 'Performance mode', lock: 'Tempo lock'
  };
  const ACCENTS = ['lime', 'cyan', 'amber', 'rose', 'blue', 'red'];

  function sanitizeSoundKey(v, dflt) {
    if (typeof v !== 'string') return dflt;
    if (v.indexOf('user:') === 0) return 'user:' + v.slice(5).slice(0, 24);
    return AE.BUILT_IN[v] ? v : dflt;
  }

  function loadState() {
    const s = Store.get('state', {}) || {};
    const st = {
      bpm: clamp(s.bpm, 20, 300, 120),
      bpmMin: clamp(s.bpmMin, 20, 300, 20),
      bpmMax: clamp(s.bpmMax, 20, 300, 300),
      bpmStep: [0.1, 0.5, 1, 5, 10].includes(Number(s.bpmStep)) ? Number(s.bpmStep) : 1,
      bpmLocked: !!s.bpmLocked,
      timeSig: {
        beats: clampInt(s.timeSig && s.timeSig.beats, 1, 24, 4),
        unit: [1, 2, 4, 8, 16].includes(s.timeSig && s.timeSig.unit) ? s.timeSig.unit : 4
      },
      pattern: null,
      subdiv: {
        count: clampInt(s.subdiv && s.subdiv.count, 1, 7, 1),
        slots: R.resizeSubSlots(s.subdiv && s.subdiv.slots, clampInt(s.subdiv && s.subdiv.count, 1, 7, 1))
      },
      sound: sanitizeSoundKey(s.sound, 'digital'),
      subSound: {
        enabled: !!(s.subSound && s.subSound.enabled),
        sound: sanitizeSoundKey(s.subSound && s.subSound.sound, 'tick')
      },
      customSounds: {},
      volume: clamp(s.volume, 0, 1, 0.8),
      muted: !!s.muted,
      mode: ['standard', 'polyrhythm', 'polymeter'].includes(s.mode) ? s.mode : 'standard',
      poly: {
        a: clampInt(s.poly && s.poly.a, 2, 12, 3),
        b: clampInt(s.poly && s.poly.b, 2, 12, 4),
        sound: sanitizeSoundKey(s.poly && s.poly.sound, 'deep'),
        vol: clamp(s.poly && s.poly.vol, 0, 1, 0.7)
      },
      meter: {
        beats: clampInt(s.meter && s.meter.beats, 2, 13, 3),
        ratio: [0.5, 1, 2].includes(Number(s.meter && s.meter.ratio)) ? Number(s.meter.ratio) : 1,
        sound: sanitizeSoundKey(s.meter && s.meter.sound, 'wood'),
        vol: clamp(s.meter && s.meter.vol, 0, 1, 0.7)
      },
      practice: {
        running: false,
        start: clampInt(s.practice && s.practice.start, 20, 300, 80),
        target: clampInt(s.practice && s.practice.target, 20, 300, 120),
        step: clampInt(s.practice && s.practice.step, 1, 20, 5),
        every: clampInt(s.practice && s.practice.every, 5, 600, 60),
        restBars: clampInt(s.practice && s.practice.restBars, 0, 32, 0),
        reps: clampInt(s.practice && s.practice.reps, 1, 20, 1)
      },
      automation: {
        enabled: !!(s.automation && s.automation.enabled),
        mode: (s.automation && s.automation.mode) === 'step' ? 'step' : 'ramp',
        points: Array.isArray(s.automation && s.automation.points)
          ? s.automation.points
            .map(function (p) { return { t: Number(p && p.t), bpm: Number(p && p.bpm) }; })
            .filter(function (p) { return isFinite(p.t) && isFinite(p.bpm) && p.t >= 0 && p.bpm >= 20 && p.bpm <= 300; })
            .sort(function (a, b) { return a.t - b.t; })
            .slice(0, 24)
          : []
      },
      visual: {
        mode: ['grid', 'ring', 'pulse', 'minimal'].includes(s.visual && s.visual.mode) ? s.visual.mode : 'grid',
        intensity: clamp(s.visual && s.visual.intensity, 0.2, 1, 0.7)
      },
      theme: ['auto', 'dark', 'light'].includes(s.theme) ? s.theme : 'dark',
      accent: ACCENTS.includes(s.accent) ? s.accent : 'lime',
      density: s.density === 'compact' ? 'compact' : 'cozy',
      motion: ['full', 'reduced', 'off'].includes(s.motion) ? s.motion : 'full',
      decimals: s.decimals !== false,
      haptics: s.haptics !== false,
      presets: Array.isArray(s.presets) ? s.presets.map(Presets.sanitizePreset).filter(Boolean).slice(0, 100) : [],
      ui: { onboarded: !!((s.ui && s.ui.onboarded)) },
      selectedBeat: 0
    };
    if (st.bpmMin > st.bpmMax) st.bpmMin = st.bpmMax;
    st.bpm = clamp(st.bpm, st.bpmMin, st.bpmMax);
    st.pattern = R.resizePattern(Array.isArray(s.pattern) ? s.pattern : null, st.timeSig.beats, st.timeSig.unit);
    if (s.customSounds && typeof s.customSounds === 'object' && !Array.isArray(s.customSounds)) {
      Object.keys(s.customSounds).slice(0, 30).forEach(function (name) {
        const p = AE.sanitizeProfile(s.customSounds[name]);
        if (p) st.customSounds[String(name).slice(0, 24)] = p;
      });
    }
    st.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
    if (s.shortcuts && typeof s.shortcuts === 'object') {
      Object.keys(DEFAULT_SHORTCUTS).forEach(function (a) {
        const v = s.shortcuts[a];
        if (typeof v === 'string' && v.length <= 12 && /^[a-z0-9\s]+$/i.test(v)) st.shortcuts[a] = v.toLowerCase();
      });
    }
    return st;
  }

  const state = loadState();
  let saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      const snapshot = Object.assign({}, state, {
        practice: Object.assign({}, state.practice, { running: false })
      });
      Store.set('state', snapshot);
    }, 300);
  }

  /* ================= DOM REFS ================= */
  const html = document.documentElement;
  const app = $('app');
  const banner = $('banner');
  const miniDot = $('miniDot');
  const statusLine = $('statusLine');
  const instrument = $('instrument');
  const ringFill = $('ringFill');
  const bpmValue = $('bpmValue');
  const bpmInput = $('bpmInput');
  const tempoMark = $('tempoMark');
  const btnLock = $('btnLock');
  const btnPlay = $('btnPlay');
  const btnTap = $('btnTap');
  const tapCount = $('tapCount');
  const beatDots = $('beatDots');
  const visualizer = $('visualizer');
  const barLabel = $('barLabel');
  const beatLabel = $('beatLabel');
  const sigLabel = $('sigLabel');
  const subLabelNow = $('subLabelNow');
  const rhythmStrip = $('rhythmStrip');
  const sigChips = $('sigChips');
  const sigNum = $('sigNum');
  const sigDen = $('sigDen');
  const subChips = $('subChips');
  const soundSelect = $('soundSelect');
  const subSoundSelect = $('subSoundSelect');
  const subSoundToggle = $('subSoundToggle');
  const btnMute = $('btnMute');
  const volumeSlider = $('volumeSlider');
  const volumeOut = $('volumeOut');
  const modeChips = $('modeChips');
  const modeHint = $('modeHint');
  const diagMini = $('diagMini');
  const consoleEl = $('console');
  const consoleScrim = $('consoleScrim');
  const consoleNav = $('consoleNav');

  const RING_C = 2 * Math.PI * 92;

  /* ================= FEEDBACK ================= */
  let bannerShown = false;
  function showBanner(msg) {
    if (bannerShown) return;
    bannerShown = true;
    banner.textContent = msg;
    banner.hidden = false;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    el.removeAttribute('data-leaving');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.setAttribute('data-leaving', '1');
      setTimeout(function () { el.hidden = true; }, 250);
    }, 2100);
  }

  function haptic(ms) {
    if (state.haptics && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
    }
  }

  /* ================= THEME / LOOK ================= */
  const themeMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function resolvedTheme() {
    if (state.theme !== 'auto') return state.theme;
    return themeMq && themeMq.matches ? 'light' : 'dark';
  }
  function applyTheme() {
    html.dataset.theme = resolvedTheme();
    html.dataset.accent = state.accent;
    html.dataset.density = state.density;
    html.dataset.motion = state.motion;
    html.style.setProperty('--vi', String(state.visual.intensity));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolvedTheme() === 'light' ? '#ecefee' : '#0a0c0f');
  }
  if (themeMq && themeMq.addEventListener) {
    themeMq.addEventListener('change', function () { if (state.theme === 'auto') applyTheme(); });
  }

  /* ================= BPM ================= */
  function fmtBpm(v) { return R.fmtBpm(v, state.decimals); }

  function updateBpmUI() {
    const txt = fmtBpm(state.bpm);
    bpmValue.textContent = txt;
    $('perfBpm').textContent = txt;
    tempoMark.textContent = R.tempoTerm(state.bpm);
    if (document.activeElement !== bpmInput) bpmInput.value = String(Math.round(state.bpm * 10) / 10);
    const beatSec = 60 / state.bpm * (4 / state.timeSig.unit);
    html.style.setProperty('--beat-dur', beatSec.toFixed(4) + 's');
    updateStatusLine();
  }

  let lastLockToast = 0;
  function setBpm(v, opts) {
    if (state.bpmLocked && !(opts && opts.force)) {
      const now = performance.now();
      if (now - lastLockToast > 1500) {
        lastLockToast = now;
        toast('Tempo is locked — unlock to change (L)');
      }
      return;
    }
    const lo = Math.max(20, state.bpmMin);
    const hi = Math.min(300, state.bpmMax);
    const nv = clamp(Math.round(v * 10) / 10, lo, hi);
    if (nv === state.bpm) return;
    state.bpm = nv;
    updateBpmUI();
    save();
  }

  function updateStatusLine() {
    if (!Metro.running) {
      statusLine.textContent = 'READY';
      return;
    }
    const src = Metro.bpmSource;
    const tag = src === 'practice' ? 'PRACTICE' : src === 'auto' ? 'AUTO' : 'PLAYING';
    statusLine.textContent = tag + ' · ' + fmtBpm(state.bpm) + ' BPM';
  }

  function syncLock() {
    btnLock.setAttribute('aria-pressed', String(state.bpmLocked));
    btnLock.classList.toggle('locked', state.bpmLocked);
    btnLock.querySelector('use').setAttribute('href', state.bpmLocked ? '#i-lock' : '#i-unlock');
  }

  /* Direct input editing */
  let editingBpm = false;
  function enterBpmEdit() {
    if (state.bpmLocked) { toast('Tempo is locked'); return; }
    editingBpm = true;
    bpmValue.classList.add('editing');
    bpmInput.hidden = false;
    bpmInput.min = String(Math.max(20, state.bpmMin));
    bpmInput.max = String(Math.min(300, state.bpmMax));
    bpmInput.value = String(Math.round(state.bpm * 10) / 10);
    bpmInput.focus();
    bpmInput.select();
  }
  function exitBpmEdit(commit) {
    if (!editingBpm) return;
    editingBpm = false;
    if (commit) {
      const v = parseFloat(bpmInput.value);
      if (isFinite(v)) setBpm(v, { force: false });
      else updateBpmUI();
    } else {
      updateBpmUI();
    }
    bpmInput.hidden = true;
    bpmValue.classList.remove('editing');
    bpmValue.focus();
  }
  bpmInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); exitBpmEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); exitBpmEdit(false); }
    e.stopPropagation();
  });
  bpmInput.addEventListener('blur', function () { exitBpmEdit(true); });

  /* Wheel + vertical drag on the readout */
  const readout = document.querySelector('.readout');
  readout.addEventListener('wheel', function (e) {
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const mult = e.shiftKey ? 5 : 1;
    setBpm(state.bpm + dir * state.bpmStep * mult);
  }, { passive: false });

  let dragInfo = null;
  let suppressClick = false;
  bpmValue.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    dragInfo = { y0: e.clientY, bpm0: state.bpm, moved: false };
    suppressClick = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragInfo) return;
    const dy = dragInfo.y0 - e.clientY;
    if (!dragInfo.moved && Math.abs(dy) > 7) {
      dragInfo.moved = true;
      if (state.bpmLocked) { dragInfo = null; toast('Tempo is locked'); return; }
    }
    if (dragInfo && dragInfo.moved) {
      suppressClick = true;
      setBpm(dragInfo.bpm0 + dy / 7 * state.bpmStep);
    }
  });
  window.addEventListener('pointerup', function () { dragInfo = null; });
  window.addEventListener('pointercancel', function () { dragInfo = null; });
  bpmValue.addEventListener('click', function () {
    if (suppressClick) { suppressClick = false; return; }
    enterBpmEdit();
  });

  /* ================= TAP TEMPO ================= */
  let taps = [];
  let tapPressTimer = null;
  let tapLongFired = false;
  function doTap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2500) taps = [];
    taps.push(now);
    if (taps.length > 8) taps.shift();
    tapCount.textContent = taps.length >= 2 ? String(taps.length) : '·';
    btnTap.classList.add('flash');
    setTimeout(function () { btnTap.classList.remove('flash'); }, 110);
    haptic(12);
    if (taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
      const avg = sum / (taps.length - 1);
      if (avg > 150) setBpm(60000 / avg, { force: true });
    }
  }
  btnTap.addEventListener('pointerdown', function () {
    tapLongFired = false;
    tapPressTimer = setTimeout(function () {
      tapLongFired = true;
      taps = [];
      tapCount.textContent = '·';
      haptic(40);
      toast('Tap history cleared');
    }, 600);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    btnTap.addEventListener(ev, function () {
      if (tapPressTimer) { clearTimeout(tapPressTimer); tapPressTimer = null; }
    });
  });
  btnTap.addEventListener('click', function () {
    if (tapLongFired) { tapLongFired = false; return; }
    doTap();
  });
  btnTap.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ================= TRANSPORT ================= */
  function syncTransport() {
    const playing = Metro.running;
    btnPlay.setAttribute('data-playing', String(playing));
    btnPlay.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
    $('perfPlay').setAttribute('data-playing', String(playing));
    if (!playing) {
      barLabel.textContent = 'BAR 1';
      $('perfBar').textContent = 'BAR 1';
      beatLabel.textContent = 'BEAT 1';
      miniDot.classList.remove('on');
    }
    updateStatusLine();
    updateDiagMini();
  }

  function playToggle() {
    if (!Metro.running) {
      if (!AE.resume()) {
        showBanner('Web Audio is not available in this browser — the metronome cannot run.');
        return;
      }
      if (!Metro.start()) {
        showBanner('Audio could not start. Interact with the page once, then press play again.');
        return;
      }
      haptic(15);
    } else {
      Metro.stop();
    }
    syncTransport();
  }
  btnPlay.addEventListener('click', playToggle);
  $('btnInc').addEventListener('click', function () { setBpm(state.bpm + state.bpmStep); });
  $('btnDec').addEventListener('click', function () { setBpm(state.bpm - state.bpmStep); });
  $('btnInc5').addEventListener('click', function () { setBpm(state.bpm + 5); });
  $('btnDec5').addEventListener('click', function () { setBpm(state.bpm - 5); });

  Metro.init({
    getState: function () { return state; },
    onBpmLive: function (bpm) {
      state.bpm = bpm;
      updateBpmUI();
    },
    onMeasure: function () { /* handled via draw events */ },
    onPractice: function (info) { updatePracticeUI(info); },
    onEnd: function (kind) {
      if (kind === 'practice') {
        Metro.stop();
        syncTransport();
        state.practice.running = false;
        resetPracticeUI();
        toast('Practice session complete');
        save();
      }
    }
  });

  /* ================= VISUAL LOOP ================= */
  const dotRefs = [];
  const perfDotRefs = [];
  const auxRefs = [];
  const stripRefs = [];
  let auxRowEl = null;
  let pvMainRefs = [];
  let pvAuxRefs = [];
  let tlNowEl = null;

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart CSS animation
    el.classList.add(cls);
  }

  function flashBeatDot(i) {
    if (dotRefs[i]) restartAnim(dotRefs[i], 'active');
    if (perfDotRefs[i]) restartAnim(perfDotRefs[i], 'active');
  }

  function applyEvent(ev) {
    switch (ev.kind) {
      case 'beat':
        flashBeatDot(ev.beatIdx);
        beatLabel.textContent = 'BEAT ' + (ev.beatIdx + 1);
        subLabelNow.textContent = '♩';
        if (ev.level > 0) {
          miniDot.classList.add('on');
          setTimeout(function () { miniDot.classList.remove('on'); }, 90);
        }
        if (state.visual.mode === 'pulse') restartAnim(instrument, 'pulse-hit');
        if (pvMainRefs.length) restartAnim(pvMainRefs[ev.beatIdx % pvMainRefs.length], 'active');
        break;
      case 'bar':
        barLabel.textContent = 'BAR ' + ev.bar;
        $('perfBar').textContent = 'BAR ' + ev.bar;
        break;
      case 'sub': {
        const idx = ev.beatIdx * state.subdiv.count + ev.subIdx;
        if (stripRefs[idx]) restartAnim(stripRefs[idx], 'active');
        const lbl = R.subLabel(state.subdiv.count, ev.subIdx);
        subLabelNow.textContent = lbl || '♩';
        break;
      }
      case 'poly':
      case 'meter':
        if (auxRefs[ev.idx]) restartAnim(auxRefs[ev.idx], 'active');
        if (pvAuxRefs[ev.idx]) restartAnim(pvAuxRefs[ev.idx], 'active');
        break;
    }
  }

  let frames = 0;
  let fpsT = performance.now();
  let fps = 0;
  function loop() {
    requestAnimationFrame(loop);
    const ctx = AE.ctx;
    if (ctx && Metro.running) {
      const now = ctx.currentTime;
      const q = Metro.queue;
      while (q.length && q[0].t <= now + 0.002) applyEvent(q.shift());
      if (state.visual.mode === 'ring') {
        const frac = clamp((now - Metro.measureStartT) / Math.max(0.05, Metro.measureDur), 0, 1);
        ringFill.style.strokeDashoffset = String(RING_C * (1 - frac));
      }
    }
    frames++;
    const t = performance.now();
    if (t - fpsT >= 1000) {
      fps = frames;
      frames = 0;
      fpsT = t;
      $('dgFps').textContent = fps + ' fps';
      updateAutoNow();
    }
  }

  /* ================= RENDERERS ================= */
  function renderSigChips() {
    sigChips.innerHTML = '';
    R.TIME_SIGS.forEach(function (sig) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = sig.beats + '/' + sig.unit;
      const on = state.timeSig.beats === sig.beats && state.timeSig.unit === sig.unit;
      b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', function () { setTimeSig(sig.beats, sig.unit); });
      sigChips.appendChild(b);
    });
  }

  function setTimeSig(beats, unit) {
    beats = clampInt(beats, 1, 24, 4);
    unit = [1, 2, 4, 8, 16].includes(unit) ? unit : 4;
    state.timeSig = { beats, unit };
    state.pattern = R.resizePattern(state.pattern, beats, unit);
    sigNum.value = String(beats);
    sigDen.value = String(unit);
    $('beatsCount').value = String(beats);
    sigLabel.textContent = beats + '/' + unit;
    $('perfSig').textContent = beats + '/' + unit;
    renderSigChips();
    renderRhythmViews();
    renderPolyVisual();
    updateModeHint();
    Metro.flushQueue();
    save();
  }

  function renderSubChips() {
    subChips.innerHTML = '';
    R.SUBDIVS.forEach(function (sub) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = sub.name + ' ' + sub.label;
      b.setAttribute('aria-pressed', String(state.subdiv.count === sub.count));
      b.addEventListener('click', function () { setSubdiv(sub.count); });
      subChips.appendChild(b);
    });
  }

  function setSubdiv(count) {
    count = clampInt(count, 1, 7, 1);
    state.subdiv = { count, slots: R.resizeSubSlots(state.subdiv.slots, count) };
    renderSubChips();
    renderRhythmViews();
    Metro.flushQueue();
    save();
  }

  function soundOptions(select, includeMain) {
    select.innerHTML = '';
    if (includeMain) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Same as main';
      select.appendChild(opt);
    }
    const g1 = document.createElement('optgroup');
    g1.label = 'Built-in';
    Object.keys(AE.BUILT_IN).forEach(function (k) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = AE.BUILT_IN[k].label;
      g1.appendChild(o);
    });
    select.appendChild(g1);
    const custom = Object.keys(state.customSounds);
    if (custom.length) {
      const g2 = document.createElement('optgroup');
      g2.label = 'Yours';
      custom.forEach(function (name) {
        const o = document.createElement('option');
        o.value = 'user:' + name;
        o.textContent = name;
        g2.appendChild(o);
      });
      select.appendChild(g2);
    }
  }

  function renderSoundSelects() {
    soundOptions(soundSelect, false);
    soundSelect.value = state.sound;
    if (soundSelect.selectedIndex === -1) { state.sound = 'digital'; soundSelect.value = 'digital'; }
    soundOptions(subSoundSelect, false);
    subSoundSelect.value = state.subSound.sound;
    if (subSoundSelect.selectedIndex === -1) { state.subSound.sound = 'tick'; subSoundSelect.value = 'tick'; }
    subSoundSelect.disabled = !state.subSound.enabled;
    subSoundToggle.checked = state.subSound.enabled;
    soundOptions($('polySound'), false);
    $('polySound').value = state.poly.sound;
    soundOptions($('beatSoundSelect'), true);
    renderCustomSoundsList();
    syncDesignerBase();
  }

  function cycleLevel(i) {
    const lv = state.pattern[i].level;
    state.pattern[i].level = (lv + 1) % 4;
    renderRhythmViews();
    save();
  }

  function renderBeatDots() {
    beatDots.innerHTML = '';
    dotRefs.length = 0;
    const perfDots = $('perfDots');
    perfDots.innerHTML = '';
    perfDotRefs.length = 0;
    state.pattern.forEach(function (b, i) {
      [beatDots, perfDots].forEach(function (container, ci) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'bdot';
        el.dataset.level = String(b.level);
        const num = document.createElement('span');
        num.className = 'bnum';
        num.textContent = String(i + 1);
        el.appendChild(num);
        el.setAttribute('aria-label', 'Beat ' + (i + 1) + ' — ' + LEVEL_NAMES[b.level] + '. Activate to change level.');
        el.addEventListener('click', function () { cycleLevel(i); });
        container.appendChild(el);
        if (ci === 0) dotRefs.push(el); else perfDotRefs.push(el);
      });
    });
  }

  function renderAux() {
    if (auxRowEl) { auxRowEl.remove(); auxRowEl = null; }
    auxRefs.length = 0;
    if (state.mode === 'standard') return;
    const n = state.mode === 'polyrhythm' ? state.poly.a : state.meter.beats;
    const label = state.mode === 'polyrhythm' ? 'POLY ' + state.poly.a + ':' + state.poly.b : 'METER ' + state.meter.beats;
    auxRowEl = document.createElement('div');
    auxRowEl.className = 'aux-row';
    const lab = document.createElement('span');
    lab.className = 'aux-label';
    lab.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'aux-dots';
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'adot';
      wrap.appendChild(d);
      auxRefs.push(d);
    }
    auxRowEl.appendChild(lab);
    auxRowEl.appendChild(wrap);
    const meta = visualizer.querySelector('.measure-readout');
    visualizer.insertBefore(auxRowEl, meta || null);
  }

  function renderStrip() {
    rhythmStrip.innerHTML = '';
    stripRefs.length = 0;
    const count = state.subdiv.count;
    state.pattern.forEach(function (b, i) {
      const group = document.createElement('div');
      group.className = 'sgroup';
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'scell main';
      main.dataset.level = String(b.level);
      const top = document.createElement('span');
      top.className = 'sc-top';
      top.textContent = LEVEL_SHORT[b.level];
      const lbl = document.createElement('span');
      lbl.className = 'sc-label';
      lbl.textContent = String(i + 1);
      main.appendChild(top);
      main.appendChild(lbl);
      main.setAttribute('aria-label', 'Beat ' + (i + 1) + ' — ' + LEVEL_NAMES[b.level] + '. Activate to change.');
      main.title = 'Click to cycle: accent → normal → soft → silent';
      main.addEventListener('click', function () { cycleLevel(i); });
      group.appendChild(main);
      stripRefs.push(main);
      for (let s = 1; s < count; s++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'scell';
        cell.dataset.state = String(state.subdiv.slots[s] === undefined ? 1 : state.subdiv.slots[s]);
        const top2 = document.createElement('span');
        top2.className = 'sc-top';
        top2.textContent = String(i + 1);
        const lbl2 = document.createElement('span');
        lbl2.className = 'sc-label';
        lbl2.textContent = R.subLabel(count, s) || '·';
        cell.appendChild(top2);
        cell.appendChild(lbl2);
        const st = state.subdiv.slots[s] === 2 ? 'accented' : state.subdiv.slots[s] === 0 ? 'off' : 'on';
        cell.setAttribute('aria-label', 'Subdivision ' + (i + 1) + ' ' + (R.subLabel(count, s) || '') + ' — ' + st + '. Activate to change.');
        cell.addEventListener('click', function () {
          const cur = state.subdiv.slots[s];
          state.subdiv.slots[s] = cur === 1 ? 2 : cur === 2 ? 0 : 1;
          renderStrip();
          save();
        });
        group.appendChild(cell);
        stripRefs.push(cell);
      }
      rhythmStrip.appendChild(group);
    });
  }

  function renderBeatsRow() {
    const row = $('beatsRow');
    row.innerHTML = '';
    state.pattern.forEach(function (b, i) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bpill' + (state.selectedBeat === i ? ' selected' : '');
      el.dataset.level = String(b.level);
      const num = document.createElement('span');
      num.className = 'bp-num';
      num.textContent = String(i + 1);
      const lv = document.createElement('span');
      lv.className = 'bp-lv';
      lv.textContent = LEVEL_SHORT[b.level];
      el.appendChild(num);
      el.appendChild(lv);
      el.addEventListener('click', function () {
        state.selectedBeat = i;
        renderBeatsRow();
        renderBeatDetail();
      });
      row.appendChild(el);
    });
  }

  function renderBeatDetail() {
    const i = clampInt(state.selectedBeat, 0, state.pattern.length - 1, 0);
    state.selectedBeat = i;
    const b = state.pattern[i];
    $('beatDetailTitle').textContent = 'Beat ' + (i + 1) + ' — ' + LEVEL_NAMES[b.level];
    $('beatDetailGrid').hidden = false;
    $('segLevel').querySelectorAll('button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(LEVEL_BY_NAME[btn.dataset.level] === b.level));
    });
    $('segProb').querySelectorAll('button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.prob) === b.prob));
    });
    $('beatSoundSelect').value = b.sound || '';
  }

  function renderRhythmViews() {
    renderBeatDots();
    renderStrip();
    renderBeatsRow();
    renderBeatDetail();
  }

  function updateModeHint() {
    if (state.mode === 'standard') {
      modeHint.textContent = 'One pattern, accents and subdivisions.';
    } else if (state.mode === 'polyrhythm') {
      modeHint.textContent = 'Secondary layer: ' + state.poly.a + ' pulses evenly spread over ' + state.poly.b + ' main beats.';
    } else {
      modeHint.textContent = 'A second meter of ' + state.meter.beats + ' beats (×' + state.meter.ratio + ' length) runs alongside.';
    }
  }

  function renderModeChips() {
    modeChips.querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.mode === state.mode));
    });
    app.dataset.mode = state.mode;
    updateModeHint();
  }

  function setMode(m) {
    state.mode = m;
    renderModeChips();
    renderAux();
    renderPolyVisual();
    Metro.flushQueue();
    save();
  }

  function pvRow(label, n) {
    const row = document.createElement('div');
    row.className = 'pv-row';
    const lab = document.createElement('span');
    lab.className = 'aux-label';
    lab.textContent = label;
    const track = document.createElement('div');
    track.className = 'pv-track';
    const refs = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('span');
      d.className = 'adot pv-dot';
      d.style.left = (n === 1 ? 50 : i / (n - 1) * 100) + '%';
      track.appendChild(d);
      refs.push(d);
    }
    row.appendChild(lab);
    row.appendChild(track);
    return { row, refs };
  }

  function renderPolyVisual() {
    const pv = $('polyVisual');
    pv.innerHTML = '';
    pvMainRefs = [];
    pvAuxRefs = [];
    if (state.mode === 'polyrhythm') {
      const m = pvRow('MAIN ' + state.poly.b, state.poly.b);
      const a = pvRow('POLY ' + state.poly.a, state.poly.a);
      pv.appendChild(m.row);
      pv.appendChild(a.row);
      pvMainRefs = m.refs;
      pvAuxRefs = a.refs;
      $('polyHint').textContent = 'Active — ' + state.poly.a + ' against ' + state.poly.b + '.';
    } else if (state.mode === 'polymeter') {
      const m = pvRow('MAIN ' + state.timeSig.beats, state.timeSig.beats);
      const a = pvRow('METER ' + state.meter.beats, state.meter.beats);
      pv.appendChild(m.row);
      pv.appendChild(a.row);
      pvMainRefs = m.refs;
      pvAuxRefs = a.refs;
      $('polyHint').textContent = 'Active — ' + state.timeSig.beats + ' beats against ' + state.meter.beats + ' (×' + state.meter.ratio + ').';
    } else {
      const d = document.createElement('span');
      d.className = 'dim';
      d.style.fontSize = '12px';
      d.textContent = 'Pick Polyrhythm or Polymeter in the Mode panel to preview layer alignment here.';
      pv.appendChild(d);
      $('polyHint').textContent = 'Enabled from the Mode panel on the main screen.';
    }
  }

  /* ================= CONSOLE DRAWER ================= */
  function openConsole(tab) {
    consoleEl.setAttribute('data-open', '1');
    consoleScrim.hidden = false;
    requestAnimationFrame(function () { consoleScrim.setAttribute('data-open', '1'); });
    consoleEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (tab) switchTab(tab);
    const active = consoleNav.querySelector('.cnav[aria-selected="true"]');
    if (active) active.focus();
  }
  function closeConsole() {
    consoleEl.removeAttribute('data-open');
    consoleScrim.removeAttribute('data-open');
    setTimeout(function () { consoleScrim.hidden = true; }, 220);
    consoleEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function switchTab(tab) {
    consoleNav.querySelectorAll('.cnav').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    consoleEl.querySelectorAll('.ctab').forEach(function (s) {
      s.hidden = s.dataset.tab !== tab;
    });
    if (tab === 'sound') initDesigner();
  }
  consoleNav.addEventListener('click', function (e) {
    const b = e.target.closest('.cnav');
    if (b) switchTab(b.dataset.tab);
  });
  $('btnConsole').addEventListener('click', function () { openConsole(); });
  $('btnConsoleClose').addEventListener('click', closeConsole);
  consoleScrim.addEventListener('click', closeConsole);
  $('btnPresetTop').addEventListener('click', function () { openConsole('presets'); });
  $('btnPatternHelp').addEventListener('click', function () { openConsole('rhythm'); });

  /* ================= RHYTHM TAB ================= */
  $('beatsCount').addEventListener('change', function () {
    setTimeSig(clampInt(this.value, 1, 24, 4), state.timeSig.unit);
  });
  $('btnResetPattern').addEventListener('click', function () {
    state.pattern = R.defaultPattern(state.timeSig.beats, state.timeSig.unit);
    renderRhythmViews();
    Metro.flushQueue();
    save();
    toast('Pattern reset');
  });
  $('sigApply').addEventListener('click', function () {
    const unit = clampInt(sigDen.value, 1, 16, 4);
    setTimeSig(clampInt(sigNum.value, 1, 24, 4), [1, 2, 4, 8, 16].includes(unit) ? unit : 4);
  });
  $('segLevel').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-level]');
    if (!b) return;
    const lv = LEVEL_BY_NAME[b.dataset.level];
    if (lv === undefined) return;
    state.pattern[state.selectedBeat].level = lv;
    renderRhythmViews();
    save();
  });
  $('segProb').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-prob]');
    if (!b) return;
    state.pattern[state.selectedBeat].prob = Number(b.dataset.prob);
    renderBeatDetail();
    save();
  });
  $('beatSoundSelect').addEventListener('change', function () {
    state.pattern[state.selectedBeat].sound = this.value || null;
    save();
  });

  /* BPM range & step */
  ['bpmMin', 'bpmMax', 'bpmStep'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      if (id === 'bpmStep') {
        state.bpmStep = [0.1, 0.5, 1, 5, 10].includes(Number(this.value)) ? Number(this.value) : 1;
      } else if (id === 'bpmMin') {
        state.bpmMin = clampInt(this.value, 20, 300, 20);
        if (state.bpmMin > state.bpmMax) { state.bpmMin = state.bpmMax; this.value = String(state.bpmMin); }
      } else {
        state.bpmMax = clampInt(this.value, 20, 300, 300);
        if (state.bpmMax < state.bpmMin) { state.bpmMax = state.bpmMin; this.value = String(state.bpmMax); }
      }
      bpmInput.min = String(Math.max(20, state.bpmMin));
      bpmInput.max = String(Math.min(300, state.bpmMax));
      if (state.bpm < state.bpmMin || state.bpm > state.bpmMax) setBpm(state.bpm, { force: true });
      save();
    });
  });

  /* ================= SOUND TAB ================= */
  let dTarget = 'main';
  const dProfiles = { main: null, sub: null };

  function currentProfileFor(target) {
    if (target === 'sub' && state.subSound.enabled) {
      return AE.getProfile(state.subSound.sound, state.customSounds);
    }
    return AE.getProfile(state.sound, state.customSounds);
  }

  const dEls = {
    wave: $('dWave'), base: $('dSoundBase'), freq: $('dFreq'), freqOut: $('dFreqOut'),
    attack: $('dAttack'), attackOut: $('dAttackOut'), decay: $('dDecay'), decayOut: $('dDecayOut'),
    noise: $('dNoise'), noiseOut: $('dNoiseOut'), filter: $('dFilter'), pan: $('dPan'),
    cutoff: $('dCutoff'), cutoffOut: $('dCutoffOut'), q: $('dQ'), qOut: $('dQOut'),
    accent: $('dAccent'), accentOut: $('dAccentOut')
  };

  function loadDesignerUI(p) {
    dEls.wave.value = p.wave;
    dEls.freq.value = String(Math.round(p.freq));
    dEls.attack.value = String(p.attack);
    dEls.decay.value = String(Math.round(p.decay));
    dEls.noise.value = String(Math.round(p.noise * 100));
    dEls.filter.value = p.filter;
    dEls.pan.value = String(p.pan);
    dEls.cutoff.value = String(Math.round(p.cutoff));
    dEls.q.value = String(p.q);
    dEls.accent.value = String(Math.round((p.accent || 0) * 100));
    updateDesignerOutputs();
  }

  function updateDesignerOutputs() {
    dEls.freqOut.textContent = dEls.freq.value + ' Hz';
    dEls.attackOut.textContent = Number(dEls.attack.value).toFixed(1) + ' ms';
    dEls.decayOut.textContent = dEls.decay.value + ' ms';
    dEls.noiseOut.textContent = dEls.noise.value + ' %';
    dEls.cutoffOut.textContent = dEls.cutoff.value + ' Hz';
    dEls.qOut.textContent = 'Q ' + Number(dEls.q.value).toFixed(1);
    dEls.accentOut.textContent = '+' + dEls.accent.value + ' %';
  }

  function readDesignerUI() {
    return {
      wave: dEls.wave.value,
      freq: Number(dEls.freq.value),
      bend: dProfiles[dTarget] ? dProfiles[dTarget].bend : 1,
      attack: Number(dEls.attack.value),
      decay: Number(dEls.decay.value),
      noise: Number(dEls.noise.value) / 100,
      filter: dEls.filter.value,
      pan: Number(dEls.pan.value),
      cutoff: Number(dEls.cutoff.value),
      q: Number(dEls.q.value),
      accent: Number(dEls.accent.value) / 100,
      gain: dProfiles[dTarget] ? dProfiles[dTarget].gain : 1
    };
  }

  function syncDesignerBase() {
    dEls.base.innerHTML = '';
    Object.keys(AE.BUILT_IN).forEach(function (k) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = AE.BUILT_IN[k].label;
      dEls.base.appendChild(o);
    });
  }

  function initDesigner() {
    dProfiles.main = Object.assign({}, currentProfileFor('main'));
    dProfiles.sub = Object.assign({}, currentProfileFor('sub'));
    loadDesignerUI(dProfiles[dTarget]);
  }

  $('designerTarget').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-target]');
    if (!b) return;
    dTarget = b.dataset.target;
    this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    loadDesignerUI(dProfiles[dTarget]);
  });

  Object.keys(dEls).forEach(function (k) {
    const el = dEls[k];
    if (!el || k === 'base' || k.endsWith('Out')) return;
    el.addEventListener('input', function () {
      dProfiles[dTarget] = readDesignerUI();
      updateDesignerOutputs();
    });
    el.addEventListener('change', function () {
      AE.preview(dProfiles[dTarget], 2);
    });
  });

  dEls.base.addEventListener('change', function () {
    const src = AE.BUILT_IN[this.value];
    if (!src) return;
    dProfiles[dTarget] = Object.assign({}, src);
    loadDesignerUI(dProfiles[dTarget]);
    AE.preview(dProfiles[dTarget], 2);
  });

  $('btnPreviewNormal').addEventListener('click', function () { AE.preview(dProfiles[dTarget], 2); });
  $('btnPreviewAccent').addEventListener('click', function () { AE.preview(dProfiles[dTarget], 3); });
  $('btnPreviewSub').addEventListener('click', function () { AE.preview(dProfiles[dTarget], 1); });

  $('btnSaveSound').addEventListener('click', function () {
    const name = $('dName').value.trim().slice(0, 24);
    if (!name) { toast('Give your sound a name first'); return; }
    const clean = AE.sanitizeProfile(readDesignerUI());
    state.customSounds[name] = clean;
    const key = 'user:' + name;
    if (dTarget === 'main') {
      state.sound = key;
    } else {
      state.subSound.enabled = true;
      state.subSound.sound = key;
    }
    renderSoundSelects();
    $('dName').value = '';
    toast('Sound “' + name + '” saved' + (AE.BUILT_IN[name] ? ' (custom)' : ''));
    save();
  });

  function renderCustomSoundsList() {
    const list = $('customSoundsList');
    list.innerHTML = '';
    const names = Object.keys(state.customSounds);
    if (!names.length) {
      const d = document.createElement('span');
      d.className = 'dim';
      d.style.fontSize = '12px';
      d.textContent = 'No custom sounds yet — design one and save it.';
      list.appendChild(d);
      return;
    }
    names.forEach(function (name) {
      const key = 'user:' + name;
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.dataset.current = (state.sound === key || state.subSound.sound === key) ? '1' : '0';
      const nm = document.createElement('button');
      nm.type = 'button';
      nm.className = 'pill-name';
      nm.textContent = name;
      nm.title = 'Use for main beats';
      nm.addEventListener('click', function () {
        state.sound = key;
        renderSoundSelects();
        save();
        toast('“' + name + '” set as main sound');
      });
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'ibtn';
      prev.setAttribute('aria-label', 'Preview ' + name);
      prev.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use href="#i-play"/></svg>';
      prev.addEventListener('click', function () { AE.preview(state.customSounds[name], 2); });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ibtn';
      del.setAttribute('aria-label', 'Delete ' + name);
      del.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use href="#i-trash"/></svg>';
      del.addEventListener('click', function () {
        delete state.customSounds[name];
        if (state.sound === key) state.sound = 'digital';
        if (state.subSound.sound === key) state.subSound.sound = 'tick';
        if (state.poly.sound === key) state.poly.sound = 'deep';
        if (state.meter.sound === key) state.meter.sound = 'wood';
        state.pattern.forEach(function (b) { if (b.sound === key) b.sound = null; });
        renderSoundSelects();
        save();
        toast('Sound deleted');
      });
      pill.appendChild(nm);
      pill.appendChild(prev);
      pill.appendChild(del);
      list.appendChild(pill);
    });
  }

  /* ================= PRACTICE ================= */
  function resetPracticeUI() {
    $('btnPractice').textContent = 'Start practice';
    $('btnPractice').dataset.running = 'false';
    $('practiceStatus').textContent = 'Idle';
    $('practiceBar').style.width = '0%';
  }

  function updatePracticeUI(info) {
    if (!info || info.phase === 'idle') {
      // Pausing the transport ends the active practice session cleanly.
      if (state.practice.running) {
        state.practice.running = false;
        save();
      }
      resetPracticeUI();
      return;
    }
    $('btnPractice').textContent = 'Stop practice';
    $('btnPractice').dataset.running = 'true';
    let txt = 'REP ' + info.rep + '/' + info.reps + ' · ' + R.fmtBpm(info.bpm, true) + ' BPM';
    if (info.resting) txt += ' · REST';
    $('practiceStatus').textContent = txt;
    $('practiceBar').style.width = Math.round(info.progress * 100) + '%';
  }

  ['pStart', 'pTarget', 'pStep', 'pEvery', 'pRest', 'pReps'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      const p = state.practice;
      p.start = clampInt($('pStart').value, 20, 300, 80);
      p.target = clampInt($('pTarget').value, 20, 300, 120);
      p.step = clampInt($('pStep').value, 1, 20, 5);
      p.every = clampInt($('pEvery').value, 5, 600, 60);
      p.restBars = clampInt($('pRest').value, 0, 32, 0);
      p.reps = clampInt($('pReps').value, 1, 20, 1);
      $('pStart').value = String(p.start);
      $('pTarget').value = String(p.target);
      $('pStep').value = String(p.step);
      $('pEvery').value = String(p.every);
      $('pRest').value = String(p.restBars);
      $('pReps').value = String(p.reps);
      save();
    });
  });

  function endPractice(keepPlaying) {
    state.practice.running = false;
    resetPracticeUI();
    if (Metro.running) {
      Metro.stop();
      if (keepPlaying) Metro.start();
    }
    syncTransport();
  }

  $('btnPractice').addEventListener('click', function () {
    if (state.practice.running) {
      endPractice(false);
      toast('Practice stopped');
      return;
    }
    // Fresh values from the form
    const p = state.practice;
    p.start = clampInt($('pStart').value, 20, 300, 80);
    p.target = clampInt($('pTarget').value, 20, 300, 120);
    p.step = clampInt($('pStep').value, 1, 20, 5);
    p.every = clampInt($('pEvery').value, 5, 600, 60);
    p.restBars = clampInt($('pRest').value, 0, 32, 0);
    p.reps = clampInt($('pReps').value, 1, 20, 1);
    if (p.start === p.target) { toast('Start and target tempo are the same'); return; }
    p.running = true;
    if (state.automation.enabled) {
      state.automation.enabled = false;
      $('autoEnable').checked = false;
    }
    Metro.stop();
    if (!Metro.start()) { p.running = false; showBanner('Audio could not start.'); return; }
    syncTransport();
    save();
  });

  /* ================= AUTOMATION ================= */
  function renderAutoPoints() {
    const box = $('autoPoints');
    box.innerHTML = '';
    state.automation.points.forEach(function (pt, i) {
      const row = document.createElement('div');
      row.className = 'arow';
      const tIn = document.createElement('input');
      tIn.type = 'number';
      tIn.className = 'num';
      tIn.min = '0';
      tIn.max = '3600';
      tIn.step = '5';
      tIn.value = String(pt.t);
      tIn.setAttribute('aria-label', 'Time in seconds');
      const bIn = document.createElement('input');
      bIn.type = 'number';
      bIn.className = 'num';
      bIn.min = '20';
      bIn.max = '300';
      bIn.value = String(pt.bpm);
      bIn.setAttribute('aria-label', 'Tempo in BPM');
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'ibtn';
      rm.setAttribute('aria-label', 'Remove point');
      rm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use href="#i-close"/></svg>';
      rm.addEventListener('click', function () {
        state.automation.points.splice(i, 1);
        renderAutoPoints();
        renderTimeline();
        save();
      });
      const commit = function () {
        pt.t = clamp(Number(tIn.value) || 0, 0, 3600);
        pt.bpm = clamp(Number(bIn.value) || state.bpm, 20, 300);
        state.automation.points.sort(function (a, b) { return a.t - b.t; });
        renderAutoPoints();
        renderTimeline();
        save();
      };
      tIn.addEventListener('change', commit);
      bIn.addEventListener('change', commit);
      row.appendChild(tIn);
      row.appendChild(bIn);
      row.appendChild(rm);
      box.appendChild(row);
    });
    renderTimeline();
  }

  function renderTimeline() {
    const tl = $('timeline');
    tl.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'timeline-line';
    tl.appendChild(line);
    tlNowEl = null;
    const pts = state.automation.points;
    if (!pts.length) return;
    const maxT = Math.max(pts[pts.length - 1].t, 1);
    pts.forEach(function (pt) {
      const m = document.createElement('span');
      m.className = 'tl-mark';
      m.style.left = clamp(pt.t / maxT, 0, 1) * 100 + '%';
      m.title = pt.t + 's · ' + pt.bpm + ' BPM';
      tl.appendChild(m);
    });
    const now = document.createElement('span');
    now.className = 'tl-mark tl-now';
    tl.appendChild(now);
    tlNowEl = now;
    updateAutoNow();
  }

  function updateAutoNow() {
    if (!tlNowEl || !state.automation.enabled) return;
    const pts = state.automation.points;
    const maxT = Math.max(pts.length ? pts[pts.length - 1].t : 1, 1);
    tlNowEl.style.left = clamp(Metro.elapsed / maxT, 0, 1) * 100 + '%';
  }

  $('btnAutoAdd').addEventListener('click', function () {
    const pts = state.automation.points;
    const lastT = pts.length ? pts[pts.length - 1].t : -30;
    pts.push({ t: Math.round(lastT + 30), bpm: Math.round(state.bpm) });
    pts.sort(function (a, b) { return a.t - b.t; });
    renderAutoPoints();
    save();
  });

  $('autoEnable').addEventListener('change', function () {
    if (this.checked) {
      if (!state.automation.points.length) {
        state.automation.points = [{ t: 0, bpm: Math.round(state.bpm) }, { t: 30, bpm: Math.round(clamp(state.bpm + 10, 20, 300)) }];
        renderAutoPoints();
      }
      if (state.practice.running) endPractice(true);
      if (Metro.running) { Metro.stop(); Metro.start(); syncTransport(); }
    }
    state.automation.enabled = this.checked;
    updateStatusLine();
    save();
  });

  $('autoMode').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-amode]');
    if (!b) return;
    state.automation.mode = b.dataset.amode;
    this.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    save();
  });

  /* ================= POLY TAB ================= */
  function renderPolyChips() {
    const cur = state.poly.a + ':' + state.poly.b;
    $('polyRatioChips').querySelectorAll('.chip').forEach(function (c) {
      c.setAttribute('aria-pressed', String(c.dataset.ratio === cur));
    });
  }
  function setRatio(a, b) {
    state.poly.a = clampInt(a, 2, 12, 3);
    state.poly.b = clampInt(b, 2, 12, 4);
    $('polyA').value = String(state.poly.a);
    $('polyB').value = String(state.poly.b);
    renderPolyChips();
    renderPolyVisual();
    renderAux();
    updateModeHint();
    save();
  }
  $('polyRatioChips').addEventListener('click', function (e) {
    const c = e.target.closest('.chip[data-ratio]');
    if (!c) return;
    const parts = c.dataset.ratio.split(':');
    setRatio(Number(parts[0]), Number(parts[1]));
  });
  $('polyA').addEventListener('change', function () { setRatio(this.value, state.poly.b); });
  $('polyB').addEventListener('change', function () { setRatio(state.poly.a, this.value); });
  $('polySound').addEventListener('change', function () { state.poly.sound = this.value; save(); });
  $('polyVol').addEventListener('input', function () {
    state.poly.vol = this.value / 100;
    $('polyVol').setAttribute('aria-valuenow', this.value);
    save();
  });
  $('meterBeats').addEventListener('change', function () {
    state.meter.beats = clampInt(this.value, 2, 13, 3);
    this.value = String(state.meter.beats);
    renderPolyVisual();
    renderAux();
    updateModeHint();
    save();
  });
  $('meterRatio').addEventListener('change', function () {
    state.meter.ratio = [0.5, 1, 2].includes(Number(this.value)) ? Number(this.value) : 1;
    renderPolyVisual();
    updateModeHint();
    save();
  });

  /* ================= PRESETS ================= */
  function download(text, filename, type) {
    try {
      const blob = new Blob([text], { type: type || 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      toast('Export failed: ' + e.message);
    }
  }

  function currentPresetData() {
    return {
      bpm: state.bpm,
      timeSig: { beats: state.timeSig.beats, unit: state.timeSig.unit },
      mode: state.mode,
      pattern: state.pattern.map(function (b) { return { level: b.level, prob: b.prob, sound: b.sound }; }),
      subdiv: { count: state.subdiv.count, slots: state.subdiv.slots.slice() },
      sound: state.sound,
      subSound: { enabled: state.subSound.enabled, sound: state.subSound.sound },
      poly: { a: state.poly.a, b: state.poly.b, sound: state.poly.sound, vol: state.poly.vol },
      meter: { beats: state.meter.beats, ratio: state.meter.ratio, sound: state.meter.sound, vol: state.meter.vol },
      volume: state.volume,
      visual: { mode: state.visual.mode }
    };
  }

  function applyPresetData(data) {
    state.bpm = clamp(data.bpm, Math.max(20, state.bpmMin), Math.min(300, state.bpmMax), state.bpm);
    state.timeSig = { beats: data.timeSig.beats, unit: data.timeSig.unit };
    state.pattern = R.resizePattern(data.pattern, data.timeSig.beats, data.timeSig.unit);
    state.subdiv = { count: data.subdiv.count, slots: R.resizeSubSlots(data.subdiv.slots, data.subdiv.count) };
    state.mode = data.mode;
    state.sound = data.sound;
    state.subSound = { enabled: data.subSound.enabled, sound: data.subSound.sound };
    if (data.poly) state.poly = Object.assign({}, state.poly, data.poly);
    if (data.meter) state.meter = Object.assign({}, state.meter, data.meter);
    if (data.volume !== undefined) {
      state.volume = clamp(data.volume, 0, 1, state.volume);
      volumeSlider.value = String(Math.round(state.volume * 100));
      volumeOut.textContent = String(Math.round(state.volume * 100));
      AE.setVolume(state.volume);
    }
    if (data.visual) {
      state.visual.mode = data.visual.mode;
      $('lookVisual').value = state.visual.mode;
      applyVisualMode();
    }
    syncAllInputs();
    Metro.flushQueue();
    save();
  }

  function presetMeta(rec) {
    const d = rec.data;
    return d.bpm + ' BPM · ' + d.timeSig.beats + '/' + d.timeSig.unit;
  }

  function renderPresets() {
    const built = $('builtinPresets');
    built.innerHTML = '';
    Presets.BUILT_IN.forEach(function (p) {
      const row = document.createElement('div');
      row.className = 'prow';
      const nm = document.createElement('button');
      nm.type = 'button';
      nm.className = 'prow-name';
      nm.textContent = p.name;
      nm.title = 'Apply preset';
      nm.addEventListener('click', function () {
        applyPresetData(Presets.sanitizePresetData(p.data));
        toast('Loaded “' + p.name + '”');
      });
      const meta = document.createElement('span');
      meta.className = 'prow-meta';
      meta.textContent = presetMeta({ data: p.data });
      row.appendChild(nm);
      row.appendChild(meta);
      built.appendChild(row);
    });

    const yours = $('userPresets');
    yours.innerHTML = '';
    if (!state.presets.length) {
      const d = document.createElement('span');
      d.className = 'dim';
      d.style.fontSize = '12px';
      d.textContent = 'Save your current setup to see it here.';
      yours.appendChild(d);
      return;
    }
    const sorted = state.presets.slice().sort(function (a, b) {
      return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);
    });
    sorted.forEach(function (rec) {
      const row = document.createElement('div');
      row.className = 'prow';
      const nm = document.createElement('button');
      nm.type = 'button';
      nm.className = 'prow-name';
      nm.textContent = (rec.favorite ? '★ ' : '') + rec.name;
      nm.title = 'Apply preset';
      nm.addEventListener('click', function () {
        applyPresetData(rec.data);
        toast('Loaded “' + rec.name + '”');
      });
      const meta = document.createElement('span');
      meta.className = 'prow-meta';
      meta.textContent = presetMeta(rec);

      const fav = mkIconBtn('i-star', rec.favorite ? 'Unfavorite' : 'Favorite', function () {
        rec.favorite = !rec.favorite;
        renderPresets();
        save();
      });
      if (rec.favorite) fav.classList.add('fav-on');

      const dup = mkIconBtn('i-copy', 'Duplicate', function () {
        const copy = Presets.sanitizePreset({ name: uniqueName(rec.name), favorite: false, data: rec.data });
        if (copy) { state.presets.push(copy); renderPresets(); save(); }
      });

      const ren = mkIconBtn('i-edit', 'Rename', function () {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'txt';
        input.maxLength = 28;
        input.value = rec.name;
        input.style.minWidth = '100px';
        nm.replaceWith(input);
        input.focus();
        input.select();
        const done = function () {
          const v = input.value.trim().slice(0, 28);
          if (v && v !== rec.name) {
            rec.name = uniqueName(v, rec.name);
            save();
          }
          renderPresets();
        };
        input.addEventListener('blur', done);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { e.stopPropagation(); input.blur(); }
          e.stopPropagation();
        });
      });

      const exp = mkIconBtn('i-out', 'Export as JSON', function () {
        download(Presets.makeExport([rec]), 'takt-' + rec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
      });

      const del = mkIconBtn('i-trash', 'Delete', function () {
        state.presets = state.presets.filter(function (r) { return r !== rec; });
        renderPresets();
        save();
        toast('Preset deleted');
      });

      row.appendChild(nm);
      row.appendChild(meta);
      row.appendChild(fav);
      row.appendChild(dup);
      row.appendChild(ren);
      row.appendChild(exp);
      row.appendChild(del);
      yours.appendChild(row);
    });
  }

  function mkIconBtn(icon, label, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ibtn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><use href="#' + icon + '"/></svg>';
    b.addEventListener('click', fn);
    return b;
  }

  function uniqueName(base, selfName) {
    let name = base;
    let n = 2;
    while (state.presets.some(function (r) { return r.name === name && r.name !== selfName; })) {
      name = base + ' ' + n;
      n++;
      if (n > 99) break;
    }
    return name;
  }

  $('btnPresetSave').addEventListener('click', function () {
    const name = ($('presetName').value.trim() || uniqueName('Preset ' + (state.presets.length + 1))).slice(0, 28);
    const rec = Presets.sanitizePreset({ name: name, favorite: false, data: currentPresetData() });
    if (!rec) { toast('Could not save preset'); return; }
    const existing = state.presets.find(function (r) { return r.name === rec.name; });
    if (existing) {
      existing.data = rec.data;
      toast('Preset “' + rec.name + '” updated');
    } else {
      state.presets.push(rec);
      toast('Preset “' + rec.name + '” saved');
    }
    $('presetName').value = '';
    renderPresets();
    save();
  });

  $('btnPresetExportAll').addEventListener('click', function () {
    if (!state.presets.length) { toast('No user presets to export yet'); return; }
    download(Presets.makeExport(state.presets), 'takt-presets.json');
    toast('Exported ' + state.presets.length + ' preset(s)');
  });

  $('btnPresetImport').addEventListener('click', function () { $('presetFile').click(); });
  $('presetFile').addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    if (file.size > 1024 * 512) { toast('File too large — presets stay under 512 KB'); return; }
    const reader = new FileReader();
    reader.onload = function () {
      const res = Presets.parseImport(String(reader.result));
      if (!res.presets.length) { toast('Import failed: ' + (res.error || 'invalid file')); return; }
      let added = 0;
      res.presets.forEach(function (p) {
        p.name = uniqueName(p.name);
        state.presets.push(p);
        added++;
      });
      renderPresets();
      save();
      toast(added + ' preset(s) imported');
    };
    reader.onerror = function () { toast('Could not read that file'); };
    reader.readAsText(file);
  });

  /* ================= QUICK PANELS WIRING ================= */
  soundSelect.addEventListener('change', function () {
    state.sound = this.value;
    save();
  });
  subSoundToggle.addEventListener('change', function () {
    state.subSound.enabled = this.checked;
    subSoundSelect.disabled = !this.checked;
    save();
  });
  subSoundSelect.addEventListener('change', function () {
    state.subSound.sound = this.value;
    save();
  });
  volumeSlider.addEventListener('input', function () {
    state.volume = this.value / 100;
    volumeOut.textContent = this.value;
    AE.setVolume(state.volume);
    save();
  });
  function toggleMute() {
    state.muted = !state.muted;
    AE.setMuted(state.muted);
    btnMute.setAttribute('aria-pressed', String(state.muted));
    btnMute.querySelector('use').setAttribute('href', state.muted ? '#i-mute' : '#i-sound');
    toast(state.muted ? 'Silent visual mode — visuals keep the beat' : 'Sound on');
    save();
  }
  btnMute.addEventListener('click', toggleMute);
  modeChips.addEventListener('click', function (e) {
    const c = e.target.closest('.chip[data-mode]');
    if (c) setMode(c.dataset.mode);
  });

  /* ================= LOOK TAB ================= */
  function applyVisualMode() {
    instrument.dataset.visual = state.visual.mode;
    visualizer.dataset.vmode = state.visual.mode;
    if (state.visual.mode !== 'ring') ringFill.style.strokeDashoffset = String(RING_C);
  }
  $('lookTheme').addEventListener('change', function () { state.theme = this.value; applyTheme(); save(); });
  $('lookDensity').addEventListener('change', function () { state.density = this.value; applyTheme(); save(); });
  $('lookMotion').addEventListener('change', function () { state.motion = this.value; applyTheme(); save(); });
  $('lookVisual').addEventListener('change', function () { state.visual.mode = this.value; applyVisualMode(); save(); });
  $('lookIntensity').addEventListener('input', function () {
    state.visual.intensity = this.value / 100;
    $('lookIntensityOut').textContent = this.value + ' %';
    html.style.setProperty('--vi', String(state.visual.intensity));
    save();
  });
  $('lookTabular').addEventListener('change', function () { state.decimals = this.checked; updateBpmUI(); save(); });
  $('lookHaptics').addEventListener('change', function () { state.haptics = this.checked; save(); });

  function renderAccentChips() {
    const box = $('accentChips');
    box.innerHTML = '';
    ACCENTS.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'acc-chip';
      b.dataset.accent = a;
      b.setAttribute('aria-pressed', String(state.accent === a));
      b.setAttribute('aria-label', a + ' accent');
      const colors = { lime: '#c8f04a', cyan: '#4fd8cb', amber: '#f0b03e', rose: '#f2708f', blue: '#6d9cff', red: '#f0604a' };
      b.style.background = colors[a];
      b.addEventListener('click', function () {
        state.accent = a;
        applyTheme();
        renderAccentChips();
        save();
      });
      box.appendChild(b);
    });
  }

  /* ================= SYSTEM TAB ================= */
  function updateDiagMini() {
    diagMini.textContent = 'ENGINE · ' + (Metro.running ? 'RUN' : 'IDLE') + (fps ? ' · ' + fps + ' FPS' : '');
  }

  setInterval(function () {
    $('dgCtx').textContent = AE.ctx ? AE.state() : 'not started';
    $('dgRate').textContent = AE.sampleRate() ? AE.sampleRate() + ' Hz' : '—';
    const lat = AE.latency();
    $('dgLat').textContent = lat !== null ? lat.toFixed(1) + ' ms' : 'n/a';
    $('dgSched').textContent = Metro.running ? 'running · 25 ms window' : 'idle';
    $('dgAhead').textContent = Math.round(Metro.lookahead * 1000) + ' ms';
    updateDiagMini();
  }, 500);

  $('btnOnboardAgain').addEventListener('click', function () {
    closeConsole();
    showOnboarding();
  });

  /* ================= SHORTCUTS ================= */
  let listeningAction = null;

  function keyLabel(k) {
    if (k === 'space') return 'Space';
    if (k === 'arrowup') return '↑';
    if (k === 'arrowdown') return '↓';
    if (k === 'arrowleft') return '←';
    if (k === 'arrowright') return '→';
    return k.length === 1 ? k.toUpperCase() : k;
  }

  function renderShortcuts() {
    const box = $('shortcutList');
    box.innerHTML = '';
    Object.keys(SHORTCUT_LABELS).forEach(function (action) {
      const row = document.createElement('div');
      row.className = 'scrow';
      const name = document.createElement('span');
      name.textContent = SHORTCUT_LABELS[action];
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'scrow-key';
      key.textContent = keyLabel(state.shortcuts[action]);
      key.setAttribute('aria-label', 'Rebind ' + SHORTCUT_LABELS[action]);
      key.addEventListener('click', function () { startRebind(action, key); });
      row.appendChild(name);
      row.appendChild(key);
      box.appendChild(row);
    });
  }

  function startRebind(action, keyEl) {
    if (listeningAction) return;
    listeningAction = { action, keyEl };
    keyEl.textContent = 'press…';
    keyEl.classList.add('listening');
  }

  window.addEventListener('keydown', function (e) {
    if (!listeningAction) return;
    e.preventDefault();
    e.stopPropagation();
    const { action, keyEl } = listeningAction;
    keyEl.classList.remove('listening');
    listeningAction = null;
    if (e.key === 'Escape' || e.ctrlKey || e.altKey || e.metaKey) {
      renderShortcuts();
      if (e.key !== 'Escape') toast('Modifier combos are not supported');
      return;
    }
    let k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    if (k === 'space' && e.code === 'Space') k = 'space';
    if (k.length > 10) { renderShortcuts(); return; }
    // Swap if another action already owns this key
    Object.keys(state.shortcuts).forEach(function (a) {
      if (a !== action && state.shortcuts[a] === k) state.shortcuts[a] = state.shortcuts[action];
    });
    state.shortcuts[action] = k;
    renderShortcuts();
    save();
  }, true);

  const shortcutActions = {
    play: playToggle,
    tap: doTap,
    inc: function () { setBpm(state.bpm + state.bpmStep); },
    dec: function () { setBpm(state.bpm - state.bpmStep); },
    inc5: function () { setBpm(state.bpm + 5); },
    dec5: function () { setBpm(state.bpm - 5); },
    mute: toggleMute,
    reset: function () {
      state.pattern = R.defaultPattern(state.timeSig.beats, state.timeSig.unit);
      renderRhythmViews();
      Metro.flushQueue();
      save();
      toast('Pattern reset');
    },
    fullscreen: function () { togglePerf(); },
    lock: function () {
      state.bpmLocked = !state.bpmLocked;
      syncLock();
      save();
      toast(state.bpmLocked ? 'Tempo locked' : 'Tempo unlocked');
    }
  };

  window.addEventListener('keydown', function (e) {
    if (listeningAction) return;
    const tgt = e.target;
    if (tgt && (tgt.matches('input, select, textarea, [contenteditable="true"]') || tgt.isContentEditable)) {
      if (e.key === 'Escape') tgt.blur();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if ($('perf').classList.contains('open')) { closePerf(); e.preventDefault(); }
      else if (consoleEl.getAttribute('data-open') === '1') { closeConsole(); e.preventDefault(); }
      else if (!bpmInput.hidden) exitBpmEdit(false);
      return;
    }
    const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
    let handled = false;
    Object.keys(state.shortcuts).forEach(function (a) {
      if (state.shortcuts[a] === k && shortcutActions[a]) {
        shortcutActions[a]();
        handled = true;
      }
    });
    if (handled) {
      e.preventDefault();
      updateDiagMini();
    }
  });

  /* ================= PERFORMANCE MODE ================= */
  const perfEl = $('perf');
  function openPerf() {
    renderBeatDots();
    $('perfSig').textContent = state.timeSig.beats + '/' + state.timeSig.unit;
    $('perfBpm').textContent = fmtBpm(state.bpm);
    syncTransport();
    perfEl.classList.add('open');
    perfEl.setAttribute('aria-hidden', 'false');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () { /* user agent refused — overlay still works */ });
    }
  }
  function closePerf() {
    perfEl.classList.remove('open');
    perfEl.setAttribute('aria-hidden', 'true');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () { /* ignore */ });
    }
  }
  function togglePerf() {
    if (perfEl.classList.contains('open')) closePerf();
    else openPerf();
  }
  $('btnFullscreen').addEventListener('click', togglePerf);
  $('perfClose').addEventListener('click', closePerf);
  $('perfPlay').addEventListener('click', playToggle);
  $('perfDec').addEventListener('click', function () { setBpm(state.bpm - state.bpmStep); });
  $('perfInc').addEventListener('click', function () { setBpm(state.bpm + state.bpmStep); });
  $('perfTap').addEventListener('click', doTap);

  /* ================= ONBOARDING ================= */
  const ONBOARD_STEPS = [
    ['TAKT', 'A precision rhythm instrument. Everything runs on your device — even offline.'],
    ['Set your tempo', 'Scroll or drag the big readout. Or tap TAP in rhythm and the tempo locks to you.'],
    ['Shape the rhythm', 'Pick a time signature, click beats in the strip to accent or silence them, add subdivisions.'],
    ['Make it yours', 'Design sounds, save presets, practice with automatic tempo ramps. Press F for performance mode.']
  ];
  let onboardIdx = 0;

  function renderOnboarding() {
    const step = ONBOARD_STEPS[onboardIdx];
    $('onboardStep').textContent = (onboardIdx + 1) + ' / ' + ONBOARD_STEPS.length;
    $('onboardTitle').textContent = step[0];
    $('onboardText').textContent = step[1];
    $('onboardNext').textContent = onboardIdx === ONBOARD_STEPS.length - 1 ? 'Start' : 'Next';
    const dots = $('onboardDots');
    dots.innerHTML = '';
    ONBOARD_STEPS.forEach(function (_, i) {
      const d = document.createElement('span');
      d.className = 'dot' + (i === onboardIdx ? ' on' : '');
      dots.appendChild(d);
    });
  }

  function showOnboarding() {
    onboardIdx = 0;
    renderOnboarding();
    $('onboarding').hidden = false;
    $('onboardNext').focus();
  }

  function finishOnboarding() {
    $('onboarding').hidden = true;
    if ($('onboardDontShow').checked) {
      state.ui.onboarded = true;
      save();
    }
  }

  $('onboardNext').addEventListener('click', function () {
    if (onboardIdx < ONBOARD_STEPS.length - 1) {
      onboardIdx++;
      renderOnboarding();
    } else {
      finishOnboarding();
    }
  });
  $('onboardSkip').addEventListener('click', finishOnboarding);

  /* ================= PWA ================= */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    const btn = document.createElement('button');
    btn.id = 'btnInstall';
    btn.type = 'button';
    btn.className = 'tbtn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15"><use href="#i-in"/></svg><span>Install</span>';
    btn.addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function () { deferredInstall = null; btn.remove(); });
    });
    const fs = $('btnFullscreen');
    fs.parentElement.insertBefore(btn, fs);
  });
  window.addEventListener('appinstalled', function () {
    toast('TAKT installed — it now works fully offline');
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline caching unavailable — app still works */ });
    });
  }

  /* ================= INIT ================= */
  function syncAllInputs() {
    sigNum.value = String(state.timeSig.beats);
    sigDen.value = String(state.timeSig.unit);
    $('beatsCount').value = String(state.timeSig.beats);
    sigLabel.textContent = state.timeSig.beats + '/' + state.timeSig.unit;
    $('perfSig').textContent = state.timeSig.beats + '/' + state.timeSig.unit;
    $('bpmMin').value = String(state.bpmMin);
    $('bpmMax').value = String(state.bpmMax);
    $('bpmStep').value = String(state.bpmStep);
    bpmInput.min = String(Math.max(20, state.bpmMin));
    bpmInput.max = String(Math.min(300, state.bpmMax));
    volumeSlider.value = String(Math.round(state.volume * 100));
    volumeOut.textContent = String(Math.round(state.volume * 100));
    btnMute.setAttribute('aria-pressed', String(state.muted));
    btnMute.querySelector('use').setAttribute('href', state.muted ? '#i-mute' : '#i-sound');
    $('pStart').value = String(state.practice.start);
    $('pTarget').value = String(state.practice.target);
    $('pStep').value = String(state.practice.step);
    $('pEvery').value = String(state.practice.every);
    $('pRest').value = String(state.practice.restBars);
    $('pReps').value = String(state.practice.reps);
    $('autoEnable').checked = state.automation.enabled;
    $('autoMode').querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.amode === state.automation.mode));
    });
    $('polyA').value = String(state.poly.a);
    $('polyB').value = String(state.poly.b);
    $('polyVol').value = String(Math.round(state.poly.vol * 100));
    $('meterBeats').value = String(state.meter.beats);
    $('meterRatio').value = String(state.meter.ratio);
    $('lookTheme').value = state.theme;
    $('lookDensity').value = state.density;
    $('lookMotion').value = state.motion;
    $('lookVisual').value = state.visual.mode;
    $('lookIntensity').value = String(Math.round(state.visual.intensity * 100));
    $('lookIntensityOut').textContent = Math.round(state.visual.intensity * 100) + ' %';
    $('lookTabular').checked = state.decimals;
    $('lookHaptics').checked = state.haptics;
    syncLock();
    renderSoundSelects();
    renderSigChips();
    renderSubChips();
    renderPolyChips();
    renderModeChips();
    renderAux();
    renderRhythmViews();
    renderPolyVisual();
    renderAutoPoints();
    renderPresets();
    renderAccentChips();
    renderShortcuts();
    updateBpmUI();
    applyVisualMode();
    syncTransport();
  }

  /* Audio context unlock after first gesture (autoplay policy) */
  ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function unlock() {
      AE.resume();
    }, { once: true, passive: true });
  });

  window.addEventListener('error', function (e) {
    if (e && e.message) showBanner('Something went wrong: ' + e.message);
  });

  ringFill.style.strokeDasharray = String(RING_C);
  ringFill.style.strokeDashoffset = String(RING_C);
  applyTheme();
  syncAllInputs();
  resetPracticeUI();
  loop();

  if (!state.ui.onboarded) {
    setTimeout(showOnboarding, 400);
  }
})();

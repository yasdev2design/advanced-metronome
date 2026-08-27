/* presets.js — built-in presets, deep-sanitization for imports, JSON portability.
   Every imported field is whitelisted, type-checked and clamped; unknown keys
   are dropped (no prototype-pollution vectors, nothing imported is ever executed). */
(function () {
  'use strict';

  const R = window.Rhythm;
  const AE = window.AudioEngine;

  const EXPORT_TYPE = 'takt-preset';
  const EXPORT_VERSION = 1;

  function pat(levels, probs) {
    return levels.map(function (lv, i) {
      return { level: lv, prob: probs ? probs[i] || 100 : 100, sound: null };
    });
  }

  const BUILT_IN = [
    { name: 'Classic 4/4', icon: 'std', data: { bpm: 120, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 2, 2, 2]), subdiv: { count: 1, slots: [1] }, sound: 'digital', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Slow Practice', icon: 'std', data: { bpm: 60, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 2, 2, 2]), subdiv: { count: 2, slots: [1, 1] }, sound: 'softwood', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Fast Practice', icon: 'std', data: { bpm: 160, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 2, 2, 2]), subdiv: { count: 1, slots: [1] }, sound: 'wood', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Jazz Ride', icon: 'std', data: { bpm: 132, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([1, 3, 2, 3]), subdiv: { count: 2, slots: [1, 1] }, sound: 'rim', subSound: { enabled: true, sound: 'tick' } } },
    { name: 'Rock', icon: 'std', data: { bpm: 120, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 2, 3, 2]), subdiv: { count: 2, slots: [1, 0] }, sound: 'electronic', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Electronic', icon: 'std', data: { bpm: 128, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 1, 2, 1]), subdiv: { count: 4, slots: [1, 0, 1, 0] }, sound: 'synth', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Triplet Feel', icon: 'std', data: { bpm: 100, timeSig: { beats: 4, unit: 4 }, mode: 'standard', pattern: pat([3, 2, 2, 2]), subdiv: { count: 3, slots: [1, 1, 1] }, sound: 'classic', subSound: { enabled: true, sound: 'tick' } } },
    { name: '6/8 Shuffle', icon: 'std', data: { bpm: 90, timeSig: { beats: 6, unit: 8 }, mode: 'standard', pattern: pat([3, 1, 1, 3, 1, 1]), subdiv: { count: 1, slots: [1] }, sound: 'wood', subSound: { enabled: false, sound: 'digital' } } },
    { name: '12/8 Ballad', icon: 'std', data: { bpm: 60, timeSig: { beats: 12, unit: 8 }, mode: 'standard', pattern: pat([3, 1, 1, 2, 1, 1, 3, 1, 1, 2, 1, 1]), subdiv: { count: 1, slots: [1] }, sound: 'softwood', subSound: { enabled: false, sound: 'digital' } } },
    { name: 'Polyrhythm 3:4', icon: 'poly', data: { bpm: 100, timeSig: { beats: 4, unit: 4 }, mode: 'polyrhythm', pattern: pat([3, 2, 2, 2]), subdiv: { count: 1, slots: [1] }, sound: 'digital', subSound: { enabled: false, sound: 'digital' }, poly: { a: 3, b: 4, sound: 'deep', vol: 0.7 } } },
    { name: 'Polymeter 3+4', icon: 'poly', data: { bpm: 110, timeSig: { beats: 4, unit: 4 }, mode: 'polymeter', pattern: pat([3, 2, 2, 2]), subdiv: { count: 1, slots: [1] }, sound: 'digital', subSound: { enabled: false, sound: 'digital' }, meter: { beats: 3, ratio: 1, sound: 'wood', vol: 0.7 } } }
  ];

  const num = function (v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  };
  const bool = function (v, dflt) { return typeof v === 'boolean' ? v : dflt; };
  const str = function (v, max, dflt) {
    if (typeof v !== 'string') return dflt;
    v = v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
    return v || dflt;
  };
  const soundKey = function (v, dflt) {
    if (typeof v !== 'string') return dflt;
    if (v.indexOf('user:') === 0) return 'user:' + str(v.slice(5), 24, dflt);
    return AE.BUILT_IN[v] ? v : dflt;
  };

  /**
   * Convert arbitrary input into a safe preset `data` object, or null if unusable.
   * Only whitelisted fields survive, all numbers clamped, all strings cleaned.
   */
  function sanitizePresetData(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const sig = raw.timeSig && typeof raw.timeSig === 'object' ? raw.timeSig : {};
    const beats = Math.round(num(sig.beats, 1, 24, 4));
    const unit = [1, 2, 4, 8, 16].includes(sig.unit) ? sig.unit : 4;

    let pattern = R.defaultPattern(beats, unit);
    if (Array.isArray(raw.pattern)) {
      const src = raw.pattern.slice(0, 24);
      pattern = src.map(function (b, i) {
        if (!b || typeof b !== 'object') return pattern[i];
        return {
          level: [0, 1, 2, 3].includes(b.level) ? b.level : pattern[i].level,
          prob: [50, 75, 100].includes(b.prob) ? b.prob : 100,
          sound: b.sound ? soundKey(b.sound, null) : null
        };
      });
      while (pattern.length < beats) pattern.push(R.defaultPattern(beats, unit)[pattern.length]);
      pattern.length = beats;
    }

    let count = Math.round(num(raw.subdiv && raw.subdiv.count, 1, 7, 1));
    let slots = R.defaultSubSlots(count);
    if (raw.subdiv && Array.isArray(raw.subdiv.slots)) {
      slots = R.resizeSubSlots(raw.subdiv.slots, count);
    }

    const mode = ['standard', 'polyrhythm', 'polymeter'].includes(raw.mode) ? raw.mode : 'standard';

    const out = {
      bpm: num(raw.bpm, 20, 300, 120),
      timeSig: { beats, unit },
      mode,
      pattern,
      subdiv: { count, slots },
      sound: soundKey(raw.sound, 'digital'),
      subSound: {
        enabled: bool(raw.subSound && raw.subSound.enabled, false),
        sound: soundKey(raw.subSound && raw.subSound.sound, 'digital')
      }
    };

    if (raw.poly && typeof raw.poly === 'object') {
      out.poly = {
        a: Math.round(num(raw.poly.a, 2, 12, 3)),
        b: Math.round(num(raw.poly.b, 2, 12, 4)),
        sound: soundKey(raw.poly.sound, 'deep'),
        vol: num(raw.poly.vol, 0, 1, 0.7)
      };
    }
    if (raw.meter && typeof raw.meter === 'object') {
      out.meter = {
        beats: Math.round(num(raw.meter.beats, 2, 13, 3)),
        ratio: [0.5, 1, 2].includes(Number(raw.meter.ratio)) ? Number(raw.meter.ratio) : 1,
        sound: soundKey(raw.meter.sound, 'wood'),
        vol: num(raw.meter.vol, 0, 1, 0.7)
      };
    }
    if (raw.volume !== undefined) out.volume = num(raw.volume, 0, 1, 0.8);
    if (raw.visual && typeof raw.visual === 'object' && ['grid', 'ring', 'pulse', 'minimal'].includes(raw.visual.mode)) {
      out.visual = { mode: raw.visual.mode };
    }
    return out;
  }

  /** Validate a full user-preset record {name, favorite, data}. */
  function sanitizePreset(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const name = str(rec.name, 28, null);
    const data = sanitizePresetData(rec.data);
    if (!name || !data) return null;
    return { name, favorite: bool(rec.favorite, false), data };
  }

  /** Parse an import payload string -> array of safe presets (may be empty). */
  function parseImport(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { presets: [], error: 'Not valid JSON.' }; }
    if (!parsed || typeof parsed !== 'object') return { presets: [], error: 'Unrecognized file.' };

    let list = null;
    if (Array.isArray(parsed)) list = parsed;
    else if (Array.isArray(parsed.presets)) list = parsed.presets;
    else if (parsed.data) list = [parsed];

    if (!list) return { presets: [], error: 'No presets found in file.' };

    const out = [];
    for (let i = 0; i < list.length && i < 100; i++) {
      const clean = sanitizePreset(list[i]);
      if (clean) out.push(clean);
    }
    if (!out.length) return { presets: [], error: 'No valid presets in file.' };
    return { presets: out, error: null };
  }

  /** Build an export payload for the given preset records. */
  function makeExport(records) {
    return JSON.stringify({
      type: EXPORT_TYPE,
      version: EXPORT_VERSION,
      app: 'TAKT',
      exported: new Date().toISOString(),
      presets: records.map(sanitizePreset).filter(Boolean)
    }, null, 2);
  }

  window.Presets = {
    BUILT_IN,
    sanitizePreset,
    sanitizePresetData,
    parseImport,
    makeExport
  };
})();

/* rhythm-engine.js — musical model: time signatures, beat patterns,
   subdivisions, tempo terminology. Pure logic, no audio, no DOM. */
(function () {
  'use strict';

  const TIME_SIGS = [
    { beats: 2, unit: 4 }, { beats: 3, unit: 4 }, { beats: 4, unit: 4 },
    { beats: 5, unit: 4 }, { beats: 6, unit: 8 }, { beats: 7, unit: 8 },
    { beats: 9, unit: 8 }, { beats: 12, unit: 8 }
  ];

  /* Subdivision counts: 1 quarter, 2 eighths, 3 triplets, … 7 septuplets */
  const SUBDIVS = [
    { count: 1, label: '♩', name: 'Quarter' },
    { count: 2, label: '♪♪', name: 'Eighth' },
    { count: 3, label: '♪♪♪', name: 'Triplet' },
    { count: 4, label: '♬', name: '16th' },
    { count: 5, label: '×5', name: 'Quintuplet' },
    { count: 6, label: '×6', name: 'Sextuplet' },
    { count: 7, label: '×7', name: 'Septuplet' }
  ];

  /* Labels for the slots after the main beat within one pulse. */
  const SUB_LABELS = ['&', 'e', 'a', '2', '3', '4'];

  function subLabel(count, i) {
    if (i === 0) return null;
    return SUB_LABELS[Math.min(i - 1, SUB_LABELS.length - 1)];
  }

  /** Default beat pattern for a time signature (levels: 3 accent, 2 normal, 1 soft, 0 silent). */
  function defaultPattern(beats, unit) {
    const out = [];
    for (let i = 0; i < beats; i++) {
      let level = 2;
      if (i === 0) level = 3;
      else if (unit === 8 && i % 3 === 0) level = 3; // compound meter: accent every 3 eighths
      else if (unit === 8 && i % 3 === 2) level = 1;
      out.push({ level, prob: 100, sound: null });
    }
    return out;
  }

  /** Resize a pattern, preserving existing beats, defaulting new ones. */
  function resizePattern(pattern, beats, unit) {
    const dflt = defaultPattern(beats, unit);
    const out = [];
    for (let i = 0; i < beats; i++) {
      const old = pattern && pattern[i];
      out.push(old ? {
        level: [0, 1, 2, 3].includes(old.level) ? old.level : dflt[i].level,
        prob: [50, 75, 100].includes(old.prob) ? old.prob : 100,
        sound: typeof old.sound === 'string' ? old.sound : null
      } : dflt[i]);
    }
    return out;
  }

  function defaultSubSlots(count) {
    return new Array(Math.max(1, count)).fill(true).map(function () { return 1; }); // 1 normal
  }

  function resizeSubSlots(slots, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const v = slots && slots[i] !== undefined ? slots[i] : 1;
      out.push([0, 1, 2].includes(v) ? v : 1);
    }
    out[0] = 1;
    return out;
  }

  /* Italian tempo terms for the readout. */
  const TEMPO_TERMS = [
    [40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'],
    [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'],
    [200, 'Presto'], [Infinity, 'Prestissimo']
  ];

  function tempoTerm(bpm) {
    for (let i = 0; i < TEMPO_TERMS.length; i++) {
      if (bpm < TEMPO_TERMS[i][0]) return TEMPO_TERMS[i][1];
    }
    return 'Prestissimo';
  }

  const clamp = function (v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) v = dflt !== undefined ? dflt : lo;
    return Math.min(hi, Math.max(lo, v));
  };

  /** Format BPM for display: optional decimals only when fractional. */
  function fmtBpm(bpm, decimals) {
    if (!decimals || Math.abs(bpm - Math.round(bpm)) < 0.05) return String(Math.round(bpm));
    return (Math.round(bpm * 10) / 10).toFixed(1);
  }

  window.Rhythm = {
    TIME_SIGS,
    SUBDIVS,
    subLabel,
    defaultPattern,
    resizePattern,
    defaultSubSlots,
    resizeSubSlots,
    tempoTerm,
    clamp,
    fmtBpm
  };
})();

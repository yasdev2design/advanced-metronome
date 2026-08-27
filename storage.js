/* storage.js — safe persistence layer (localStorage with graceful degradation) */
(function () {
  'use strict';

  const PREFIX = 'takt.v1.';
  let available = true;

  function test() {
    try {
      const k = PREFIX + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      available = true;
    } catch (e) {
      available = false;
    }
  }
  test();

  /** In-memory fallback when localStorage is blocked (private mode etc.) */
  const mem = Object.create(null);

  function get(key, fallback) {
    const full = PREFIX + key;
    let raw = null;
    if (available) {
      try { raw = localStorage.getItem(full); } catch (e) { raw = null; }
    } else {
      raw = mem[full] !== undefined ? mem[full] : null;
    }
    if (raw === null || raw === undefined) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    const full = PREFIX + key;
    let raw;
    try { raw = JSON.stringify(value); } catch (e) { return false; }
    if (available) {
      try { localStorage.setItem(full, raw); return true; } catch (e) { /* quota / blocked */ }
    }
    mem[full] = raw;
    return true;
  }

  function remove(key) {
    const full = PREFIX + key;
    if (available) {
      try { localStorage.removeItem(full); } catch (e) { /* ignore */ }
    }
    delete mem[full];
  }

  window.Store = {
    get,
    set,
    remove,
    get available() { return available; }
  };
})();

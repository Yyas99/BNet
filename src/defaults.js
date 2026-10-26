/* Shared settings + storage helpers (content script, background, popup, settings). */
(function (root) {
  'use strict';
  const DEFAULTS = {
    enabled: true,
    pausedUntil: 0,
    dial: 2, // 1 Gentle, 2 Balanced, 3 Strict
    categories: {
      racism: true, religion: true, sexism: true, lgbtq: true, ableism: true,
      slurs: true, dehumanising: true, extremism: true, political: false
    },
    treatment: 'frost',
    perCategory: {
      racism: 'default', religion: 'default', sexism: 'default', lgbtq: 'default', ableism: 'default',
      slurs: 'default', dehumanising: 'default', extremism: 'default', political: 'default'
    },
    scope: 'phrase', // phrase | sentence
    surfaces: { posts: true, quotes: true, names: true, bios: true, images: true },
    reveal: true,
    badge: true,
    learn: true
  };

  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const k of Object.keys(over || {})) {
      const v = over[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') ? merge(base[k], v) : v;
    }
    return out;
  }

  const store = {
    async get(keys) { return chrome.storage.local.get(keys); },
    async settings() {
      const { settings } = await chrome.storage.local.get('settings');
      return merge(DEFAULTS, settings || {});
    },
    async saveSettings(patch) {
      const cur = await store.settings();
      const next = merge(cur, patch);
      await chrome.storage.local.set({ settings: next });
      return next;
    },
    isActive(s) { return !!s.enabled && Date.now() >= (s.pausedUntil || 0); }
  };

  const today = (d) => (d || new Date()).toLocaleDateString('en-CA');

  root.BNetDefaults = { DEFAULTS, merge, store, today };
})(typeof globalThis !== 'undefined' ? globalThis : this);

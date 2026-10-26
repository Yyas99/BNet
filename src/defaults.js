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
    surfaces: { web: true, posts: true, quotes: true, names: true, bios: true, images: true },
    offSites: [], // sites where BNet stays off, by host name without www.
    reveal: true,
    badge: true,
    learn: true
  };

  const kind = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

  // Settings come from storage, which can hold anything (an old version, a hand edit, a half-written
  // value). A value whose type does not match the default is ignored, so one bad key never breaks a page.
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (kind(over) !== 'object') return out;
    for (const k of Object.keys(over)) {
      const v = over[k];
      const want = base && Object.prototype.hasOwnProperty.call(base, k) ? kind(base[k]) : null;
      if (want && want !== kind(v)) continue;
      out[k] = want === 'object' ? merge(base[k], v) : v;
    }
    return out;
  }

  // merge() plus the few value checks a type check cannot make.
  function clean(over) {
    const s = merge(DEFAULTS, over);
    if (![1, 2, 3].includes(s.dial)) s.dial = DEFAULTS.dial;
    if (!['phrase', 'sentence'].includes(s.scope)) s.scope = DEFAULTS.scope;
    if (!Number.isFinite(s.pausedUntil)) s.pausedUntil = 0;
    s.offSites = [...new Set(s.offSites.filter(x => typeof x === 'string' && x).map(x => x.toLowerCase().replace(/^www\./, '')))];
    return s;
  }

  const store = {
    async get(keys) { return chrome.storage.local.get(keys); },
    async settings() {
      let settings;
      try { ({ settings } = await chrome.storage.local.get('settings')); } catch (e) { settings = null; }
      return clean(settings);
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

  root.BNetDefaults = { DEFAULTS, merge, clean, store, today };
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* BNet background: rule lists, stats, learning log, allow list; OCR broker; badge; context menu; shortcuts.
 * MV3 can stop this worker at any moment, so nothing here relies on memory surviving: every in-memory
 * value is a cache or a queue whose callers cope with a dropped reply, and real state lives in storage. */
importScripts('defaults.js', 'engine.js', 'lists.js');
const D = self.BNetDefaults, E = self.BNetEngine, Lists = self.BNetLists;

const CATS = [
  ['racism', 'Racism & ethnic hate'], ['religion', 'Religious hate'], ['sexism', 'Misogyny & sexism'],
  ['lgbtq', 'Anti-LGBTQ+ hate'], ['ableism', 'Ableist hate'], ['slurs', 'Slurs'], ['dehumanising', 'Dehumanising language'],
  ['extremism', 'Violent extremism'], ['political', 'Political hostility']
];
const WEB_URLS = ['http://*/*', 'https://*/*'];
const SCHEMA = 2;                       // bump with a step in migrate() when stored data changes shape
// The learning log keeps every hand action (rare, valuable) but only the latest automatic hits: Settings
// shows 300 and Copy request uses 80, and hits are what made the log big and slow to rewrite.
const LOG_CAP = 5000, HIT_CAP = 600, SEEN_CAP = 5000, DAYS_KEPT = 120, ALLOW_CAP = 5000;
const LIST_MAX_BYTES = 3e6, LIST_MAX_RULES = 50000, USER_MAX_BYTES = 500e3, FETCH_MS = 20000;
const HOUR = 3600e3, DAY = 864e5;
const BUILTIN = [{ id: 'core', path: 'rules/core.txt' }];
const CONTENT_JS = ['src/defaults.js', 'src/engine.js', 'src/treatments.js', 'src/content.js'];

let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(err => console.warn('BNet', err)); return run.catch(err => ({ ok: false, error: String(err && err.message || err) })); };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
async function get(keys) {
  try { return (await chrome.storage.local.get(keys)) || {}; } catch (e) { console.warn('BNet storage', e); return {}; }
}
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cut = (s, n) => typeof s === 'string' ? s.slice(0, n) : '';
// Learning-log addresses keep the page, not the query string or fragment (search terms, tokens).
const pageOnly = u => { try { const x = new URL(u); return (x.origin + x.pathname).slice(0, 300); } catch (e) { return ''; } };
const siteOf = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname.replace(/^www\./, '') : ''; } catch (e) { return ''; } };

/* ---------- storage schema + repair ---------- */
function capLog(log) {
  let hits = 0;
  const out = [];
  for (let i = log.length - 1; i >= 0 && out.length < LOG_CAP; i--) {
    if (log[i].kind === 'hit' && ++hits > HIT_CAP) continue;
    out.push(log[i]);
  }
  return out.reverse();
}
function trimEntry(e) {
  return Object.assign({}, e, { span: cut(e.span, 200), ctx: cut(e.ctx, 400), url: pageOnly(e.url || '') });
}

// Stored settings minus values of the wrong type or range. Defaults are not written in, so a key the
// person never changed still follows the defaults of later versions.
function prune(base, over) {
  if (!isObj(over)) return {};
  const out = {};
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) { out[k] = v; continue; }
    const b = base[k];
    if (isObj(b)) { if (isObj(v)) out[k] = prune(b, v); continue; }
    if (Array.isArray(b) ? Array.isArray(v) : typeof v === typeof b && v !== null) out[k] = v;
  }
  if (base === D.DEFAULTS) {
    const c = D.clean(out);
    for (const k of ['dial', 'scope', 'pausedUntil', 'offSites']) if (k in out) out[k] = c[k];
  }
  return out;
}

// Runs once per browser session (and after install/update): brings old data up to date and repairs
// anything corrupted or half-written, so the rest of the code can trust the shapes it reads.
async function migrate() {
  const st = await get(['schema', 'settings', 'lists', 'log', 'stats', 'allow', 'userRules', 'personal', 'packs', 'packStates']);
  const patch = {};
  // v1.2 and older kept hand-added phrases in "personal" and imported JSON packs in "packs".
  let user = typeof st.userRules === 'string' ? st.userRules : null;
  if (user == null) {
    user = '! My rules: one rule per line. Right-click text on any page and choose "Mute with BNet" to add one.\n';
    for (const p of (isObj(st.personal) && Array.isArray(st.personal.phrases) && st.personal.phrases) || []) {
      if (!p || !p.pattern) continue;
      user += 'phrase ' + ((p.cats && p.cats[0]) || 'dehumanising') + ' ' + (p.sev || 3) + ' ' + (p.literal ? p.pattern : '/' + p.pattern + '/') + '\n';
    }
  }
  let lists = Array.isArray(st.lists) ? st.lists.filter(l => isObj(l) && typeof l.id === 'string') : [];
  lists = lists.filter((l, i) => lists.findIndex(x => x.id === l.id) === i);
  for (const p of Array.isArray(st.packs) ? st.packs : []) {
    try { if (!lists.some(l => l.id === p.id)) lists.push(Object.assign(entryFrom(parseAny(Lists.fromPack(p.data), p.id, true), { id: p.id, kind: 'file', title: p.name }), { enabled: p.enabled !== false })); } catch (e) {}
  }
  if (JSON.stringify(lists) !== JSON.stringify(st.lists)) patch.lists = lists;
  if (st.settings !== undefined) {
    const kept = prune(D.DEFAULTS, st.settings);
    if (JSON.stringify(kept) !== JSON.stringify(st.settings)) patch.settings = kept;
  }
  if (st.log !== undefined) {
    const log = capLog(Array.isArray(st.log) ? st.log.filter(isObj) : []).map(trimEntry);
    if (JSON.stringify(log) !== JSON.stringify(st.log)) patch.log = log;
  }
  if (st.stats !== undefined) {
    const stats = isObj(st.stats) && isObj(st.stats.days) ? st.stats : { days: {} };
    const keys = Object.keys(stats.days).sort();
    for (const k of keys) { if (!isObj(stats.days[k])) delete stats.days[k]; else if (k !== D.today()) delete stats.days[k].seen; }
    while (Object.keys(stats.days).length > DAYS_KEPT) delete stats.days[Object.keys(stats.days).sort()[0]];
    patch.stats = stats;
  }
  if (st.allow !== undefined && !Array.isArray(st.allow)) patch.allow = [];
  if (user != null && user !== st.userRules) patch.userRules = user;
  if (st.schema !== SCHEMA) patch.schema = SCHEMA;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  if (st.personal || st.packs || st.packStates) await chrome.storage.local.remove(['personal', 'packs', 'packStates']);
  if (patch.userRules != null) await saveUserRules(patch.userRules);
}

/* ---------- rule lists ---------- */
// "! Expires: 4 days (update frequency)", "12 hours", "1 week", "6h": clamped to an hour .. two weeks.
function expiresMs(meta) {
  const m = String((meta && meta.expires) || '').match(/(\d+(?:\.\d+)?)\s*(h|hours?|d|days?|w|weeks?)\b/i);
  if (!m) return DAY;
  const unit = m[2][0].toLowerCase();
  return Math.min(14 * DAY, Math.max(HOUR, Number(m[1]) * (unit === 'h' ? HOUR : unit === 'w' ? 7 * DAY : DAY)));
}
function entryFrom(parsed, base) {
  return Object.assign({}, base, {
    title: cut(parsed.meta.title || base.title || base.id, 120),
    version: cut(parsed.meta.version || '', 40),
    homepage: /^https:\/\//i.test(parsed.meta.homepage || '') ? cut(parsed.meta.homepage, 300) : '',
    expires: expiresMs(parsed.meta),
    rules: parsed.rules,
    errors: parsed.errors.slice(0, 50),
    errorCount: parsed.errors.length,
    updated: Date.now(),
    checked: Date.now(),
    data: Object.assign(parsed.data, { id: base.id })
  });
}
async function getLists() {
  const { lists } = await get('lists');
  return Array.isArray(lists) ? lists : [];
}
async function putList(entry) {
  const lists = await getLists();
  const i = lists.findIndex(l => l.id === entry.id);
  if (i >= 0) { entry.enabled = lists[i].enabled !== false; lists[i] = entry; } else { entry.enabled = entry.enabled !== false; lists.push(entry); }
  await chrome.storage.local.set({ lists });
  guessC = null;
  return entry;
}

async function loadBuiltin(b, force) {
  const text = await fetch(chrome.runtime.getURL(b.path), { cache: 'no-store' }).then(r => r.text());
  const lists = await getLists();
  const cur = lists.find(l => l.id === b.id);
  const h = hash(text);
  if (!force && cur && cur.hash === h && cur.data) return cur;
  return putList(entryFrom(Lists.parse(text, b.id), { id: b.id, kind: 'builtin', path: b.path, hash: h }));
}

// A list address is someone else's server: time out, refuse anything huge, and never send cookies.
async function fetchText(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_MS);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ac.signal });
    if (!r.ok) throw new Error('The list address answered ' + r.status + '.');
    if (!/^https:/i.test(r.url || url)) throw new Error('The list address moved to a page that is not https.');
    if (Number(r.headers.get('content-length') || 0) > LIST_MAX_BYTES) throw new Error('That list is too big (over 3 MB).');
    const reader = r.body.getReader(), parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > LIST_MAX_BYTES) { ac.abort(); throw new Error('That list is too big (over 3 MB).'); }
      parts.push(value);
    }
    const buf = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { buf.set(p, at); at += p.length; }
    return new TextDecoder().decode(buf);
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('The list address did not answer in time.');
    throw e;
  } finally { clearTimeout(timer); }
}

async function loadUrl(entry) {
  const text = await fetchText(entry.url);
  if (/^\s*</.test(text)) throw new Error('That address returned a web page, not a rule list.');
  const h = hash(text);
  // Unchanged since last time: keep the parsed rules, just note the check.
  if (entry.hash === h && entry.data) return putList(Object.assign({}, entry, { updated: Date.now(), checked: Date.now(), lastError: '' }));
  const parsed = parseAny(text, entry.id, true);
  if (!parsed.rules) throw new Error('No usable rules at that address.' + (parsed.errors[0] ? ' Line ' + parsed.errors[0].line + ': ' + parsed.errors[0].message : ''));
  return putList(entryFrom(parsed, { id: entry.id, kind: 'url', url: entry.url, title: entry.title, hash: h }));
}

// guarded: lists from outside BNet get the regex speed check and the rule cap.
function parseAny(text, id, guarded) {
  const t = String(text || '').trim();
  const opts = guarded ? { guard: true, maxRules: LIST_MAX_RULES } : null;
  if (t[0] === '{') { // older JSON packs still work
    const pack = JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    return Lists.parse(Lists.fromPack(pack), id, opts);
  }
  return Lists.parse(t, id, opts);
}

async function saveUserRules(text) {
  const parsed = parseAny(text, 'user', true);
  await chrome.storage.local.set({ userRules: text });
  await putList(entryFrom(parsed, { id: 'user', kind: 'user', title: 'My rules' }));
  return parsed.errors;
}

// builtins: re-read the lists that ship with BNet (only needed at start and after an update).
async function ensureLists(force, builtins) {
  const have = await getLists();
  for (const b of BUILTIN) {
    if (!force && builtins === false && have.some(l => l.id === b.id && l.data)) continue;
    try { await loadBuiltin(b, force); } catch (e) { console.warn('BNet builtin list', e); }
  }
  const lists = await getLists();
  if (!lists.some(l => l.id === 'user')) { const { userRules } = await get('userRules'); await saveUserRules(typeof userRules === 'string' ? userRules : ''); }
  const now = Date.now();
  for (const l of lists.filter(l => l.kind === 'url')) {
    const due = !l.data || now - (l.updated || 0) > (l.expires || DAY);
    // A failing address is retried at most hourly.
    if (force || (due && now - (l.checked || 0) > HOUR)) {
      try { await loadUrl(l); } catch (e) { await putList(Object.assign({}, l, { lastError: String(e.message || e), checked: Date.now() })); }
    }
  }
  return getLists();
}

let guessC = null;
async function guessCategory(text) {
  try {
    if (!guessC) guessC = E.compile((await getLists()).filter(l => l.kind === 'builtin' && l.data).map(l => l.data));
    const hit = E.scan(guessC, text, { minSev: 1 })[0];
    if (hit && hit.primary) return hit.primary;
    const norm = E.normalize(text).norm;
    for (const g of guessC.groups) { g.re.lastIndex = 0; if (g.re.test(norm)) return g.cat; }
  } catch (e) {}
  return 'dehumanising';
}

/* ---------- menus + shortcuts (one code path for both) ---------- */
const menuCreate = o => new Promise(res => chrome.contextMenus.create(o, () => { void chrome.runtime.lastError; res(); }));
async function setupMenus() {
  await new Promise(res => chrome.contextMenus.removeAll(() => { void chrome.runtime.lastError; res(); }));
  const sel = { contexts: ['selection'], documentUrlPatterns: WEB_URLS };
  await menuCreate({ id: 'bnet-mute', title: 'Mute “%s” with BNet', ...sel });
  await menuCreate({ id: 'bnet-as', title: 'Mute as…', ...sel });
  for (const [id, label] of CATS) await menuCreate({ id: 'bnet:' + id, parentId: 'bnet-as', title: label, ...sel });
  await menuCreate({ id: 'bnet-site', title: 'Turn BNet off on this site', contexts: ['page', 'link', 'image'], documentUrlPatterns: WEB_URLS });
}

// The site item says what it will do for the tab in front.
async function refreshSiteMenu(tab) {
  try {
    if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const site = tab && siteOf(tab.url || '');
    if (!site) return;
    const s = await D.store.settings();
    const off = s.offSites.includes(site);
    chrome.contextMenus.update('bnet-site', { title: off ? 'Turn BNet back on for this site' : 'Turn BNet off on this site' }, () => void chrome.runtime.lastError);
  } catch (e) {}
}

// With content scripts in every frame, the toast always shows in the page itself (frame 0): a small
// iframe could hide it, and the page is where the person is looking.
const toast = (where, text) => {
  const tab = where && where.tab !== undefined ? where.tab : where;
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'toast', text }, { frameId: 0 }).catch(() => {});
};

async function toggleSite(tab) {
  const site = tab && siteOf(tab.url || '');
  if (!site) return;
  const s = await D.store.settings();
  const off = new Set(s.offSites);
  const turnOff = !off.has(site);
  if (turnOff) off.add(site); else off.delete(site);
  await D.store.saveSettings({ offSites: [...off] });
  toast(tab, turnOff ? 'BNet is off on ' + site : 'BNet is on for ' + site);
  refreshSiteMenu(tab);
}

// The selected words in the tab: the frame with focus first (where the person is working), else any frame.
async function selectionIn(tab) {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => ({ text: String(getSelection() || ''), focus: document.hasFocus() }) });
    const has = res.filter(r => r.result && r.result.text.trim());
    const pick = has.find(r => r.result.focus) || has.find(r => r.frameId === 0) || has[0];
    return pick ? { text: pick.result.text, frameId: pick.frameId } : { text: '', frameId: 0 };
  } catch (e) { return { text: '', frameId: 0 }; }
}

// The rule body for a selection. Plain words are the readable form, but plain text cannot hold " ! "
// (it starts a note), a trailing "$word" (it reads as an option) or /…/ (it reads as a regex), so such a
// selection is written as an escaped regex that matches exactly the same words.
const reEscape = t => t.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
function bodyFor(text) {
  const risky = /\s!(\s|$)|^!|\s\$[a-z]+(=\S*)?$|^\/.*\/$|^\$/i.test(text);
  return risky ? '/' + reEscape(text.toLowerCase()).replace(/\s+/g, '\\s+') + '/' : text;
}
// "phrase <cats> <sev> <body>" -> body, for matching a selection against My rules whatever its category.
const phraseBody = line => { const m = line.trim().match(/^phrase\s+\S+\s+[123]\s+(.+)$/i); return m ? m[1].trim().toLowerCase() : null; };

async function addPersonal(rawText, cat, tab, pageUrl, frameId) {
  let text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const where = { tab, frameId };
  if (text.length < 2) { toast(where, 'Select the words to mute first'); return; }
  if (text[0] === '/' && text[text.length - 1] === '/') text = text.slice(1, -1).trim();
  if (text.length < 2) return;
  const chosen = !!cat;
  cat = cat || await guessCategory(text);
  const { userRules } = await get('userRules');
  let rules = typeof userRules === 'string' ? userRules : '';
  const body = bodyFor(text);
  const line = 'phrase ' + cat + ' 3 ' + body;
  const bodies = [body.toLowerCase(), text.toLowerCase()];
  const lines = rules.split('\n');
  const at = lines.findIndex(l => bodies.includes(phraseBody(l)));
  if (at >= 0) {
    // Already muted: "Mute as" re-files it under the chosen kind instead of adding a second line.
    if (chosen && lines[at].trim().toLowerCase() !== line.toLowerCase()) { lines[at] = line; await saveUserRules(lines.join('\n')); }
  } else {
    if (rules.length + line.length > USER_MAX_BYTES) { toast(where, 'My rules is full. Remove some in BNet settings.'); return; }
    if (rules && !rules.endsWith('\n')) rules += '\n';
    rules += line + '\n';
    await saveUserRules(rules);
  }
  // A hand-added phrase overrides an earlier "Not hateful" on the same words.
  const { allow } = await get('allow');
  const key = E.normKey(text);
  if (Array.isArray(allow) && allow.some(a => a && a.key === key)) await chrome.storage.local.set({ allow: allow.filter(a => a && a.key !== key) });
  appendLog([{ t: Date.now(), kind: 'missed', span: text, cat, cats: [cat], rule: 'manual', src: 'selection', ctx: '', url: (tab && tab.url) || pageUrl || '' }]);
  const label = (CATS.find(c => c[0] === cat) || [cat, cat])[1];
  toast(where, 'Muted everywhere \u00B7 ' + label);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === 'bnet-mute') serial(() => addPersonal(info.selectionText, null, tab, info.pageUrl, info.frameId));
  else if (id.startsWith('bnet:')) serial(() => addPersonal(info.selectionText, id.slice(5), tab, info.pageUrl, info.frameId));
  else if (id === 'bnet-site') serial(() => toggleSite(tab));
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !siteOf(tab.url || '')) return;
  if (command === 'toggle-site') serial(() => toggleSite(tab));
  else if (command === 'mute-selection') { const sel = await selectionIn(tab); serial(() => addPersonal(sel.text, null, tab, tab.url, sel.frameId)); }
});

/* ---------- log + stats ---------- */
// Hits and log lines arrive in bursts from every tab. They wait in memory and are written together by one
// writer of their own, so a burst costs one storage write and list saves (serial) never queue behind it.
// If the worker stops between a message and the write, those few counts are lost; nothing else is.
const pendingHits = [], pendingLog = [];
let logChain = Promise.resolve(), flushQueued = false;
function queueLog(entries, hits) {
  if (entries) pendingLog.push(...entries);
  if (hits) pendingHits.push(...hits);
  if (flushQueued) return logChain;
  flushQueued = true;
  return (logChain = logChain.then(() => { flushQueued = false; return flushLog(); }).catch(err => console.warn('BNet log', err)));
}
const appendLog = entries => queueLog(entries, null);
const recordHits = items => queueLog(null, items); // name kept for the test harness

async function flushLog() {
  const items = pendingHits.splice(0).filter(isObj);
  const extra = pendingLog.splice(0).filter(isObj);
  if (!items.length && !extra.length) return;
  const s = await D.store.settings();
  const st = await get(s.learn ? ['stats', 'log'] : ['stats']);
  const patch = {};
  const fresh = s.learn ? extra.map(trimEntry) : [];
  if (items.length) {
    const stats = isObj(st.stats) && isObj(st.stats.days) ? st.stats : { days: {} };
    const d = D.today();
    const day = isObj(stats.days[d]) ? stats.days[d] : (stats.days[d] = { total: 0, cats: {}, src: {}, seen: [] });
    for (const k of ['cats', 'src']) if (!isObj(day[k])) day[k] = {};
    if (!Array.isArray(day.seen)) day.seen = [];
    const seen = new Set(day.seen);
    for (const it of items) {
      const h = hash(String(it.key) + '|' + (it.url || ''));
      if (seen.has(h)) continue;
      seen.add(h); day.seen.push(h);
      day.total = (day.total || 0) + 1;
      day.cats[it.cat] = (day.cats[it.cat] || 0) + 1;
      day.src[it.src] = (day.src[it.src] || 0) + 1;
      if (s.learn) fresh.push(trimEntry({ t: Date.now(), kind: 'hit', span: it.span, cat: it.cat, cats: it.cats, rule: it.rule, sev: it.sev, src: it.src, ctx: it.ctx || '', url: it.url || '' }));
    }
    if (day.seen.length > SEEN_CAP) day.seen = day.seen.slice(-SEEN_CAP);
    // Only today needs the seen list; past days keep their counts.
    const keys = Object.keys(stats.days).sort();
    for (const k of keys) if (k !== d && stats.days[k] && stats.days[k].seen) delete stats.days[k].seen;
    while (keys.length > DAYS_KEPT) delete stats.days[keys.shift()];
    patch.stats = stats;
  }
  if (fresh.length) {
    patch.log = capLog((Array.isArray(st.log) ? st.log : []).concat(fresh));
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

/* ---------- badge ---------- */
async function updateBadge() {
  const s = await D.store.settings();
  let text = '';
  if (!s.enabled) text = 'off';
  else if (s.pausedUntil > Date.now()) text = '❚❚';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: text ? '#3a3d48' : '#5a6fe8' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  if (s.enabled && s.pausedUntil > Date.now()) chrome.alarms.create('bnet-resume', { when: s.pausedUntil + 500 });
}

// Every frame counts its own muted phrases; the tab shows the sum. Counts live in session storage so a
// restarted worker still adds up correctly, and are dropped when the tab loads a new page or closes.
let badgeChain = Promise.resolve();
function frameCounts(tabId, frameId, n) {
  return (badgeChain = badgeChain.then(async () => {
    const k = 'badge:' + tabId;
    let counts = {};
    try { counts = (await chrome.storage.session.get(k))[k] || {}; } catch (e) {}
    if (frameId != null) { if (n > 0) counts[frameId] = n; else delete counts[frameId]; }
    try { await chrome.storage.session.set({ [k]: counts }); } catch (e) {}
    return Object.values(counts).reduce((a, b) => a + b, 0);
  }).catch(() => 0));
}
function forgetTab(tabId) { badgeChain = badgeChain.then(() => chrome.storage.session.remove('badge:' + tabId)).catch(() => {}); }

async function tabBadge(tab, n, frameId) {
  const tabId = tab.id;
  const total = await frameCounts(tabId, frameId || 0, n);
  if (frameId && n < 0) n = total; // a frame turning off does not turn off the page's count
  else if (n >= 0) n = total;
  const s = await D.store.settings();
  const site = siteOf(tab.url || '');
  // Site switched off while BNet is otherwise on: say so on this tab only.
  if (D.store.isActive(s) && site && s.offSites.includes(site)) {
    await chrome.action.setBadgeText({ tabId, text: 'off' });
    return chrome.action.setBadgeBackgroundColor({ tabId, color: '#3a3d48' });
  }
  if (n < 0 || !s.badge || !D.store.isActive(s)) return chrome.action.setBadgeText({ tabId, text: null }).catch(() => chrome.action.setBadgeText({ tabId, text: '' }));
  await chrome.action.setBadgeText({ tabId, text: n ? (n > 999 ? '999+' : String(n)) : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#5a6fe8' });
}

async function ensureAlarms() {
  const a = await chrome.alarms.get('bnet-lists');
  if (!a || a.periodInMinutes !== 60) chrome.alarms.create('bnet-lists', { periodInMinutes: 60, delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'bnet-resume') updateBadge();
  if (a.name === 'bnet-lists') serial(() => ensureLists(false, false));
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings) { updateBadge().catch(() => {}); refreshSiteMenu(); }
});

/* ---------- OCR via offscreen document ---------- */
// One picture at a time, newest work first to go when the queue is full, and a tab's waiting pictures
// are dropped when it closes or loads a new page. If this worker stops, waiting pages simply get no
// answer (their message fails) and leave the picture alone.
const OCR_QUEUE_MAX = 30, OCR_JOB_MS = 75000, OCR_CACHE_MAX = 300;
const ocrJobs = [];      // { url, waiters: [{ tabId, resolve }] }
let ocrRunning = null;
const ocrMem = new Map();
const ocrCache = ocrMem; // name kept for the test harness

const ocrKey = url => 'ocr:' + hash(url).toString(36) + ':' + url.length;
async function ocrCached(url) {
  if (ocrMem.has(url)) return ocrMem.get(url);
  try {
    const k = ocrKey(url);
    const v = (await chrome.storage.session.get(k))[k];
    if (v && v.url === url) { ocrMem.set(url, v); return v; }
  } catch (e) {}
  return null;
}
// Kept in session storage: survives this worker stopping, gone when the browser closes.
async function ocrRemember(url, out) {
  ocrMem.set(url, out);
  if (ocrMem.size > 200) ocrMem.delete(ocrMem.keys().next().value);
  try {
    const k = ocrKey(url);
    const { ocrIdx } = await chrome.storage.session.get('ocrIdx');
    const idx = (Array.isArray(ocrIdx) ? ocrIdx : []).filter(x => x !== k);
    idx.push(k);
    const drop = idx.length > OCR_CACHE_MAX ? idx.splice(0, idx.length - OCR_CACHE_MAX) : [];
    await chrome.storage.session.set({ [k]: out, ocrIdx: idx });
    if (drop.length) await chrome.storage.session.remove(drop);
  } catch (e) {}
}

let creating = null;
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Recognise text inside images on this device so hateful words in memes can be muted.'
    }).catch(e => { if (!/single offscreen|already/i.test(String(e && e.message))) throw e; }).finally(() => { creating = null; });
  }
  await creating;
}

async function runOcr(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureOffscreen();
    try {
      const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr', url });
      return res && res.ok ? { ok: true, w: res.w, h: res.h, words: res.words || [], url } : { ok: false };
    } catch (e) {
      // The OCR page may have just closed itself for being idle; open it again once.
      if (attempt || !/Receiving end|message port closed|no longer exists/i.test(String(e && e.message))) throw e;
    }
  }
}

function settle(job, out) { for (const w of job.waiters) w.resolve(out); job.waiters = []; }

async function pumpOcr() {
  if (ocrRunning || !ocrJobs.length) return;
  const job = ocrRunning = ocrJobs.shift();
  let out = { ok: false };
  let timer;
  try {
    out = await Promise.race([runOcr(job.url), new Promise(res => { timer = setTimeout(() => res({ ok: false, error: 'timeout' }), OCR_JOB_MS); })]);
  } catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
  clearTimeout(timer);
  ocrRunning = null;
  if (out && out.ok) await ocrRemember(job.url, out);
  settle(job, out || { ok: false });
  pumpOcr();
}

async function ocrRequest(url, tabId) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 4096) return { ok: false };
  const hit = await ocrCached(url);
  if (hit) return hit;
  return new Promise(resolve => {
    const waiter = { tabId, resolve };
    const same = (ocrRunning && ocrRunning.url === url) ? ocrRunning : ocrJobs.find(j => j.url === url);
    if (same) { same.waiters.push(waiter); return; }
    while (ocrJobs.length >= OCR_QUEUE_MAX) settle(ocrJobs.shift(), { ok: false, error: 'busy' });
    ocrJobs.push({ url, waiters: [waiter] });
    pumpOcr();
  });
}

function cancelTab(tabId) {
  for (let i = ocrJobs.length - 1; i >= 0; i--) {
    const job = ocrJobs[i];
    const keep = job.waiters.filter(w => w.tabId !== tabId);
    for (const w of job.waiters) if (w.tabId === tabId) w.resolve({ ok: false, error: 'cancelled' });
    job.waiters = keep;
    if (!keep.length) ocrJobs.splice(i, 1);
  }
}
chrome.tabs.onRemoved.addListener(tabId => { cancelTab(tabId); forgetTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Counts are reset by the page itself when it starts (pageCount with fresh), not here: a pushState
  // navigation also reports "loading" and would wipe counts the frames won't send again.
  if (info.status === 'loading' && info.url) cancelTab(tabId);
  if (info.url && tab && tab.active) refreshSiteMenu(tab);
});
chrome.tabs.onActivated.addListener(({ tabId }) => { chrome.tabs.get(tabId).then(t => refreshSiteMenu(t), () => {}); });

/* ---------- messages ---------- */
const EXT_ORIGIN = chrome.runtime.getURL('');
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  // Only BNet's own pages may change lists; a web page's content script can only ask for them to exist.
  const fromExt = String(sender.url || '').startsWith(EXT_ORIGIN);
  if (msg.type === 'offscreen:idle') {
    if (fromExt && !ocrRunning && !ocrJobs.length) chrome.offscreen.closeDocument().catch(() => {});
    return;
  }
  if (msg.type === 'hits') { if (Array.isArray(msg.items)) queueLog(null, msg.items.slice(0, 300)); return; }
  if (msg.type === 'pageCount' && sender.tab && sender.tab.id != null) {
    if (msg.fresh && sender.frameId === 0) forgetTab(sender.tab.id);
    tabBadge(sender.tab, Number(msg.n) || 0, sender.frameId).catch(() => {});
    return;
  }
  if (msg.type === 'reveal') {
    if (isObj(msg.item)) appendLog([{ ...msg.item, t: Date.now(), kind: 'reveal' }]);
    return;
  }
  if (msg.type === 'notHateful') {
    serial(async () => {
      const it = isObj(msg.item) ? msg.item : {};
      if (!it.key || typeof it.key !== 'string') return;
      const { allow } = await get('allow');
      let list = Array.isArray(allow) ? allow : [];
      if (!list.some(a => a && a.key === it.key)) list.push({ key: it.key.slice(0, 300), span: cut(it.span, 200), cat: it.cat, t: Date.now() });
      if (list.length > ALLOW_CAP) list = list.slice(-ALLOW_CAP);
      await chrome.storage.local.set({ allow: list });
      appendLog([{ t: Date.now(), kind: 'not_hateful', span: it.span, cat: it.cat, cats: it.cats, rule: it.rule, src: it.src, ctx: it.ctx || '', url: it.url || '' }]);
    });
    return;
  }
  if (typeof msg.type === 'string' && msg.type.startsWith('lists:')) {
    if (!fromExt && msg.type !== 'lists:ensure') { sendResponse({ ok: false, error: 'not allowed' }); return; }
    serial(async () => {
      try {
        if (msg.type === 'lists:ensure') return { ok: true, lists: await ensureLists(false, false) };
        if (msg.type === 'lists:refresh') return { ok: true, lists: await ensureLists(true) };
        if (msg.type === 'lists:saveUser') {
          const text = String(msg.text || '');
          if (text.length > USER_MAX_BYTES) return { ok: false, error: 'My rules is too long (over 500 KB). Import it as a list file instead.' };
          return { ok: true, errors: await saveUserRules(text) };
        }
        if (msg.type === 'lists:toggle') {
          const lists = await getLists(); const l = lists.find(x => x.id === msg.id);
          if (l) { l.enabled = !!msg.enabled; await chrome.storage.local.set({ lists }); guessC = null; }
          return { ok: true };
        }
        if (msg.type === 'lists:remove') {
          const lists = (await getLists()).filter(x => x.id !== msg.id || x.kind === 'builtin' || x.kind === 'user');
          await chrome.storage.local.set({ lists });
          return { ok: true };
        }
        if (msg.type === 'lists:addUrl') {
          const url = String(msg.url || '').trim();
          if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2048) return { ok: false, error: 'Use a full https:// address.' };
          if ((await getLists()).some(l => l.url === url)) return { ok: false, error: 'That list is already added.' };
          const e = await loadUrl({ id: 'url-' + hash(url).toString(36), url, title: url.replace(/^https:\/\//, '') });
          return { ok: true, entry: { title: e.title, rules: e.rules, errorCount: e.errorCount } };
        }
        if (msg.type === 'lists:addText') {
          const text = String(msg.text || '');
          if (text.length > LIST_MAX_BYTES) return { ok: false, error: 'That list is too big (over 3 MB).' };
          const id = 'file-' + hash(text).toString(36);
          const parsed = parseAny(text, id, true);
          if (!parsed.rules) return { ok: false, error: 'No usable rules in that list.' + (parsed.errors[0] ? ' Line ' + parsed.errors[0].line + ': ' + parsed.errors[0].message : '') };
          const e = await putList(entryFrom(parsed, { id, kind: 'file', title: cut(msg.name, 120) || 'Imported list' }));
          return { ok: true, entry: { title: e.title, rules: e.rules, errorCount: e.errorCount } };
        }
        return { ok: false, error: 'unknown request' };
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    }).then(sendResponse);
    return true;
  }
  if (msg.type === 'css') {
    // Styles for masks inside shadow roots. Sent by message so content.css need not be web-accessible.
    (cssText || (cssText = fetch(chrome.runtime.getURL('src/content.css')).then(r => r.text()).catch(() => { cssText = null; return ''; })))
      .then(t => sendResponse(t), () => sendResponse(''));
    return true;
  }
  if (msg.type === 'ocr') {
    ocrRequest(msg.url, sender.tab ? sender.tab.id : -1).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
});

/* ---------- start, install, update ---------- */
// Pages that were open before BNet was installed or updated get the content script now. A tab whose copy
// is still alive is skipped; an orphaned copy from before an update shuts itself down when the new one loads.
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: WEB_URLS });
  await Promise.all(tabs.filter(t => !t.discarded && t.id != null).map(async t => {
    try {
      const probes = await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: () => !!(window.__bnetAlive && window.__bnetAlive()) });
      const frameIds = probes.filter(p => !p.result).map(p => p.frameId);
      if (!frameIds.length) return;
      await chrome.scripting.insertCSS({ target: { tabId: t.id, frameIds }, files: ['src/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds }, files: CONTENT_JS });
    } catch (e) { /* tab not ready or not scriptable; it picks BNet up on next load */ }
  }));
}

// Runs at every worker start, but the heavy part only once per browser session: session storage is
// empty after a browser start, an install, an update, a reload or a re-enable, which are exactly the
// moments menus, alarms and lists need setting up.
let booting = null;
let cssText = null;

/* ---------- prepared rules ----------
   The rule lists are turned into regex sources once, here, and stored. Each page then only builds the
   regexes it needs (about 7 ms instead of 160 ms). The signature ties the stored copy to the lists it came from. */
function listsSig(lists) {
  return chrome.runtime.getManifest().version + '|' + lists.filter(l => l.enabled !== false && l.data).map(l => l.id + ':' + (l.updated || 0)).join(',');
}
let prepTimer = null;
function schedulePrepare(delay) { clearTimeout(prepTimer); prepTimer = setTimeout(writePrepared, delay == null ? 300 : delay); }
async function writePrepared() {
  try {
    const lists = await getLists();
    const sig = listsSig(lists);
    const { preparedSig, listsSig: stored } = await get(['preparedSig', 'listsSig']);
    if (stored !== sig) await chrome.storage.local.set({ listsSig: sig });
    if (preparedSig === sig) return;
    const prepared = E.prepare(lists.filter(l => l.enabled !== false && l.data).map(l => l.data));
    await chrome.storage.local.set({ prepared, preparedSig: sig });
  } catch (e) { console.warn('BNet prepare', e); }
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local' || !c.lists) return;
  // Pages watch this small key instead of the lists themselves.
  const lists = Array.isArray(c.lists.newValue) ? c.lists.newValue : [];
  chrome.storage.local.set({ listsSig: listsSig(lists) }).catch(() => {});
  schedulePrepare();
});

function boot() {
  return booting || (booting = (async () => {
    let first = true;
    try { first = !(await chrome.storage.session.get('booted')).booted; } catch (e) {}
    if (first) {
      await serial(migrate);
      await setupMenus();
      await ensureAlarms();
      await serial(() => ensureLists(false, true));
      try { await chrome.storage.session.set({ booted: Date.now() }); } catch (e) {}
    }
    await updateBadge();
    refreshSiteMenu();
    schedulePrepare(0);
  })().catch(e => { console.warn('BNet start', e); booting = null; }));
}

chrome.runtime.onInstalled.addListener(async details => {
  await boot();
  if (details.reason === 'install') {
    const { settings } = await get('settings');
    if (!settings) await chrome.storage.local.set({ settings: D.DEFAULTS });
    chrome.tabs.create({ url: chrome.runtime.getURL('ui/settings.html#welcome') }).catch(() => {});
  }
  if (details.reason === 'install' || details.reason === 'update') injectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => { boot(); });
boot();

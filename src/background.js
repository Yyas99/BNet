/* BNet background: rule lists, stats, learning log, allow list; OCR broker; badge; context menu. */
importScripts('defaults.js');
const D = self.BNetDefaults;

const CATS = [
  ['racism', 'Racism & ethnic hate'], ['religion', 'Religious hate'], ['sexism', 'Misogyny & sexism'],
  ['lgbtq', 'Anti-LGBTQ+ hate'], ['ableism', 'Ableist hate'], ['slurs', 'Slurs'], ['dehumanising', 'Dehumanising language'],
  ['extremism', 'Violent extremism'], ['political', 'Political hostility']
];
const X_URLS = ['https://x.com/*', 'https://twitter.com/*', 'https://mobile.x.com/*', 'https://mobile.twitter.com/*'];
const LOG_CAP = 20000, SEEN_CAP = 5000, DAYS_KEPT = 120;

let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(err => console.warn('BNet', err)); return run.catch(err => ({ ok: false, error: String(err && err.message || err) })); };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- rule lists (ad-blocker style) ---------- */
importScripts('engine.js', 'lists.js');
const E = self.BNetEngine, Lists = self.BNetLists;
const BUILTIN = [{ id: 'core', path: 'rules/core.txt' }];
const DAY = 864e5;

function expiresMs(meta) {
  const m = String((meta && meta.expires) || '').match(/(\d+)\s*(hour|day)/i);
  if (!m) return DAY;
  return Math.max(3600e3, Number(m[1]) * (m[2].toLowerCase() === 'hour' ? 3600e3 : DAY));
}
function entryFrom(parsed, base) {
  return Object.assign({}, base, {
    title: parsed.meta.title || base.title || base.id,
    version: parsed.meta.version || '',
    homepage: parsed.meta.homepage || '',
    expires: expiresMs(parsed.meta),
    rules: parsed.rules,
    errors: parsed.errors.slice(0, 50),
    errorCount: parsed.errors.length,
    updated: Date.now(),
    data: Object.assign(parsed.data, { id: base.id })
  });
}
async function getLists() {
  const { lists } = await chrome.storage.local.get('lists');
  return lists || [];
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
  if (!force && cur && cur.hash === h) return cur;
  return putList(entryFrom(Lists.parse(text, b.id), { id: b.id, kind: 'builtin', path: b.path, hash: h }));
}

async function loadUrl(entry) {
  const r = await fetch(entry.url, { cache: 'no-store', credentials: 'omit' });
  if (!r.ok) throw new Error('The list address answered ' + r.status + '.');
  const text = await r.text();
  if (/^\s*</.test(text)) throw new Error('That address returned a web page, not a rule list.');
  return putList(entryFrom(parseAny(text, entry.id), { id: entry.id, kind: 'url', url: entry.url, title: entry.title }));
}

function parseAny(text, id) {
  const t = String(text || '').trim();
  if (t[0] === '{') { // older JSON packs still work
    const pack = JSON.parse(t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
    return Lists.parse(Lists.fromPack(pack), id);
  }
  return Lists.parse(t, id);
}

async function saveUserRules(text) {
  const parsed = Lists.parse(text, 'user');
  await chrome.storage.local.set({ userRules: text });
  await putList(entryFrom(parsed, { id: 'user', kind: 'user', title: 'My rules' }));
  return parsed.errors;
}

async function migrateOld() {
  const st = await chrome.storage.local.get(['personal', 'packs', 'packStates', 'userRules']);
  let user = st.userRules;
  if (user == null) {
    user = '! My rules: one rule per line. Right-click text on X and choose "Mute with BNet" to add one.\n';
    for (const p of (st.personal && st.personal.phrases) || []) {
      user += 'phrase ' + ((p.cats && p.cats[0]) || 'dehumanising') + ' ' + (p.sev || 3) + ' ' + (p.literal ? p.pattern : '/' + p.pattern + '/') + '\n';
    }
    await saveUserRules(user);
  }
  for (const p of st.packs || []) {
    try { await putList(Object.assign(entryFrom(Lists.parse(Lists.fromPack(p.data), p.id), { id: p.id, kind: 'file', title: p.name }), { enabled: p.enabled !== false })); } catch (e) {}
  }
  if (st.personal || st.packs || st.packStates) await chrome.storage.local.remove(['personal', 'packs', 'packStates']);
}

async function ensureLists(force) {
  await migrateOld();
  for (const b of BUILTIN) { try { await loadBuiltin(b, force); } catch (e) { console.warn('BNet builtin list', e); } }
  const lists = await getLists();
  if (!lists.some(l => l.id === 'user')) await saveUserRules((await chrome.storage.local.get('userRules')).userRules || '');
  for (const l of lists.filter(l => l.kind === 'url')) {
    if (force || Date.now() - (l.updated || 0) > (l.expires || DAY)) {
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

/* ---------- menus ---------- */
function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'bnet-mute', title: 'Mute \u201C%s\u201D with BNet', contexts: ['selection'], documentUrlPatterns: X_URLS });
    chrome.contextMenus.create({ id: 'bnet-as', title: 'Mute as\u2026', contexts: ['selection'], documentUrlPatterns: X_URLS });
    for (const [id, label] of CATS) {
      chrome.contextMenus.create({ id: 'bnet:' + id, parentId: 'bnet-as', title: label, contexts: ['selection'], documentUrlPatterns: X_URLS });
    }
  });
}

async function addPersonal(rawText, cat, tab, pageUrl) {
  let text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (text.length < 2) return;
  if (text[0] === '/' && text[text.length - 1] === '/') text = text.slice(1, -1).trim();
  cat = cat || await guessCategory(text);
  const { userRules } = await chrome.storage.local.get('userRules');
  let rules = userRules || '';
  const line = 'phrase ' + cat + ' 3 ' + text;
  const exists = rules.split('\n').some(l => l.trim().toLowerCase() === line.toLowerCase());
  if (!exists) {
    if (rules && !rules.endsWith('\n')) rules += '\n';
    rules += line + '\n';
    await saveUserRules(rules);
  }
  // A hand-added phrase overrides an earlier "Not hateful" on the same words.
  const { allow } = await chrome.storage.local.get('allow');
  const key = E.normKey(text);
  if (allow && allow.some(a => a.key === key)) await chrome.storage.local.set({ allow: allow.filter(a => a.key !== key) });
  await appendLog([{ t: Date.now(), kind: 'missed', span: text, cat, cats: [cat], rule: 'manual', src: 'selection', ctx: '', url: (tab && tab.url) || pageUrl || '' }]);
  const label = (CATS.find(c => c[0] === cat) || [cat, cat])[1];
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'toast', text: 'Muted everywhere on X \u00B7 ' + label }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id === 'bnet-mute') serial(() => addPersonal(info.selectionText, null, tab, info.pageUrl));
  else if (id.startsWith('bnet:')) serial(() => addPersonal(info.selectionText, id.slice(5), tab, info.pageUrl));
});

/* ---------- log + stats ---------- */
async function appendLog(entries) {
  const s = await D.store.settings();
  if (!s.learn) return;
  const { log } = await chrome.storage.local.get('log');
  const next = (log || []).concat(entries);
  await chrome.storage.local.set({ log: next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next });
}

async function recordHits(items) {
  const st = await chrome.storage.local.get(['stats', 'log', 'settings']);
  const s = D.merge(D.DEFAULTS, st.settings || {});
  const stats = st.stats || { days: {} };
  const d = D.today();
  const day = stats.days[d] || (stats.days[d] = { total: 0, cats: {}, src: {}, seen: [] });
  const fresh = [];
  for (const it of items) {
    const h = hash(it.key + '|' + (it.url || ''));
    if (day.seen.includes(h)) continue;
    day.seen.push(h);
    day.total++;
    day.cats[it.cat] = (day.cats[it.cat] || 0) + 1;
    day.src[it.src] = (day.src[it.src] || 0) + 1;
    fresh.push({ t: Date.now(), kind: 'hit', span: it.span, cat: it.cat, cats: it.cats, rule: it.rule, sev: it.sev, src: it.src, ctx: it.ctx || '', url: it.url || '' });
  }
  if (day.seen.length > SEEN_CAP) day.seen = day.seen.slice(-SEEN_CAP);
  const keys = Object.keys(stats.days).sort();
  while (keys.length > DAYS_KEPT) delete stats.days[keys.shift()];
  const patch = { stats };
  if (s.learn && fresh.length) {
    const next = (st.log || []).concat(fresh);
    patch.log = next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
  }
  await chrome.storage.local.set(patch);
}

async function updateBadge() {
  const st = await chrome.storage.local.get(['stats', 'settings']);
  const s = D.merge(D.DEFAULTS, st.settings || {});
  let text = '';
  if (!s.enabled) text = 'off';
  else if (s.pausedUntil > Date.now()) text = '❚❚';

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: text === 'off' || text.startsWith('❚') ? '#3a3d48' : '#5a6fe8' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  if (s.enabled && s.pausedUntil > Date.now()) chrome.alarms.create('bnet-resume', { when: s.pausedUntil + 500 });
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === 'bnet-resume') updateBadge(); if (a.name === 'bnet-lists') serial(() => ensureLists(false)); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) updateBadge(); });

/* ---------- OCR via offscreen document ---------- */
let creating = null;
async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Recognise text inside images on this device so hateful words in memes can be muted.'
    }).finally(() => { creating = null; });
  }
  await creating;
}

const ocrCache = new Map();
async function ocr(url) {
  if (ocrCache.has(url)) return ocrCache.get(url);
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ocr', url });
  const out = res && res.ok ? { ...res, url } : { ok: false };
  if (out.ok) {
    ocrCache.set(url, out);
    if (ocrCache.size > 400) ocrCache.delete(ocrCache.keys().next().value);
  }
  return out;
}

/* ---------- messages ---------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return;
  if (msg.type === 'hits') { serial(() => recordHits(msg.items || [])); return; }
  if (msg.type === 'pageCount' && sender.tab && sender.tab.id != null) {
    D.store.settings().then(s => {
      const tabId = sender.tab.id;
      if (msg.n < 0 || !s.badge || !D.store.isActive(s)) return chrome.action.setBadgeText({ tabId, text: null }).catch(() => chrome.action.setBadgeText({ tabId, text: '' }));
      const n = msg.n;
      chrome.action.setBadgeText({ tabId, text: n ? (n > 999 ? '999+' : String(n)) : '' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#5a6fe8' });
    }).catch(() => {});
    return;
  }
  if (msg.type === 'reveal') {
    serial(() => appendLog([{ t: Date.now(), kind: 'reveal', ...msg.item }]));
    return;
  }
  if (msg.type === 'notHateful') {
    serial(async () => {
      const it = msg.item || {};
      if (!it.key) return;
      const { allow } = await chrome.storage.local.get('allow');
      const list = allow || [];
      if (!list.some(a => a.key === it.key)) list.push({ key: it.key, span: it.span, cat: it.cat, t: Date.now() });
      await chrome.storage.local.set({ allow: list });
      await appendLog([{ t: Date.now(), kind: 'not_hateful', span: it.span, cat: it.cat, cats: it.cats, rule: it.rule, src: it.src, ctx: it.ctx || '', url: it.url || '' }]);
    });
    return;
  }
  if (msg.type && msg.type.startsWith('lists:')) {
    serial(async () => {
      try {
        if (msg.type === 'lists:ensure') return { ok: true, lists: await ensureLists(false) };
        if (msg.type === 'lists:refresh') return { ok: true, lists: await ensureLists(true) };
        if (msg.type === 'lists:saveUser') return { ok: true, errors: await saveUserRules(msg.text || '') };
        if (msg.type === 'lists:toggle') {
          const lists = await getLists(); const l = lists.find(x => x.id === msg.id);
          if (l) { l.enabled = !!msg.enabled; await chrome.storage.local.set({ lists }); }
          return { ok: true };
        }
        if (msg.type === 'lists:remove') {
          const lists = (await getLists()).filter(x => x.id !== msg.id || x.kind === 'builtin' || x.kind === 'user');
          await chrome.storage.local.set({ lists });
          return { ok: true };
        }
        if (msg.type === 'lists:addUrl') {
          const url = String(msg.url || '').trim();
          if (!/^https:\/\//i.test(url)) return { ok: false, error: 'Use a full https:// address.' };
          if ((await getLists()).some(l => l.url === url)) return { ok: false, error: 'That list is already added.' };
          const e = await loadUrl({ id: 'url-' + hash(url).toString(36), url, title: url.replace(/^https:\/\//, '') });
          return { ok: true, entry: { title: e.title, rules: e.rules, errorCount: e.errorCount } };
        }
        if (msg.type === 'lists:addText') {
          const id = 'file-' + hash(msg.text || '').toString(36);
          const parsed = parseAny(msg.text, id);
          if (!parsed.rules) return { ok: false, error: 'No usable rules in that list.' + (parsed.errors[0] ? ' Line ' + parsed.errors[0].line + ': ' + parsed.errors[0].message : '') };
          const e = await putList(entryFrom(parsed, { id, kind: 'file', title: msg.name || 'Imported list' }));
          return { ok: true, entry: { title: e.title, rules: e.rules, errorCount: e.errorCount } };
        }
      } catch (err) { return { ok: false, error: String(err.message || err) }; }
    }).then(sendResponse);
    return true;
  }
  if (msg.type === 'ocr') {
    ocr(msg.url).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
});

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: X_URLS });
  for (const t of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ['src/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['src/defaults.js', 'src/engine.js', 'src/treatments.js', 'src/content.js'] });
    } catch (e) { /* tab not ready; it picks BNet up on next load */ }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  setupMenus();
  await serial(() => ensureLists(true));
  injectIntoOpenTabs();
  chrome.alarms.create('bnet-lists', { periodInMinutes: 360 });
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: D.DEFAULTS });
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => { setupMenus(); updateBadge(); serial(() => ensureLists(false)); chrome.alarms.create('bnet-lists', { periodInMinutes: 360 }); });

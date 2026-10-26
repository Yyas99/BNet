'use strict';
const { store, today } = BNetDefaults;
const { TREATMENTS } = BNetTreatments;
const E = BNetEngine;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const CAT_LABEL = Object.fromEntries(E.CATEGORIES.map(c => [c.id, c.label]));
const CAT_DESC = {
  racism: 'Slurs, "go back" rhetoric, and hateful claims about races, ethnicities and migrants.',
  religion: 'Hate aimed at Muslims, Jews, Christians, Hindus, Sikhs and other faiths.',
  sexism: 'Hate aimed at women or men, including incel slang.',
  lgbtq: 'Hate aimed at gay, lesbian, bi and trans people.',
  ableism: 'Hate aimed at disabled people, including slurs like the r-word.',
  slurs: 'Slurs of any kind, whoever they target.',
  dehumanising: 'Calling people animals, vermin, diseases or invaders.',
  extremism: 'Calls for violence, extremist codes and slogans, and Holocaust denial.',
  political: 'Insults and dehumanising language aimed at political sides.'
};
const DIAL_DESC = {
  1: 'Gentle: mutes only what is unmistakable, such as slurs and calls for violence.',
  2: 'Balanced: also mutes clear hateful claims about groups of people.',
  3: 'Strict: also mutes borderline phrasing. Expect the odd false alarm.'
};
const SRC_LABEL = { web: 'Page text', post: 'X post', quote: 'X quote', name: 'X name', bio: 'X bio', image: 'Image', selection: 'Added by you' };
const KIND_LABEL = { hit: 'Muted', reveal: 'Revealed', not_hateful: 'Not hateful', missed: 'Added by hand' };

const WELCOME_LOOKS = ['frost', 'veil', 'redact', 'bleep', 'kind', 'toddler', 'vanish'];

let s = BNetDefaults.DEFAULTS;

/* ---------- navigation ---------- */
function current() { const v = location.hash.slice(1); return document.getElementById('v-' + v) ? v : 'overview'; }
function show(view, focus) {
  if (!document.getElementById('v-' + view)) view = 'overview';
  document.querySelectorAll('.view').forEach(v => { const on = v.id === 'v-' + view; v.classList.toggle('on', on); v.hidden = !on; });
  document.querySelectorAll('.side a').forEach(a => { if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = view === 'welcome' ? 'Welcome to BNet' : 'BNet settings';
  if (view === 'overview') renderOverview();
  if (view === 'history') renderHistory();
  if (view === 'learning') renderLearning();
  if (view === 'packs') renderPacks();
  if (view === 'allow') renderAllow();
  // Moving between sections puts keyboard and screen-reader focus on the new heading.
  if (focus) { const h = document.querySelector('#v-' + view + ' h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
}
window.addEventListener('hashchange', () => show(current(), true));

/* ---------- overview ---------- */
async function renderOverview() {
  const { stats } = await chrome.storage.local.get('stats');
  const days = (stats && stats.days) || {};
  const list = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); list.push({ d, key: today(d), n: (days[today(d)] || {}).total || 0 }); }
  $('sToday').textContent = list[29].n.toLocaleString();
  $('sWeek').textContent = list.slice(23).reduce((a, x) => a + x.n, 0).toLocaleString();
  $('sMonth').textContent = list.reduce((a, x) => a + x.n, 0).toLocaleString();
  const max = Math.max(1, ...list.map(x => x.n));
  const chart = $('chart');
  chart.textContent = '';
  for (const x of list) {
    const bar = el('i', x.n ? '' : 'zero');
    bar.style.height = (x.n ? Math.max(6, x.n / max * 100) : 2) + '%';
    bar.title = BNetUI.fmtDate(x.d) + ': ' + x.n + ' muted';
    chart.appendChild(bar);
  }
  chart.setAttribute('aria-label', 'Muted per day, last 30 days: ' + $('sMonth').textContent + ' in all, most in one day ' + (max === 1 && !list.some(x => x.n) ? 0 : max) + '.');
  $('axisStart').textContent = BNetUI.fmtDate(list[0].d);
  const totals = {};
  for (const x of list) for (const [c, n] of Object.entries((days[x.key] || {}).cats || {})) totals[c] = (totals[c] || 0) + n;
  const kinds = $('kinds');
  kinds.textContent = '';
  const rows = Object.entries(totals).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { kinds.appendChild(el('p', 'note flush', 'Nothing muted in the last 30 days.')); return; }
  const kmax = rows[0][1];
  for (const [c, n] of rows) {
    const r = el('div', 'kind');
    const bar = el('i'); bar.setAttribute('aria-hidden', 'true');
    r.append(el('span', '', CAT_LABEL[c] || c), bar, el('em', '', n.toLocaleString()));
    r.style.setProperty('--w', Math.max(3, n / kmax * 100) + '%');
    kinds.appendChild(r);
  }
}

function syncOnOff() {
  const p = s.enabled && s.pausedUntil > Date.now();
  let t;
  if (!s.enabled) t = 'Off everywhere. Switch it on to mute again.';
  else if (p) { const d = new Date(s.pausedUntil); t = 'Paused until ' + (d.toDateString() === new Date().toDateString() ? '' : BNetUI.fmtDate(d) + ', ') + BNetUI.fmtTime(d) + '.'; }
  else t = 'Muting on every site you haven’t switched off.';
  $('onState').textContent = t;
  $('resume').hidden = !p;
}

/* ---------- controls: built once, then sync() makes them match storage ---------- */
function treatmentSelect(value, onChange, withDefault, label) {
  const sel = el('select', 'sel');
  sel.setAttribute('aria-label', label);
  if (withDefault) sel.appendChild(new Option('Default look', 'default'));
  for (const g of BNetTreatments.GROUPS) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const t of TREATMENTS.filter(x => x.group === g.id)) og.appendChild(new Option(t.label, t.id));
    sel.appendChild(og);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function buildCategories() {
  const box = $('cats');
  for (const c of E.CATEGORIES) {
    const it = el('div', 'item');
    const left = el('div');
    const name = el('b', '', c.label); name.id = 'cat-' + c.id;
    left.append(name, el('small', '', CAT_DESC[c.id]));
    const right = el('div', 'right');
    const sel = treatmentSelect('default', async v => { s = await store.saveSettings({ perCategory: { [c.id]: v } }); }, true, 'Look for ' + c.label);
    sel.dataset.cat = c.id;
    right.appendChild(sel);
    const sw = el('label', 'switch');
    const inp = el('input'); inp.type = 'checkbox'; inp.dataset.cat = c.id;
    inp.setAttribute('aria-labelledby', 'cat-' + c.id);
    inp.addEventListener('change', async () => { s = await store.saveSettings({ categories: { [c.id]: inp.checked } }); sync(); });
    sw.append(inp, el('span'));
    right.appendChild(sw);
    it.append(left, right);
    box.appendChild(it);
  }
}

function buildGallery() {
  const g = $('gallery');
  for (const grp of BNetTreatments.GROUPS) {
    const head = el('h3', 'gal-head', grp.label); head.id = 'gal-' + grp.id;
    g.appendChild(head);
    const grid = el('div', 'gal-grid');
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-labelledby', head.id);
    for (const t of TREATMENTS.filter(x => x.group === grp.id)) {
      const tile = el('div', 'tile');
      tile.setAttribute('role', 'listitem');
      tile.dataset.id = t.id;
      const p = el('p', 'specimen');
      BNetUI.specimen(p, t.id, 'gallery-' + t.id);
      const meta = el('div', 'meta');
      const left = el('div');
      left.append(el('b', '', t.label), el('small', '', t.hint));
      const pick = el('button', 'pick', 'Use');
      pick.setAttribute('aria-label', 'Use ' + t.label);
      pick.addEventListener('click', async () => { s = await store.saveSettings({ treatment: t.id }); sync(); });
      meta.append(left, pick);
      tile.append(p, meta);
      grid.appendChild(tile);
    }
    g.appendChild(grid);
  }
}

function buildWelcome() {
  const box = $('wLooks');
  for (const id of WELCOME_LOOKS) {
    const t = BNetTreatments.byId(id);
    if (!t) continue;
    const b = el('button', '', t.label);
    b.dataset.id = id; b.title = t.hint;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => pickWelcome(id));
    box.appendChild(b);
  }
  BNetUI.roving(box, '[role=radio]', b => pickWelcome(b.dataset.id));
}
async function pickWelcome(id) { s = await store.saveSettings({ treatment: id }); sync(); }

function bindControls() {
  document.querySelectorAll('.seg[data-key] button').forEach(b => b.addEventListener('click', async () => {
    const key = b.parentElement.dataset.key;
    s = await store.saveSettings({ [key]: key === 'dial' ? Number(b.dataset.v) : b.dataset.v });
    sync();
  }));
  document.querySelectorAll('[data-set]').forEach(inp => inp.addEventListener('change', async () => {
    const patch = { [inp.dataset.set]: inp.checked };
    if (inp.dataset.set === 'enabled') patch.pausedUntil = 0;
    s = await store.saveSettings(patch);
    sync();
  }));
  document.querySelectorAll('[data-surface]').forEach(inp => inp.addEventListener('change', async () => {
    s = await store.saveSettings({ surfaces: { [inp.dataset.surface]: inp.checked } });
  }));
  $('resume').addEventListener('click', async () => { s = await store.saveSettings({ pausedUntil: 0 }); sync(); });
  $('addSite').addEventListener('click', addSite);
  $('siteInput').addEventListener('keydown', e => { if (e.key === 'Enter') addSite(); });
}

// Every visible control is set from s here, so a change made in the popup (or another settings tab) shows up at once.
function sync() {
  document.querySelectorAll('.seg[data-key] button').forEach(b => {
    const v = s[b.parentElement.dataset.key];
    b.setAttribute('aria-pressed', String(String(v) === b.dataset.v));
  });
  document.querySelectorAll('[data-dial-desc]').forEach(n => { n.textContent = DIAL_DESC[s.dial] || ''; });
  document.querySelectorAll('#cats input[data-cat]').forEach(i => { i.checked = !!s.categories[i.dataset.cat]; });
  document.querySelectorAll('#cats select[data-cat]').forEach(sel => { const v = s.perCategory[sel.dataset.cat] || 'default'; if (sel.value !== v) sel.value = v; });
  document.querySelectorAll('[data-set]').forEach(i => { i.checked = !!s[i.dataset.set]; });
  document.querySelectorAll('[data-surface]').forEach(i => { i.checked = s.surfaces[i.dataset.surface] !== false; });
  document.querySelectorAll('.tile').forEach(t => {
    const on = s.treatment === t.dataset.id;
    t.classList.toggle('in-use', on);
    const b = t.querySelector('.pick');
    b.textContent = on ? 'In use' : 'Use';
    b.setAttribute('aria-pressed', String(on));
  });
  const radios = [...document.querySelectorAll('#wLooks [role=radio]')];
  for (const b of radios) b.setAttribute('aria-checked', String(b.dataset.id === s.treatment));
  BNetUI.setRoving(radios, radios.find(b => b.dataset.id === s.treatment));
  const spec = $('wSpec');
  if (spec.dataset.t !== s.treatment) { spec.dataset.t = s.treatment; BNetUI.specimen(spec, s.treatment, 'welcome'); }
  syncOnOff();
  renderOffSites();
}

/* ---------- sites switched off ---------- */
// Accepts "https://www.example.com/page", "example.com" or "www.example.com" and keeps just the host.
function cleanSite(text) {
  let t = String(text || '').trim().toLowerCase();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(t)) t = 'https://' + t;
  const host = BNetUI.siteOf(t);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$|^localhost$/.test(host) ? host : '';
}
async function addSite() {
  const msg = $('siteMsg');
  const site = cleanSite($('siteInput').value);
  msg.className = 'msg pad-x';
  if (!site) { msg.textContent = 'Type a site such as example.com.'; msg.classList.add('err', 'show'); return; }
  if ((s.offSites || []).includes(site)) { msg.textContent = site + ' is already off.'; msg.classList.add('show'); return; }
  s = await store.saveSettings({ offSites: [...(s.offSites || []), site] });
  $('siteInput').value = '';
  msg.textContent = 'BNet is now off on ' + site + '.';
  msg.classList.add('ok', 'show');
  sync();
}

function renderOffSites() {
  const box = $('offSites');
  box.textContent = '';
  const list = (s.offSites || []).slice().sort();
  $('offCount').textContent = list.length ? BNetUI.plural(list.length, 'site', 'sites') : '';
  if (!list.length) {
    const it = el('div', 'item');
    it.appendChild(el('small', '', 'None. BNet is on everywhere.'));
    box.appendChild(it);
    return;
  }
  for (const site of list) {
    const it = el('div', 'item');
    it.appendChild(el('div', 'site-name', site));
    const b = el('button', 'btn ghost', 'Switch on');
    b.setAttribute('aria-label', 'Switch BNet back on for ' + site);
    b.onclick = async () => {
      s = await store.saveSettings({ offSites: (s.offSites || []).filter(x => x !== site) });
      sync();
      // Keep keyboard focus in the list after the row disappears.
      const next = box.querySelector('button') || $('siteInput'); next.focus();
    };
    it.appendChild(b);
    box.appendChild(it);
  }
}

/* ---------- rule lists ---------- */
const bg = msg => chrome.runtime.sendMessage(msg).catch(err => ({ ok: false, error: String(err.message || err) }));
const KIND_TAG = { builtin: 'Built in', url: 'Subscribed', file: 'Imported', user: 'Yours' };
// BNet's own messages (and line-numbered rule errors) are already plain; browser and JSON errors
// ("Failed to fetch", "Unexpected token") are not, so those get one plain sentence instead.
const OWN_ERROR = /^(Use a full|That list is already|The list address answered|That address returned|No usable rules|Line \d)/;
const PLAIN_ERROR = { url: 'Couldn’t reach that address. Check it and try again.', file: 'That file isn’t a BNet rule list.' };
const plainError = (raw, kind) => (raw && OWN_ERROR.test(raw)) ? raw : PLAIN_ERROR[kind];
let userSaved = '';

function ago(t) {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  return BNetUI.fmtDate(t);
}

async function renderPacks() {
  let { lists } = await chrome.storage.local.get('lists');
  if (!lists || !lists.length) { const r = await bg({ type: 'lists:ensure' }); lists = (r && r.lists) || []; }
  const order = { builtin: 0, url: 1, file: 2, user: 3 };
  lists = lists.slice().sort((a, b) => (order[a.kind] - order[b.kind]) || String(a.title).localeCompare(b.title));
  const box = $('listCards');
  box.textContent = '';
  for (const l of lists) {
    const it = el('div', 'item');
    const left = el('div');
    const name = el('b', '', l.title || l.id);
    name.appendChild(el('span', 'kindtag', KIND_TAG[l.kind] || l.kind));
    const bits = [l.rules.toLocaleString() + (l.rules === 1 ? ' rule' : ' rules')];
    if (l.version) bits.push('version ' + l.version);
    if (l.kind === 'url') bits.push('updated ' + ago(l.updated));
    if (l.kind === 'builtin') bits.push('file: BNet/' + l.path);
    const meta = el('div', 'lmeta', bits.join(', '));
    left.append(name, meta);
    if (l.errorCount) left.appendChild(el('div', 'lmeta warn', l.errorCount + (l.errorCount === 1 ? ' line was' : ' lines were') + ' skipped. First: line ' + l.errors[0].line + ', ' + l.errors[0].message + '.'));
    if (l.lastError) left.appendChild(el('div', 'lmeta warn', 'Last update failed. ' + plainError(l.lastError, 'url')));
    const right = el('div', 'right');
    if (l.kind === 'url' || l.kind === 'file') {
      const rm = el('button', 'btn ghost danger', 'Remove');
      rm.addEventListener('click', async () => { await bg({ type: 'lists:remove', id: l.id }); renderPacks(); });
      right.appendChild(rm);
    }
    const sw = el('label', 'switch'); const inp = el('input'); inp.type = 'checkbox'; inp.checked = l.enabled !== false;
    inp.setAttribute('aria-label', 'Use ' + (l.title || l.id));
    inp.addEventListener('change', () => bg({ type: 'lists:toggle', id: l.id, enabled: inp.checked }));
    sw.append(inp, el('span')); right.appendChild(sw);
    it.append(left, right);
    box.appendChild(it);
  }
  const user = lists.find(l => l.id === 'user');
  $('userCount').textContent = user ? user.rules + (user.rules === 1 ? ' rule' : ' rules') : '';
  const { userRules } = await chrome.storage.local.get('userRules');
  if ($('userRules').value === userSaved) { $('userRules').value = userRules || ''; }
  userSaved = userRules || '';
  syncUserButtons();
  showErrors(user ? user.errors : []);
}

function syncUserButtons() {
  const dirty = $('userRules').value !== userSaved;
  $('saveUser').disabled = !dirty;
  $('revertUser').disabled = !dirty;
}
function showErrors(errs) {
  const ul = $('userErrs');
  ul.textContent = '';
  for (const e of errs || []) {
    const li = el('li', '', 'Line ' + e.line + ': ' + e.message + '  ');
    li.appendChild(el('code', '', e.text));
    ul.appendChild(li);
  }
}

async function saveUser() {
  const msg = $('userMsg');
  const r = await bg({ type: 'lists:saveUser', text: $('userRules').value });
  msg.className = 'msg';
  if (!r || !r.ok) { msg.textContent = (r && r.error) || 'Could not save.'; msg.classList.add('err'); return; }
  userSaved = $('userRules').value;
  syncUserButtons();
  showErrors(r.errors);
  msg.textContent = r.errors.length ? 'Applied. Fix the lines below to use them too.' : 'Applied.';
  msg.classList.add(r.errors.length ? 'err' : 'ok');
}

async function addUrl() {
  const msg = $('addMsg');
  msg.className = 'msg';
  const url = $('listUrl').value.trim();
  let origin;
  try { origin = new URL(url).origin; } catch (e) { msg.textContent = 'Enter the full address of a list, starting with https://.'; msg.classList.add('err'); return; }
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted) { msg.textContent = 'BNet needs permission to read that site to download the list.'; msg.classList.add('err'); return; }
  msg.textContent = 'Downloading\u2026';
  const r = await bg({ type: 'lists:addUrl', url });
  if (!r || !r.ok) { msg.textContent = plainError(r && r.error, 'url'); msg.classList.add('err'); return; }
  msg.textContent = 'Subscribed to ' + r.entry.title + ', ' + r.entry.rules.toLocaleString() + (r.entry.rules === 1 ? ' rule' : ' rules') + (r.entry.errorCount ? ', ' + r.entry.errorCount + ' lines skipped.' : '.');
  msg.classList.add('ok');
  $('listUrl').value = '';
  renderPacks();
}

async function importFile(file) {
  const msg = $('addMsg');
  msg.className = 'msg';
  const r = await bg({ type: 'lists:addText', text: await file.text(), name: file.name.replace(/\.(txt|json)$/i, '') });
  if (!r || !r.ok) { msg.textContent = plainError(r && r.error, 'file'); msg.classList.add('err'); return; }
  msg.textContent = 'Imported ' + r.entry.title + ', ' + r.entry.rules.toLocaleString() + (r.entry.rules === 1 ? ' rule' : ' rules') + (r.entry.errorCount ? ', ' + r.entry.errorCount + ' lines skipped.' : '.');
  msg.classList.add('ok');
  renderPacks();
}

function downloadText(name, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- learning ---------- */
async function renderLearning() {
  const { log } = await chrome.storage.local.get('log');
  const L = log || [];
  $('logSize').textContent = L.length.toLocaleString() + (L.length === 1 ? ' entry' : ' entries');
  const by = {};
  for (const x of L) by[x.kind] = (by[x.kind] || 0) + 1;
  $('logBreak').textContent = Object.keys(KIND_LABEL).filter(k => by[k]).map(k => KIND_LABEL[k] + ': ' + by[k].toLocaleString()).join(', ') || (s.learn ? 'Empty for now.' : 'Empty. The log is off.');
  $('exportLog').disabled = $('clearLog').disabled = !L.length;
}

function buildPrompt(log) {
  const pick = (kind, n) => log.filter(x => x.kind === kind).slice(-n);
  const missed = pick('missed', 150).map(x => ({ phrase: x.span, kind: x.cat }));
  const wrong = pick('not_hateful', 150).map(x => ({ phrase: x.span, matched_rule: x.rule, context: (x.ctx || '').slice(0, 240) }));
  const revealed = pick('reveal', 60).map(x => ({ phrase: x.span, rule: x.rule }));
  const hits = pick('hit', 80).map(x => ({ phrase: x.span, kind: x.cat, rule: x.rule, context: (x.ctx || '').slice(0, 200) }));
  return [
    'I use BNet, a browser extension that mutes hateful and extremist speech on websites using on-device rule lists. Please write a new BNet rule list that improves its coverage, based on my learning log below.',
    '',
    'Reply with ONLY the rule list as plain text, no commentary, starting with:',
    '! Title: AI list ' + today(),
    '! Version: ' + today(),
    '',
    'Syntax, one rule per line:',
    '  ! comment',
    '  phrase <kinds> <severity> <plain words>            e.g. phrase racism 2 go back to your country',
    '  phrase <kinds> <severity> /<regex>/                e.g. phrase extremism 3 /holo\\s*hoax/',
    '  slur <kind> <severity> <word>, <word>              plain spellings only; disguised spellings are handled automatically',
    '  group <kind> <plural group noun>, <noun>           who a hateful claim can be about',
    '  claim <severity> /<regex>/ [$tag=<kinds>] [$for=<kinds>]   words right after a group noun, e.g. claim 3 /are\\s+vermin/ $tag=dehumanising',
    '  before <severity> /<regex>/ [$tag=<kinds>]          words right before a group noun, e.g. before 2 /deport\\s+all/',
    '  allow /<regex>/                                   harmless phrases that must never be muted',
    '',
    'Rules:',
    '- Kinds: racism, religion, sexism, lgbtq, ableism, slurs, dehumanising, extremism, political. Several kinds are comma-separated with no spaces.',
    '- Severity: 3 = unmistakable (slurs, calls for violence, dehumanising), 2 = clear hate that needs a group or context, 1 = borderline.',
    '- Regexes are JavaScript sources without flags, run with "iu" on lowercased, accent-stripped text. Word edges are added automatically. Use \\s+ between words, never literal spaces. Do not escape "-" outside character classes.',
    '- Turn every item in "Missed" into a rule that catches it and close variants, without catching ordinary speech.',
    '- Turn every item in "Marked not hateful" into an allow rule.',
    '- Add well-known current hate codes, slurs and slogans a list like this would miss, especially ones trending online.',
    '- Keep false alarms low. Never mute neutral mentions of groups, news reporting, or people describing abuse they received.',
    '',
    'Missed (should have been muted):',
    JSON.stringify(missed, null, 0),
    '',
    'Marked not hateful (should NOT be muted):',
    JSON.stringify(wrong, null, 0),
    '',
    'Revealed by me (may be false alarms):',
    JSON.stringify(revealed, null, 0),
    '',
    'Recent muted examples (for style and coverage):',
    JSON.stringify(hits, null, 0)
  ].join('\n');
}

async function copyPrompt() {
  const st = await chrome.storage.local.get(['log']);
  const text = buildPrompt(st.log || []);
  const msg = $('copyMsg');
  try { await navigator.clipboard.writeText(text); msg.textContent = 'Copied. Paste it into Claude.'; msg.className = 'msg ok'; }
  catch (e) { msg.textContent = 'Could not reach the clipboard. Try again with this window in front.'; msg.className = 'msg err'; }
}

/* ---------- history ---------- */
async function renderHistory() {
  const { log } = await chrome.storage.local.get('log');
  const L = (log || []).slice().reverse();
  const kind = $('hKind').value, cat = $('hCat').value;
  const rows = L.filter(x => (kind === 'all' || x.kind === kind) && (cat === 'all' || x.cat === cat)).slice(0, 300);
  const body = $('hBody');
  body.textContent = '';
  $('hEmpty').hidden = rows.length > 0;
  for (const x of rows) {
    const tr = el('tr');
    const d = new Date(x.t);
    const when = el('td', 'when', (d.toDateString() === new Date().toDateString() ? '' : BNetUI.fmtDate(d) + ', ') + BNetUI.fmtTime(d));
    const ph = el('td', 'ph');
    const t = el('span', 'hide-til-hover', x.span || ''); t.tabIndex = 0;
    t.title = 'Hover or focus to read';
    ph.appendChild(t);
    const k = el('td');
    k.appendChild(el('span', 'chip k-' + x.kind, x.kind === 'hit' ? (CAT_LABEL[x.cat] || x.cat) : KIND_LABEL[x.kind]));
    const w = el('td', 'where');
    const host = BNetUI.siteOf(x.url);
    if (host) w.appendChild(el('span', 'host', host));
    w.appendChild(el('small', '', SRC_LABEL[x.src] || x.src || ''));
    const go = el('td', 'go');
    if (host) { const a = el('a', '', 'Open'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Open the page on ' + host); go.appendChild(a); }
    tr.append(when, ph, k, w, go);
    body.appendChild(tr);
  }
}

/* ---------- allow list ---------- */
async function renderAllow() {
  const { allow } = await chrome.storage.local.get('allow');
  const box = $('allowList');
  box.textContent = '';
  const list = (allow || []).slice().reverse();
  if (!list.length) { const it = el('div', 'item'); it.appendChild(el('small', '', 'Nothing here. When a muted phrase is harmless, reveal it on the page and choose Not hateful.')); box.appendChild(it); return; }
  for (const a of list) {
    const it = el('div', 'item');
    const left = el('div');
    left.append(el('span', 'phrase', a.span || a.key), el('small', '', (CAT_LABEL[a.cat] || '') + (a.t ? ', marked ' + BNetUI.fmtDate(a.t) : '')));
    const rm = el('button', 'btn ghost danger', 'Remove');
    rm.addEventListener('click', async () => {
      const cur = (await chrome.storage.local.get('allow')).allow || [];
      await chrome.storage.local.set({ allow: cur.filter(x => x.key !== a.key) });
      renderAllow();
    });
    it.append(left, rm);
    box.appendChild(it);
  }
}

/* ---------- init ---------- */
async function init() {
  $('ver').textContent = chrome.runtime.getManifest().version;
  for (const c of E.CATEGORIES) $('hCat').appendChild(new Option(c.label, c.id));
  buildCategories();
  buildGallery();
  buildWelcome();
  bindControls();
  s = await store.settings();
  sync();

  $('addUrl').addEventListener('click', addUrl);
  $('listUrl').addEventListener('keydown', e => { if (e.key === 'Enter') addUrl(); });
  $('importFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await importFile(f); e.target.value = ''; });
  $('userRules').addEventListener('input', syncUserButtons);
  $('userRules').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!$('saveUser').disabled) saveUser(); } });
  $('saveUser').addEventListener('click', saveUser);
  $('revertUser').addEventListener('click', () => { $('userRules').value = userSaved; syncUserButtons(); $('userMsg').textContent = ''; });
  $('exportUser').addEventListener('click', () => downloadText('bnet-my-rules.txt', $('userRules').value));
  $('updateAll').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true; $('updateMsg').textContent = 'Updating…';
    const r = await bg({ type: 'lists:refresh' });
    b.disabled = false;
    $('updateMsg').textContent = r && r.ok ? 'All lists are up to date.' : 'Update failed. ' + plainError(r && r.error, 'url');
    renderPacks();
  });
  $('exportLog').addEventListener('click', async () => { const { log } = await chrome.storage.local.get('log'); download('bnet-learning-log-' + today() + '.json', log || []); });
  let clearArmed = false, clearTimer = 0;
  $('clearLog').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (!clearArmed) { clearArmed = true; b.textContent = 'Click again to clear'; clearTimer = setTimeout(() => { clearArmed = false; b.textContent = 'Clear'; }, 3000); return; }
    clearTimeout(clearTimer);
    await chrome.storage.local.set({ log: [] }); clearArmed = false; b.textContent = 'Clear'; renderLearning();
  });
  $('copyPrompt').addEventListener('click', copyPrompt);
  $('hKind').addEventListener('change', renderHistory);
  $('hCat').addEventListener('change', renderHistory);

  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== 'local') return;
    const v = current();
    if (c.stats && v === 'overview') renderOverview();
    if (c.log && v === 'history') renderHistory();
    if (c.log && v === 'learning') renderLearning();
    if ((c.lists || c.userRules) && v === 'packs') renderPacks();
    if (c.allow && v === 'allow') renderAllow();
    if (c.settings && c.settings.newValue) {
      s = BNetDefaults.merge(BNetDefaults.DEFAULTS, c.settings.newValue);
      sync();
      if (v === 'learning') renderLearning();
    }
  });
  // A pause runs out on its own; keep the overview line honest.
  setInterval(syncOnOff, 15000);

  show(current(), false);
}
init();

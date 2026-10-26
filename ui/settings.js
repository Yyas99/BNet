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
const SRC_LABEL = { post: 'Post', quote: 'Quote', name: 'Name', bio: 'Bio', image: 'Image', selection: 'Your selection' };
const KIND_LABEL = { hit: 'Muted', reveal: 'Revealed', not_hateful: 'Not hateful', missed: 'Added by hand' };

let s;

/* ---------- navigation ---------- */
function show(view) {
  if (!document.getElementById('v-' + view)) view = 'overview';
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + view));
  document.querySelectorAll('.side a').forEach(a => { if (a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (view === 'overview') renderOverview();
  if (view === 'history') renderHistory();
  if (view === 'learning') renderLearning();
  if (view === 'packs') renderPacks();
  if (view === 'allow') renderAllow();
}
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

/* ---------- overview ---------- */
async function renderOverview() {
  const { stats } = await chrome.storage.local.get('stats');
  const days = (stats && stats.days) || {};
  const list = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); list.push({ d, key: today(d), n: (days[today(d)] || {}).total || 0 }); }
  $('sToday').textContent = list[29].n;
  $('sWeek').textContent = list.slice(23).reduce((a, x) => a + x.n, 0);
  $('sMonth').textContent = list.reduce((a, x) => a + x.n, 0);
  const max = Math.max(1, ...list.map(x => x.n));
  const chart = $('chart');
  chart.textContent = '';
  for (const x of list) {
    const bar = el('i', x.n ? '' : 'zero');
    bar.style.height = (x.n ? Math.max(6, x.n / max * 100) : 2) + '%';
    bar.title = BNetUI.fmtDate(x.d) + ': ' + x.n + ' muted';
    chart.appendChild(bar);
  }
  $('axisStart').textContent = BNetUI.fmtDate(list[0].d);
  const totals = {};
  for (const x of list) for (const [c, n] of Object.entries((days[x.key] || {}).cats || {})) totals[c] = (totals[c] || 0) + n;
  const kinds = $('kinds');
  kinds.textContent = '';
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!rows.length) { kinds.appendChild(el('p', 'note', 'Nothing muted in the last 30 days.')); return; }
  const kmax = rows[0][1];
  for (const [c, n] of rows) {
    const r = el('div', 'kind');
    r.append(el('span', '', CAT_LABEL[c] || c), el('i'), el('em', '', String(n)));
    r.style.setProperty('--w', Math.max(3, n / kmax * 100) + '%');
    kinds.appendChild(r);
  }
}

/* ---------- filtering ---------- */
function treatmentSelect(value, onChange, withDefault) {
  const sel = el('select', 'sel');
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

function renderFiltering() {
  document.querySelectorAll('#dial button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === s.dial)));
  $('dialDesc').textContent = DIAL_DESC[s.dial];
  document.querySelectorAll('#scope button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s.scope)));
  const box = $('cats');
  box.textContent = '';
  for (const c of E.CATEGORIES) {
    const it = el('div', 'item');
    const left = el('div');
    left.append(el('b', '', c.label), el('small', '', CAT_DESC[c.id]));
    const right = el('div', 'right');
    right.appendChild(treatmentSelect(s.perCategory[c.id] || 'default', async v => { s = await store.saveSettings({ perCategory: { [c.id]: v } }); }, true));
    const sw = el('label', 'switch');
    const inp = el('input'); inp.type = 'checkbox'; inp.checked = !!s.categories[c.id];
    inp.setAttribute('aria-label', c.label);
    inp.addEventListener('change', async () => { s = await store.saveSettings({ categories: { [c.id]: inp.checked } }); });
    sw.append(inp, el('span'));
    right.appendChild(sw);
    it.append(left, right);
    box.appendChild(it);
  }
}

/* ---------- look ---------- */
function renderGallery() {
  const g = $('gallery');
  g.textContent = '';
  for (const grp of BNetTreatments.GROUPS) {
    g.appendChild(el('h3', 'gal-head', grp.label));
    const grid = el('div', 'gal-grid');
    for (const t of TREATMENTS.filter(x => x.group === grp.id)) {
      const tile = el('div', 'tile');
      tile.setAttribute('role', 'radio');
      tile.setAttribute('aria-checked', String(s.treatment === t.id));
      const p = el('p', 'specimen');
      BNetUI.specimen(p, t.id, 'gallery-' + t.id);
      const meta = el('div', 'meta');
      const left = el('div');
      left.append(el('b', '', t.label), el('small', '', t.hint));
      left.querySelector('small').style.display = 'block';
      const pick = el('button', 'pick', s.treatment === t.id ? 'In use' : 'Use');
      pick.addEventListener('click', async () => { s = await store.saveSettings({ treatment: t.id }); renderGallery(); });
      meta.append(left, pick);
      tile.append(p, meta);
      grid.appendChild(tile);
    }
    g.appendChild(grid);
  }
}

function bindSwitches() {
  document.querySelectorAll('[data-set]').forEach(inp => {
    inp.checked = !!s[inp.dataset.set];
    inp.onchange = async () => { s = await store.saveSettings({ [inp.dataset.set]: inp.checked }); if (inp.dataset.set === 'learn') renderLearning(); };
  });
  document.querySelectorAll('[data-surface]').forEach(inp => {
    inp.checked = s.surfaces[inp.dataset.surface] !== false;
    inp.onchange = async () => { s = await store.saveSettings({ surfaces: { [inp.dataset.surface]: inp.checked } }); };
  });
}

/* ---------- rule lists ---------- */
const bg = msg => chrome.runtime.sendMessage(msg).catch(err => ({ ok: false, error: String(err.message || err) }));
const KIND_TAG = { builtin: 'Built in', url: 'Subscribed', file: 'Imported', user: 'Yours' };
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
    if (l.lastError) left.appendChild(el('div', 'lmeta warn', 'Last update failed: ' + l.lastError));
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
  if (!r || !r.ok) { msg.textContent = (r && r.error) || 'Could not add that list.'; msg.classList.add('err'); return; }
  msg.textContent = 'Subscribed to ' + r.entry.title + ', ' + r.entry.rules.toLocaleString() + (r.entry.rules === 1 ? ' rule' : ' rules') + (r.entry.errorCount ? ', ' + r.entry.errorCount + ' lines skipped.' : '.');
  msg.classList.add('ok');
  $('listUrl').value = '';
  renderPacks();
}

async function importFile(file) {
  const msg = $('addMsg');
  msg.className = 'msg';
  const r = await bg({ type: 'lists:addText', text: await file.text(), name: file.name.replace(/\.(txt|json)$/i, '') });
  if (!r || !r.ok) { msg.textContent = (r && r.error) || 'Could not import that file.'; msg.classList.add('err'); return; }
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
  $('logBreak').textContent = Object.keys(KIND_LABEL).filter(k => by[k]).map(k => KIND_LABEL[k] + ': ' + by[k].toLocaleString()).join(', ') || 'Empty for now.';
  document.querySelectorAll('[data-set="learn"]').forEach(i => { i.checked = !!s.learn; });
}

function buildPrompt(log) {
  const pick = (kind, n) => log.filter(x => x.kind === kind).slice(-n);
  const missed = pick('missed', 150).map(x => ({ phrase: x.span, kind: x.cat }));
  const wrong = pick('not_hateful', 150).map(x => ({ phrase: x.span, matched_rule: x.rule, context: (x.ctx || '').slice(0, 240) }));
  const revealed = pick('reveal', 60).map(x => ({ phrase: x.span, rule: x.rule }));
  const hits = pick('hit', 80).map(x => ({ phrase: x.span, kind: x.cat, rule: x.rule, context: (x.ctx || '').slice(0, 200) }));
  return [
    'I use BNet, a browser extension that mutes hateful and extremist speech on X using on-device rule lists (like ad-blocker filter lists). Please write a new BNet rule list that improves its coverage, based on my learning log below.',
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
    '- Kinds: racism, religion, sexism, lgbtq, slurs, dehumanising, extremism, political. Several kinds are comma-separated with no spaces.',
    '- Severity: 3 = unmistakable (slurs, calls for violence, dehumanising), 2 = clear hate that needs a group or context, 1 = borderline.',
    '- Regexes are JavaScript sources without flags, run with "iu" on lowercased, accent-stripped text. Word edges are added automatically. Use \\s+ between words, never literal spaces. Do not escape "-" outside character classes.',
    '- Turn every item in "Missed" into a rule that catches it and close variants, without catching ordinary speech.',
    '- Turn every item in "Marked not hateful" into an allow rule.',
    '- Add well-known current hate codes, slurs and slogans a list like this would miss, especially ones trending on X.',
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
    ph.appendChild(t);
    const k = el('td');
    k.appendChild(el('span', 'chip k-' + x.kind, x.kind === 'hit' ? (CAT_LABEL[x.cat] || x.cat) : KIND_LABEL[x.kind]));
    const w = el('td', '', SRC_LABEL[x.src] || x.src || '');
    const go = el('td');
    if (x.url && /^https:\/\/(x|twitter)\.com\//.test(x.url)) { const a = el('a', '', 'Open'); a.href = x.url; a.target = '_blank'; a.rel = 'noopener'; go.appendChild(a); }
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
  if (!list.length) { const it = el('div', 'item'); it.appendChild(el('small', '', 'Nothing here. When a muted phrase is harmless, reveal it on X and choose Not hateful.')); box.appendChild(it); return; }
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
  s = await store.settings();
  $('ver').textContent = chrome.runtime.getManifest().version;
  for (const c of E.CATEGORIES) $('hCat').appendChild(new Option(c.label, c.id));

  renderFiltering();
  renderGallery();
  bindSwitches();

  document.querySelectorAll('#dial button').forEach(b => b.addEventListener('click', async () => { s = await store.saveSettings({ dial: Number(b.dataset.v) }); renderFiltering(); }));
  document.querySelectorAll('#scope button').forEach(b => b.addEventListener('click', async () => { s = await store.saveSettings({ scope: b.dataset.v }); renderFiltering(); }));
  $('addUrl').addEventListener('click', addUrl);
  $('listUrl').addEventListener('keydown', e => { if (e.key === 'Enter') addUrl(); });
  $('importFile').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await importFile(f); e.target.value = ''; });
  $('userRules').addEventListener('input', syncUserButtons);
  $('userRules').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!$('saveUser').disabled) saveUser(); } });
  $('saveUser').addEventListener('click', saveUser);
  $('revertUser').addEventListener('click', () => { $('userRules').value = userSaved; syncUserButtons(); });
  $('exportUser').addEventListener('click', () => downloadText('bnet-my-rules.txt', $('userRules').value));
  $('updateAll').addEventListener('click', async e => {
    e.target.disabled = true; $('updateMsg').textContent = 'Updating\u2026';
    const r = await bg({ type: 'lists:refresh' });
    e.target.disabled = false;
    $('updateMsg').textContent = r && r.ok ? 'All lists are up to date.' : 'Update failed: ' + ((r && r.error) || 'unknown error');
    renderPacks();
  });
  $('exportLog').addEventListener('click', async () => { const { log } = await chrome.storage.local.get('log'); download('bnet-learning-log-' + today() + '.json', log || []); });
  let clearArmed = false;
  $('clearLog').addEventListener('click', async e => {
    if (!clearArmed) { clearArmed = true; e.target.textContent = 'Click again to clear'; setTimeout(() => { clearArmed = false; e.target.textContent = 'Clear log'; }, 3000); return; }
    await chrome.storage.local.set({ log: [] }); clearArmed = false; e.target.textContent = 'Clear log'; renderLearning();
  });
  $('copyPrompt').addEventListener('click', copyPrompt);
  $('hKind').addEventListener('change', renderHistory);
  $('hCat').addEventListener('change', renderHistory);

  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== 'local') return;
    const v = location.hash.slice(1) || 'overview';
    if (c.stats && v === 'overview') renderOverview();
    if (c.log && v === 'history') renderHistory();
    if (c.log && v === 'learning') renderLearning();
    if ((c.lists || c.userRules) && v === 'packs') renderPacks();
    if (c.allow && v === 'allow') renderAllow();
  });

  show(location.hash.slice(1) || 'overview');
}
init();

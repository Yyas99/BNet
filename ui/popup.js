'use strict';
const { store, today, merge, DEFAULTS } = BNetDefaults;
const { TREATMENTS, GROUPS } = BNetTreatments;
const { siteOf, plural } = BNetUI;
const CATS = Object.fromEntries(BNetEngine.CATEGORIES.map(c => [c.id, c.label]));
const DIAL_HINT = { 1: 'Only the unmistakable', 2: 'Clear hate and slurs', 3: 'Borderline too' };
const STORE_HOSTS = /^(chromewebstore\.google\.com|chrome\.google\.com|microsoftedge\.microsoft\.com|addons\.opera\.com)$/;
const $ = id => document.getElementById(id);

let s = DEFAULTS;
let tab = null;      // the active tab, or null
let page = null;     // what kind of page it is (classify)
let res = null;      // the content script's status reply, or null when it isn't running
let lookTab = null;

/* ---------- what kind of tab this is ---------- */
// BNet only runs on http(s) pages; everything else gets a plain reason instead of a broken switch.
function classify(url) {
  const u = String(url || '');
  const site = siteOf(u);
  if (site) {
    let path = ''; try { path = new URL(u).pathname; } catch (e) {}
    if (STORE_HOSTS.test(site) && /webstore|addons|^\/(detail|category)|^\/$/.test(path)) return { name: site, note: 'The browser keeps extensions off this site.' };
    return { web: true, site, name: site, pdf: /\.pdf$/i.test(path) };
  }
  if (/^(chrome|brave|edge|opera|vivaldi):\/\/(newtab|new-tab-page|startpage)|^chrome-search:|^about:(blank|newtab|home)/i.test(u)) return { name: 'New tab', note: 'Nothing to mute here.' };
  if (/^(chrome|brave|edge|opera|vivaldi|about|devtools|view-source):/i.test(u)) return { name: 'Browser page', note: 'Extensions can’t run on browser pages.' };
  if (/^(chrome|moz)-extension:/i.test(u)) return { name: 'Extension page', note: 'BNet doesn’t run inside extensions.' };
  if (/^file:/i.test(u)) return { name: 'File on this computer', note: 'BNet runs on websites only.' };
  return { name: 'This tab', note: 'BNet runs on websites only.' };
}

async function pageStatus() {
  if (!tab || !page || !page.web) return null;
  // A tab with no BNet in it rejects at once; the timeout guards a tab that is busy loading.
  const ask = chrome.tabs.sendMessage(tab.id, { type: 'status' }, { frameId: 0 }).catch(() => null);
  const res = await Promise.race([ask, new Promise(r => setTimeout(() => r(null), 600))]);
  // Comments in embedded frames count too: use the same per-tab total as the toolbar number.
  if (res && res.active) {
    try {
      const k = 'badge:' + tab.id, counts = (await chrome.storage.session.get(k))[k];
      if (counts && typeof counts === 'object') res.muted = Math.max(res.muted || 0, Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0));
    } catch (e) {}
  }
  return res;
}

/* ---------- header ---------- */
const paused = () => s.enabled && s.pausedUntil > Date.now();
function renderStatus() {
  const st = $('status');
  st.classList.toggle('off', !s.enabled);
  if (!s.enabled) st.textContent = 'Off everywhere';
  else if (paused()) {
    const d = new Date(s.pausedUntil);
    const sameDay = d.toDateString() === new Date().toDateString();
    st.textContent = 'Paused until ' + (sameDay ? '' : 'tomorrow, ') + BNetUI.fmtTime(d);
  } else st.textContent = 'On';
  $('enabled').checked = !!s.enabled;
  const p = paused();
  document.querySelectorAll('#pause [data-min]').forEach(b => { b.hidden = p; b.disabled = !s.enabled; });
  $('resume').hidden = !p;
}

/* ---------- this tab ---------- */
function renderSite() {
  const box = $('site'), sw = $('siteSwitch'), reload = $('reloadTab');
  const p = page || classify('');
  let text, tone = 'idle';
  reload.hidden = true;
  $('siteName').textContent = p.name;
  $('siteName').title = p.name;
  // The switch keeps its place on every kind of page (visibility, not display) so nothing shifts.
  sw.style.visibility = p.web ? '' : 'hidden';
  $('siteOn').disabled = !p.web;
  if (!p.web) text = p.note;
  else {
    const on = !(s.offSites || []).includes(p.site);
    $('siteOn').checked = on;
    if (!s.enabled) text = 'BNet is off everywhere';
    else if (paused()) text = 'Paused';
    else if (!on) { text = 'Off on this site'; tone = 'warn'; }
    else if (p.pdf) text = 'BNet can’t read PDF files';
    else if (!res) { text = 'Not running in this tab yet'; tone = 'warn'; reload.hidden = false; }
    else if (!res.rules) { text = 'No rules loaded'; tone = 'warn'; }
    else if (res.muted) { text = plural(res.muted, 'phrase', 'phrases') + ' muted on this page'; tone = 'on'; }
    else { text = 'Nothing to mute on this page'; tone = 'on'; }
  }
  $('pageText').textContent = text;
  $('pageText').title = text;
  box.dataset.tone = tone;
}

/* ---------- looks: built once, then only attributes change (keeps focus and size) ---------- */
function buildLooks() {
  const tabs = $('lookTabs'), panels = $('lookPanels');
  for (const g of GROUPS) {
    const t = document.createElement('button');
    t.id = 'tab-' + g.id;
    t.dataset.g = g.id;
    t.textContent = g.short || g.label;
    t.title = g.label;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', 'panel-' + g.id);
    t.addEventListener('click', () => { lookTab = g.id; syncLooks(); });
    tabs.appendChild(t);
    const panel = document.createElement('div');
    panel.id = 'panel-' + g.id;
    panel.className = 'panel';
    panel.dataset.g = g.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'tab-' + g.id);
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', g.label);
    for (const tr of TREATMENTS.filter(x => x.group === g.id)) {
      const b = document.createElement('button');
      b.textContent = tr.label;
      b.title = tr.hint;
      b.dataset.id = tr.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => pickLook(tr.id));
      chips.appendChild(b);
    }
    panel.appendChild(chips);
    BNetUI.roving(panel, '[role=radio]', b => pickLook(b.dataset.id));
    panels.appendChild(panel);
  }
  BNetUI.roving(tabs, '[role=tab]', t => { lookTab = t.dataset.g; syncLooks(); });
}
async function pickLook(id) {
  s = await store.saveSettings({ treatment: id });
  renderLooksAndPreview();
}
function syncLooks() {
  const cur = BNetTreatments.byId(s.treatment);
  if (!lookTab) lookTab = cur ? cur.group : 'hide';
  const tabs = [...document.querySelectorAll('#lookTabs [role=tab]')];
  for (const t of tabs) { t.setAttribute('aria-selected', String(t.dataset.g === lookTab)); t.setAttribute('aria-pressed', String(t.dataset.g === lookTab)); }
  BNetUI.setRoving(tabs, tabs.find(t => t.dataset.g === lookTab));
  // All panels share one grid cell, so the block is always as tall as the biggest group.
  document.querySelectorAll('#lookPanels .panel').forEach(p => {
    const on = p.dataset.g === lookTab;
    p.classList.toggle('off', !on);
    p.inert = !on;
    const radios = [...p.querySelectorAll('[role=radio]')];
    for (const b of radios) b.setAttribute('aria-checked', String(b.dataset.id === s.treatment));
    BNetUI.setRoving(radios, radios.find(b => b.dataset.id === s.treatment));
  });
}
function renderLooksAndPreview() {
  syncLooks();
  BNetUI.specimen($('specimen'), s.treatment, 'popup', true);
}

/* ---------- today ---------- */
async function renderToday() {
  const { stats } = await chrome.storage.local.get('stats');
  const day = stats && stats.days && stats.days[today()];
  $('count').textContent = (day ? day.total : 0).toLocaleString();
  const bars = $('bars');
  bars.textContent = '';
  const entries = day ? Object.entries(day.cats || {}).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  if (!entries.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nothing muted yet today.';
    bars.appendChild(p);
    return;
  }
  const max = entries[0][1];
  for (const [cat, n] of entries) {
    const row = document.createElement('div');
    row.className = 'bar';
    row.innerHTML = '<span></span><em></em><i aria-hidden="true"></i>';
    row.children[0].textContent = CATS[cat] || cat;
    row.children[1].textContent = n.toLocaleString();
    row.style.setProperty('--w', Math.max(4, n / max * 100) + '%');
    bars.appendChild(row);
  }
}

function renderAll() {
  renderStatus();
  renderSite();
  renderLooksAndPreview();
  document.querySelectorAll('#dial button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === s.dial)));
  $('dialHint').textContent = DIAL_HINT[s.dial] || '';
}

async function refreshPage() {
  res = await pageStatus();
  renderSite();
}

async function init() {
  buildLooks();
  // Everything the first paint needs is fetched together, so the popup opens at its final size.
  let tabs = [];
  try { tabs = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) {}
  tab = tabs[0] || null;
  page = classify(tab && tab.url);
  [s, res] = await Promise.all([store.settings(), pageStatus(), renderToday()]);
  renderAll();

  $('enabled').addEventListener('change', async e => { s = await store.saveSettings({ enabled: e.target.checked, pausedUntil: 0 }); renderAll(); setTimeout(refreshPage, 300); });
  $('siteOn').addEventListener('change', async e => {
    if (!page || !page.web) return;
    const off = new Set(s.offSites || []);
    if (e.target.checked) off.delete(page.site); else off.add(page.site);
    s = await store.saveSettings({ offSites: [...off] });
    renderSite();
    setTimeout(refreshPage, 300);
  });
  document.querySelectorAll('#dial button').forEach(b => b.addEventListener('click', async () => {
    s = await store.saveSettings({ dial: Number(b.dataset.v) }); renderAll();
  }));
  document.querySelectorAll('#pause [data-min]').forEach(b => b.addEventListener('click', async () => {
    let until;
    if (b.dataset.min === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); until = d.getTime(); }
    else until = Date.now() + Number(b.dataset.min) * 60000;
    s = await store.saveSettings({ pausedUntil: until }); renderAll();
    $('resume').focus();
  }));
  $('resume').addEventListener('click', async () => {
    s = await store.saveSettings({ pausedUntil: 0 }); renderAll();
    const first = document.querySelector('#pause [data-min]'); if (first) first.focus();
  });
  $('reloadTab').addEventListener('click', async () => { if (tab) await chrome.tabs.reload(tab.id); window.close(); });
  $('open').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

  // Settings changed in the settings page (or another popup) show up here straight away.
  chrome.storage.onChanged.addListener((c, a) => {
    if (a !== 'local') return;
    if (c.stats) renderToday();
    if (c.settings && c.settings.newValue) { s = merge(DEFAULTS, c.settings.newValue); renderAll(); setTimeout(refreshPage, 300); }
  });
  // The page keeps muting while the popup is open, and a pause can run out.
  setInterval(async () => { if (page && page.web) res = await pageStatus(); renderStatus(); renderSite(); }, 2000);
}
init();

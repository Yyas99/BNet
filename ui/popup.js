'use strict';
const { store, today } = BNetDefaults;
const { TREATMENTS } = BNetTreatments;
const CATS = Object.fromEntries(BNetEngine.CATEGORIES.map(c => [c.id, c.label]));
const DIAL_HINT = { 1: 'Only the unmistakable', 2: 'Clear hate and slurs', 3: 'Also borderline phrasing' };
const $ = id => document.getElementById(id);

let s;

let lookTab = null;
function renderLooks() {
  const box = $('looks');
  box.textContent = '';
  const current = BNetTreatments.byId(s.treatment);
  if (!lookTab) lookTab = current ? current.group : 'hide';
  const tabs = document.createElement('div');
  tabs.className = 'seg looktabs';
  for (const g of BNetTreatments.GROUPS) {
    const t = document.createElement('button');
    t.textContent = g.short || g.label;
    t.title = g.label;
    t.setAttribute('aria-pressed', String(lookTab === g.id));
    t.addEventListener('click', () => { lookTab = g.id; renderLooks(); });
    tabs.appendChild(t);
  }
  const row = document.createElement('div');
  row.className = 'chips';
  row.setAttribute('role', 'radiogroup');
  for (const t of TREATMENTS.filter(x => x.group === lookTab)) {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.title = t.hint;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(s.treatment === t.id));
    b.addEventListener('click', async () => { s = await store.saveSettings({ treatment: t.id }); render(); });
    row.appendChild(b);
  }
  box.append(tabs, row);
}

function renderStatus() {
  const st = $('status');
  st.classList.remove('off');
  const paused = s.enabled && s.pausedUntil > Date.now();
  if (!s.enabled) { st.textContent = 'Off'; st.classList.add('off'); }
  else if (paused) {
    const d = new Date(s.pausedUntil);
    const sameDay = d.toDateString() === new Date().toDateString();
    st.textContent = 'Paused until ' + (sameDay ? BNetUI.fmtTime(d) : 'tomorrow, ' + BNetUI.fmtTime(d));
  } else st.textContent = 'Active on X';
  $('enabled').checked = !!s.enabled;
  $('pause').hidden = paused || !s.enabled;
  $('resume').hidden = !paused;
}

async function renderToday() {
  const { stats } = await chrome.storage.local.get('stats');
  const day = stats && stats.days && stats.days[today()];
  $('count').textContent = day ? day.total : 0;
  const bars = $('bars');
  bars.textContent = '';
  const entries = day ? Object.entries(day.cats).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
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
    row.innerHTML = '<span></span><em></em><i></i>';
    row.children[0].textContent = CATS[cat] || cat;
    row.children[1].textContent = n;
    row.style.setProperty('--w', Math.max(4, n / max * 100) + '%');
    bars.appendChild(row);
  }
}

function render() {
  renderStatus();
  renderLooks();
  BNetUI.specimen($('specimen'), s.treatment, 'popup');
  document.querySelectorAll('#dial button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === s.dial)));
  $('dialHint').textContent = DIAL_HINT[s.dial];
}

async function renderTab() {
  const line = $('tabline'), txt = $('tabtext'), btn = $('reloadTab');
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { return; }
  if (!tab || !/^https:\/\/(mobile\.)?(x|twitter)\.com\//.test(tab.url || '')) { line.hidden = true; return; }
  line.hidden = false;
  txt.textContent = 'Checking this page\u2026';
  let res = null;
  try { res = await chrome.tabs.sendMessage(tab.id, { type: 'status' }); } catch (e) { res = null; }
  line.classList.toggle('warn', !res || !res.active);
  btn.hidden = !!res;
  if (!res) txt.textContent = 'BNet is not running in this tab yet.';
  else if (!res.active) txt.textContent = 'Off or paused in this tab.';
  else if (!res.rules) { line.classList.add('warn'); txt.textContent = 'Running, but no rules loaded.'; }
  else txt.textContent = (res.muted ? res.muted + (res.muted === 1 ? ' phrase' : ' phrases') + ' muted on this page' : 'Nothing to mute on this page') + ' \u2014 ' + res.scanned + ' blocks read, ' + res.rules.toLocaleString() + ' rules';
  btn.onclick = async () => { await chrome.tabs.reload(tab.id); window.close(); };
}

async function init() {
  s = await store.settings();
  render();
  renderToday();
  renderTab();

  $('enabled').addEventListener('change', async e => { s = await store.saveSettings({ enabled: e.target.checked, pausedUntil: 0 }); render(); setTimeout(renderTab, 300); });
  document.querySelectorAll('#dial button').forEach(b => b.addEventListener('click', async () => {
    s = await store.saveSettings({ dial: Number(b.dataset.v) }); render();
  }));
  document.querySelectorAll('#pause button').forEach(b => b.addEventListener('click', async () => {
    let until;
    if (b.dataset.min === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); until = d.getTime(); }
    else until = Date.now() + Number(b.dataset.min) * 60000;
    s = await store.saveSettings({ pausedUntil: until }); render();
  }));
  $('resume').addEventListener('click', async () => { s = await store.saveSettings({ pausedUntil: 0 }); render(); });
  $('open').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  chrome.storage.onChanged.addListener((c, a) => { if (a === 'local' && c.stats) renderToday(); });
}
init();

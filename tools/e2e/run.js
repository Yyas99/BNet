/* BNet end-to-end checks: loads this repo's extension into Chromium with Playwright, serves the mock pages in
 * tools/e2e/pages on localhost:8810 (X mocks are served on x.com through ctx.route, because the content script
 * only gives X its special handling on that host) and walks every user-facing feature.
 *   node tools/e2e/run.js            all checks
 *   node tools/e2e/run.js news x     only the groups whose name contains one of the words
 * Prints ok/FAIL per check and a total; exits 1 if any check failed. */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

const EXT = path.resolve(__dirname, '..', '..');
const PAGES = path.join(__dirname, 'pages');
const PORT = 8810, ORIGIN = 'http://localhost:' + PORT;
const ONLY = process.argv.slice(2);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bnet-e2e-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('ok   ' + name); }
  else { failed++; failures.push(name); console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
  return !!cond;
}
// Poll until fn returns something truthy (or time runs out), so checks wait only as long as they need.
async function until(fn, ms = 4000, every = 100) {
  const end = Date.now() + ms; let v;
  for (;;) { try { v = await fn(); } catch (e) { v = null; } if (v || Date.now() > end) return v; await sleep(every); }
}

/* ---------- local server ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };
function serve() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const file = path.join(PAGES, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(PAGES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(PORT, '127.0.0.1', () => resolve(srv)); });
}

/* ---------- browser helpers ---------- */
let ctx, sw, extId;
const consoleErrors = []; // [where, text]
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) consoleErrors.push([label(), m.text()]); });
  page.on('pageerror', e => consoleErrors.push([label(), 'pageerror: ' + e.message]));
  return page;
}
async function open(url, label) {
  const p = await ctx.newPage();
  watch(p, () => label || p.url());
  await p.goto(url);
  return p;
}
const masks = p => p.$$eval('bnet-mask:not(.bnet-cont)', m => m.map(x => x.dataset.o));
const masksIn = (p, sel) => p.$$eval(sel + ' bnet-mask:not(.bnet-cont)', m => m.map(x => x.dataset.o)).catch(() => []);
const has = (list, re) => list.some(x => re.test(x));
const bgEval = (fn, arg) => sw.evaluate(fn, arg);
const settings = patch => bgEval(async p => { await self.BNetDefaults.store.saveSettings(p); }, patch);
const resetSettings = () => bgEval(async () => { await chrome.storage.local.set({ settings: self.BNetDefaults.DEFAULTS, allow: [] }); });
const tabFor = urlPattern => bgEval(async u => (await chrome.tabs.query({ url: u }))[0], urlPattern);
const badgeOf = tabId => bgEval(id => chrome.action.getBadgeText({ tabId: id }), tabId);
const statusOf = tabId => bgEval(id => chrome.tabs.sendMessage(id, { type: 'status' }), tabId);
const userRules = () => bgEval(async () => (await chrome.storage.local.get('userRules')).userRules || '');

/* ---------- groups of checks ---------- */
const groups = [];
const group = (name, fn) => groups.push([name, fn]);
let news, xpage; // shared pages

group('boot', async () => {
  const lists = await until(() => bgEval(async () => { const { lists } = await chrome.storage.local.get('lists'); return lists && lists.find(l => l.id === 'core' && l.rules > 0) && lists; }), 8000);
  check('core list loaded into storage', lists && lists.find(l => l.id === 'core').rules > 1000, lists && lists.map(l => l.id + ':' + l.rules));
  check('core list parses with no skipped lines', lists && lists.find(l => l.id === 'core').errorCount === 0, lists && lists.find(l => l.id === 'core').errors);
  check('My rules list exists', lists && lists.some(l => l.id === 'user'));
  const st = await bgEval(async () => (await chrome.storage.local.get('settings')).settings);
  check('default settings written on install', st && st.enabled === true && st.dial === 2);
  const menu = await bgEval(() => new Promise(r => chrome.contextMenus.update('bnet-mute', {}, () => r(!chrome.runtime.lastError))));
  check('context menu "Mute with BNet" registered', menu);
});

group('news', async () => {
  news = await open(ORIGIN + '/news.html', 'news.html');
  const m = await until(async () => { const v = await masks(news); return has(v, /n1gg3r/) && v; }, 5000);
  check('generic page: hateful claim inside a link muted', m && has(m, /immigrants are vermin/i), m);
  check('generic page: list item muted', has(m || [], /Women belong in the kitchen/i), m);
  check('generic page: blockquote muted', has(m || [], /Trans people are mentally ill/i), m);
  check('generic page: comment added later muted', has(m || [], /n1gg3r/), m);
  check('generic page: paragraph far down a long page muted', (await masksIn(news, '#filler')).some(x => /kill all the jews/i.test(x)));
  check('generic page: news headline left readable', (await masksIn(news, '#p3')).length === 0, await masksIn(news, '#p3'));
  check('generic page: text around a mask intact', await news.$eval('#p1', e => e.textContent.startsWith('At the meeting one man shouted that') && e.textContent.endsWith('asked to leave.')));
  check('generic page: nested list item untouched', await news.$eval('#li2', e => e.innerHTML === 'Organisers removed it quickly'));
  check('generic page: code, textarea, input, contenteditable untouched',
    (await news.$$('#code bnet-mask, #ce bnet-mask')).length === 0 && await news.$eval('#ta', e => e.value === 'go back to your country') && await news.$eval('#inp', e => e.value === 'deport them all'));
  const before = news.url();
  await news.click('#p1 bnet-mask');
  check('generic page: clicking a mask inside a link does not navigate', news.url() === before, news.url());
  await news.keyboard.press('Escape');
  await news.click('#p1 bnet-mask'); // close again
});

group('comments', async () => {
  const p = await open(ORIGIN + '/comments.html', 'comments.html');
  await until(async () => (await masksIn(p, '#k1 > .body')).length, 4000);
  check('comments: nested reply muted', has(await masksIn(p, '#k2 > .body'), /muslims are vermin/i), await masksIn(p, '#k2'));
  check('comments: counter-reply and metadata untouched', (await masksIn(p, '#k3')).length === 0 && (await masksIn(p, '.meta')).length === 0);
  check('comments: text edited in place after load muted', has(await masksIn(p, '#k1 > .body'), /jews control the media/i), await masksIn(p, '#k1'));
  check('comments: split text with inline tags left readable', (await masksIn(p, '#k4')).length === 0);
  await p.click('#more');
  const k5 = await until(async () => { const v = await masksIn(p, '#k5'); return v.length && v; }, 3000);
  check('comments: "load more" comment muted', k5 && has(k5, /retard/i), k5);
  check('comments: "load more" clean comment untouched', (await masksIn(p, '#k6')).length === 0);
  await p.close();
});

group('reveal', async () => {
  const sel = '#bq bnet-mask';
  await news.click(sel);
  check('reveal: click opens the phrase', await news.$eval(sel, e => e.classList.contains('bnet-open')));
  check('reveal: chip shows Hide again + Not hateful', await news.$$eval('bnet-chip button', b => b.map(x => x.textContent).join('|')) === 'Hide again|Not hateful');
  await news.click('bnet-chip button[data-act="hide"]');
  check('reveal: Hide again closes the phrase and chip', !(await news.$eval(sel, e => e.classList.contains('bnet-open'))) && !(await news.$('bnet-chip')));
  await news.focus(sel); await news.keyboard.press('Enter');
  check('reveal: keyboard Enter opens the phrase', await news.$eval(sel, e => e.classList.contains('bnet-open')));
  const logged = await until(() => bgEval(async () => ((await chrome.storage.local.get('log')).log || []).some(x => x.kind === 'reveal')), 2000);
  check('reveal: logged in learning log', logged);
  await news.click('bnet-chip button[data-act="ok"]');
  check('reveal: Not hateful thanks the user', /leave this alone/.test(await news.$eval('bnet-chip', e => e.textContent).catch(() => '')));
  const allow = await until(() => bgEval(async () => { const a = (await chrome.storage.local.get('allow')).allow || []; return a.length && a; }), 2000);
  check('reveal: Not hateful adds to allow list', allow && /trans people are mentally ill/i.test(allow[0].span), allow);
  const gone = await until(async () => (await masksIn(news, '#bq')).length === 0, 2000);
  check('reveal: allowed phrase is unmuted on the page', gone, await masksIn(news, '#bq'));
  // The settings Allowed view lists it and can remove it again.
  const st = await open(`chrome-extension://${extId}/ui/settings.html#allow`, 'settings#allow');
  await until(() => st.$('#allowList .btn'), 2000);
  check('reveal: settings lists the allowed phrase', /mentally ill/i.test(await st.textContent('#allowList')));
  await st.click('#allowList .btn');
  const back = await until(async () => (await masksIn(news, '#bq')).length > 0, 2500);
  check('reveal: removing from allow list mutes it again', back);
  await st.close();
});

group('looks', async () => {
  const orig = (await news.$eval('#p1 bnet-mask', e => e.dataset.o));
  for (const t of ['veil', 'pixel', 'bleep', 'kind', 'pirate', 'vanish']) {
    await settings({ treatment: t });
    const r = await until(async () => { const v = await news.$eval('#p1 bnet-mask', e => [e.className, e.querySelector('.bnet-a').textContent]); return v[0].includes('bnet-t-' + t) && v; }, 2500);
    check('look ' + t + ': applied to the page', r, r);
    if (r && t !== 'vanish') check('look ' + t + ': real words not drawn as the cover', r[1] && r[1] !== orig && !/vermin/i.test(r[1]), r[1]);
  }
  await settings({ treatment: 'frost', perCategory: { racism: 'pirate' } });
  const per = await until(async () => { const v = await news.$$eval('bnet-mask[data-cat="racism"]:not(.bnet-cont)', m => m.map(x => x.className)); return v.length && v.every(c => c.includes('bnet-t-pirate')) && v; }, 2500);
  check('look per kind: racism uses its own look', per, per);
  await settings({ perCategory: { racism: 'default' }, scope: 'sentence' });
  const sent = await until(async () => { const v = (await masksIn(news, '#p1'))[0] || ''; return /^At the meeting/.test(v) && v; }, 2500);
  check('scope sentence: whole sentence muted', sent, await masksIn(news, '#p1'));
  await settings({ scope: 'phrase' });
  await until(async () => !/^At the meeting/.test((await masksIn(news, '#p1'))[0] || ''), 2500);
});

group('pause', async () => {
  const n = (await masks(news)).length;
  await settings({ pausedUntil: Date.now() + 60 * 60e3 });
  check('pause: masks removed while paused', await until(async () => (await masks(news)).length === 0, 2500));
  check('pause: toolbar shows pause', await until(async () => (await bgEval(() => chrome.action.getBadgeText({}))) === '❚❚', 2000), await bgEval(() => chrome.action.getBadgeText({})));
  await settings({ pausedUntil: 0 });
  check('resume: masks back', await until(async () => (await masks(news)).length === n, 2500), (await masks(news)).length + ' vs ' + n);
  await settings({ pausedUntil: Date.now() + 1500 });
  await until(async () => (await masks(news)).length === 0, 1500);
  check('pause: short pause ends on its own', await until(async () => (await masks(news)).length === n, 4000));
  await settings({ enabled: false });
  check('off switch: masks removed', await until(async () => (await masks(news)).length === 0, 2500));
  check('off switch: toolbar shows off', await until(async () => (await bgEval(() => chrome.action.getBadgeText({}))) === 'off', 2000));
  await settings({ enabled: true });
  check('on again: masks back', await until(async () => (await masks(news)).length === n, 2500));
});

group('popup', async () => {
  const tab = await tabFor(ORIGIN + '/news.html');
  const pop = await ctx.newPage();
  watch(pop, () => 'popup');
  await pop.setViewportSize({ width: 344, height: 640 });
  // The popup asks for the active tab; opened as a page it would find itself, so point it at the news tab.
  await pop.addInitScript(t => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async (o) => (o && o.active) ? [t] : q(o); }, tab);
  await pop.goto(`chrome-extension://${extId}/ui/popup.html`);
  const line = await until(async () => { const v = await pop.textContent('#pageText'); return /muted on this page/.test(v) && v; }, 3000);
  check('popup: renders with status and page line', line && (await pop.textContent('#status')) === 'On', line);
  check('popup: looks and preview rendered', (await pop.$$('#lookPanels button[role=radio]')).length >= 10 && !!(await pop.$('#specimen bnet-mask')));
  check('popup: today count shown', Number(await pop.textContent('#count')) > 0, await pop.textContent('#count'));
  await pop.click('#dial button[data-v="3"]');
  check('popup: strictness saves', await until(async () => (await bgEval(async () => (await chrome.storage.local.get('settings')).settings.dial)) === 3, 1500));
  await pop.click('#dial button[data-v="2"]');
  await pop.click('#lookTabs [role=tab]:nth-child(2)');
  await pop.click('#lookPanels .panel[data-g="voice"] button[role=radio]:nth-child(1)');
  check('popup: picking a rewrite voice saves', await until(async () => (await bgEval(async () => (await chrome.storage.local.get('settings')).settings.treatment)) === 'kind', 1500));
  await settings({ treatment: 'frost' });
  // Per-site switch
  check('popup: site row names the site', (await pop.textContent('#siteName')) === 'localhost');
  await pop.click('#siteSwitch');
  const off = await until(async () => (await bgEval(async () => (await chrome.storage.local.get('settings')).settings.offSites)).includes('localhost'), 1500);
  check('site off: saved from popup', off);
  check('site off: page unmuted', await until(async () => (await masks(news)).length === 0 && (await news.$$('.bnet-img-mask')).length === 0, 2500));
  check('site off: popup says off', /off/i.test(await until(async () => { const v = await pop.textContent('#pageText'); return /Off on this site/.test(v) && v; }, 2000) || ''));
  const other = await open(ORIGIN + '/comments.html', 'comments.html');
  check('site off: applies to other pages of the site', await until(async () => (await statusOf((await tabFor(ORIGIN + '/comments.html')).id)).siteOff, 2500) && (await masks(other)).length === 0);
  await other.close();
  const st = await open(`chrome-extension://${extId}/ui/settings.html#where`, 'settings#where');
  check('site off: listed in settings', /localhost/.test(await st.textContent('#offSites')));
  await st.click('#offSites .btn');
  await news.bringToFront(); // a background tab only redraws when it is looked at
  check('site on: Turn back on from settings', await until(async () => (await masks(news)).length > 3, 2500), { masks: (await masks(news)).length, offSites: (await bgEval(async () => (await chrome.storage.local.get('settings')).settings.offSites)), ui: await st.textContent('#offSites') });
  await st.close(); await pop.close();
});

group('menu', async () => {
  const tab = await tabFor(ORIGIN + '/news.html');
  await bgEval(t => serial(() => addPersonal('  zebra   crossing plan ', null, t)), tab);
  const rules = await userRules();
  check('menu mute: phrase added to My rules', /^phrase \w+ 3 zebra crossing plan$/m.test(rules), rules.split('\n').slice(-3));
  check('menu mute: page mutes it at once', await until(async () => has(await masksIn(news, '#custom'), /zebra crossing plan/), 8000));
  check('menu mute: toast shown', /Muted everywhere/.test(await until(() => news.$eval('bnet-chip.bnet-toast', e => e.textContent), 1500) || ''));
  await bgEval(t => serial(() => addPersonal('zebra crossing plan', 'racism', t)), tab);
  check('menu mute: same phrase twice is not duplicated', (await userRules()).split('\n').filter(l => /zebra crossing plan/i.test(l)).length === 1);
  const log = await bgEval(async () => ((await chrome.storage.local.get('log')).log || []).filter(x => x.kind === 'missed').length);
  check('menu mute: logged as added by hand', log >= 1);
});

group('rules', async () => {
  const st = await open(`chrome-extension://${extId}/ui/settings.html#packs`, 'settings#packs');
  await until(async () => (await st.inputValue('#userRules')).length > 0, 2000);
  const start = await st.inputValue('#userRules');
  check('My rules: editor shows saved rules', /zebra crossing plan/.test(start));
  check('My rules: Apply disabled until edited', await st.$eval('#saveUser', b => b.disabled));
  await st.fill('#userRules', start + 'phrase religion 3 Elm Street\nbogus line here\nslur racism 9 foo\n');
  check('My rules: Apply enabled after edit', !(await st.$eval('#saveUser', b => b.disabled)));
  await st.click('#saveUser');
  const msg = await until(async () => { const v = await st.textContent('#userMsg'); return v && v; }, 2000);
  check('My rules: save reports skipped lines', /Fix the lines/.test(msg || ''), msg);
  const errs = await st.$$eval('#userErrs li', l => l.map(x => x.textContent));
  check('My rules: two errors listed with line numbers', errs.length === 2 && errs.every(e => /^Line \d+:/.test(e)), errs);
  check('My rules: good line applied to page', await until(async () => has(await masksIn(news, '#custom'), /Elm Street/), 2500));
  await st.fill('#userRules', start + 'phrase racism 3 nothing to see\n');
  await st.click('#revertUser');
  check('My rules: Revert restores saved text', /Elm Street/.test(await st.inputValue('#userRules')));
  await st.fill('#userRules', start);
  await st.focus('#userRules'); await st.keyboard.press('Control+s');
  check('My rules: Ctrl+S saves and clears errors', await until(async () => (await st.textContent('#userMsg')) === 'Applied.' && (await st.$$('#userErrs li')).length === 0, 2000), await st.textContent('#userMsg'));
  check('My rules: removed line unmutes page', await until(async () => !has(await masksIn(news, '#custom'), /Elm Street/), 2500));
  await st.reload();
  check('My rules: survives a reload', await until(async () => (await st.inputValue('#userRules')) === start, 2000));
  await st.close();
});

group('import', async () => {
  const st = await open(`chrome-extension://${extId}/ui/settings.html#packs`, 'settings#packs');
  const file = path.join(TMP, 'pineapple.txt');
  fs.writeFileSync(file, '! Title: Pineapple test\n! Version: 7\nphrase racism 3 quantum pineapple theory\nnot a rule\n');
  await until(() => st.$('#listCards .item'), 2000);
  await st.setInputFiles('#importFile', file);
  const msg = await until(async () => { const v = await st.textContent('#addMsg'); return /Imported/.test(v) && v; }, 2500);
  check('import: confirms rules and skipped lines', /Pineapple test, 1 rule, 1 lines skipped/.test(msg || ''), msg);
  check('import: list card shown', await until(async () => /Pineapple test/.test(await st.textContent('#listCards')), 1500));
  check('import: page mutes the imported phrase', await until(async () => has(await masksIn(news, '#imported'), /quantum pineapple/), 2500));
  const card = st.locator('#listCards .item', { hasText: 'Pineapple test' });
  await card.locator('.switch').click();
  check('import: switching the list off unmutes', await until(async () => (await masksIn(news, '#imported')).length === 0, 2500));
  await card.locator('.switch').click();
  await until(async () => (await masksIn(news, '#imported')).length > 0, 2500);
  await st.setInputFiles('#importFile', file);
  const dup = await until(async () => (await bgEval(async () => (await chrome.storage.local.get('lists')).lists.filter(l => l.title === 'Pineapple test').length)), 1500);
  check('import: same file twice keeps one list', dup === 1, dup);
  const bad = path.join(TMP, 'bad.txt');
  fs.writeFileSync(bad, 'nothing usable here\n');
  await st.setInputFiles('#importFile', bad);
  check('import: file with no rules is refused', /No usable rules/.test(await until(async () => { const v = await st.textContent('#addMsg'); return /No usable/.test(v) && v; }, 2000) || ''));
  await st.fill('#listUrl', 'http://localhost:8810/list.txt');
  await st.click('#addUrl');
  check('subscribe: plain http address refused', /https:\/\//.test(await until(async () => { const v = await st.textContent('#addMsg'); return /https/.test(v) && v; }, 2000) || ''));
  await card.locator('button', { hasText: 'Remove' }).click();
  check('import: Remove deletes the list and unmutes', await until(async () => (await masksIn(news, '#imported')).length === 0 && !/Pineapple/.test(await st.textContent('#listCards')), 2500));
  await st.close();
});

group('image', async () => {
  await news.bringToFront();
  await news.$eval('#meme', e => e.scrollIntoView({ block: 'center' }));
  const m = await until(() => news.$$eval('.bnet-img-mask', x => x.length), 45000, 300);
  check('image: text in a picture covered (OCR on device)', m > 0, m);
  if (m) {
    const box = await news.$eval('.bnet-img-mask', e => { const r = e.getBoundingClientRect(), i = document.getElementById('meme').getBoundingClientRect(); return r.left >= i.left - 8 && r.right <= i.right + 8 && r.top >= i.top - 8 && r.bottom <= i.bottom + 8; });
    check('image: cover sits on the picture', box);
    await news.click('.bnet-img-mask');
    check('image: click reveals the cover', await news.$eval('.bnet-img-mask', e => e.classList.contains('bnet-open')));
    check('image: chip shown for image', !!(await news.$('bnet-chip')));
    await news.click('bnet-chip button[data-act="hide"]');
  }
  // X picture: reuse the on-device result for the localhost meme so no second OCR run is needed.
  const seeded = await bgEval(o => { const r = ocrCache.get(o + '/meme.jpg'); if (r) ocrCache.set('https://pbs.twimg.com/media/BNETTEST?format=jpg&name=small', r); return !!r; }, ORIGIN);
  check('image: OCR result cached in the worker', seeded);
});

group('x', async () => {
  xpage = await open('https://x.com/home', 'x.com/home');
  const m = await until(async () => { const v = await masks(xpage); return has(v, /dead immigrant/) && v; }, 5000);
  check('X: post muted', has(m || [], /scum of humanity/i), m);
  check('X: slur in post muted', has(m || [], /f4gg0t/), m);
  check('X: quote post muted', has(await masksIn(xpage, '.q'), /mentally ill/i), await xpage.$eval('.q', e => e.innerHTML.slice(0, 400)));
  check('X: post added later muted', has(m || [], /dead immigrant/), m);
  check('X: display name muted', has(await masksIn(xpage, '[data-testid="User-Name"]'), /k1ke/i), await masksIn(xpage, '[data-testid="User-Name"]'));
  check('X: kind post untouched', await xpage.$$eval('article', a => a.filter(x => /Refugees deserve support/.test(x.textContent) && x.querySelector('bnet-mask')).length === 0));
  // Needs the OCR result the image group leaves in the worker's cache.
  const seeded = await bgEval(() => ocrCache.has('https://pbs.twimg.com/media/BNETTEST?format=jpg&name=small'));
  const img = seeded && await until(() => xpage.$$eval('[data-testid="tweetPhoto"] .bnet-img-mask', x => x.length), 4000);
  if (seeded) check('X: picture in post covered', img > 0, img); else console.log('skip X: picture in post covered (run with the image group)');
  await settings({ surfaces: { names: false } });
  check('X: names switch off leaves names readable', await until(async () => (await masksIn(xpage, '[data-testid="User-Name"]')).length === 0 && (await masks(xpage)).length > 2, 2500));
  await settings({ surfaces: { names: true, images: false } });
  check('X: images switch off removes picture covers', await until(async () => (await xpage.$$('.bnet-img-mask')).length === 0, 2500));
  await settings({ surfaces: { images: true } });

  const x2 = await open('https://x.com/Panycirco1966', 'x.com/Panycirco1966');
  const m2 = await until(async () => { const v = await masks(x2); return v.length >= 2 && v; }, 4000);
  check('X 2026 layout: post muted', has(m2 || [], /scum of humanity/i), m2);
  check('X 2026 layout: bio muted', has(await masksIn(x2, '.mb-4'), /scum of humanity/i), await masksIn(x2, '.mb-4'));
  check('X 2026 layout: mention link intact', (await x2.$eval('a[href="/someone"]', a => a.textContent)) === '@someone');
  check('X 2026 layout: reply box untouched', (await x2.$$('[contenteditable] bnet-mask')).length === 0);
  const before = x2.url();
  await x2.click('[role="link"] bnet-mask');
  check('X 2026 layout: reveal does not open the post', x2.url() === before && await x2.$eval('[role="link"] bnet-mask', e => e.classList.contains('bnet-open')), x2.url());
  const lg = await until(() => bgEval(async () => ((await chrome.storage.local.get('log')).log || []).filter(x => x.kind === 'hit' && /\/status\//.test(x.url)).length), 3000);
  check('X 2026 layout: log keeps the post link', lg > 0, lg);
  await x2.close();
});

group('badge', async () => {
  const c = await open(ORIGIN + '/clean.html', 'clean.html');
  const nt = await tabFor(ORIGIN + '/news.html'), ct = await tabFor(ORIGIN + '/clean.html'), xt = await tabFor('https://x.com/home');
  await sleep(600);
  const [bn, bc, bx] = [await badgeOf(nt.id), await badgeOf(ct.id), await badgeOf(xt.id)];
  const sn = await statusOf(nt.id), sx = await statusOf(xt.id);
  check('badge: clean tab shows nothing', bc === '', bc);
  check('badge: news tab shows its own count', Number(bn) > 0, bn);
  check('badge: X tab shows its own count', Number(bx) > 0 && bx !== bn, [bn, bx]);
  check('badge: news count matches phrases muted on the page', Number(bn) === sn.muted, { badge: bn, status: sn.muted });
  check('badge: X count matches phrases muted on the page', Number(bx) === sx.muted, { badge: bx, status: sx.muted });
  await settings({ badge: false });
  await news.evaluate(() => document.getElementById('p2').append(' extra text'));
  check('badge: switch off clears the number', await until(async () => (await badgeOf(nt.id)) === '', 2000), await badgeOf(nt.id));
  await settings({ badge: true });
  await c.close();
});

group('settings', async () => {
  const st = await open(`chrome-extension://${extId}/ui/settings.html`, 'settings');
  for (const v of ['overview', 'filtering', 'look', 'where', 'packs', 'learning', 'history', 'allow', 'about']) {
    await st.goto(`chrome-extension://${extId}/ui/settings.html#${v}`);
    await st.reload();
    const on = await until(() => st.$eval('#v-' + v, e => e.classList.contains('on')), 1500);
    check('settings: ' + v + ' view opens', on);
  }
  await st.goto(`chrome-extension://${extId}/ui/settings.html#overview`); await st.reload();
  check('settings: overview counts today', await until(async () => Number(await st.textContent('#sToday')) > 0, 2000), await st.textContent('#sToday'));
  await st.goto(`chrome-extension://${extId}/ui/settings.html#history`);
  check('settings: history lists entries', await until(async () => (await st.$$('#hBody tr')).length > 0, 2000));
  check('settings: history hides phrases until hover', await st.$$eval('#hBody .ph span', s => s.every(x => x.classList.contains('hide-til-hover'))));
  check('settings: version shown', (await st.textContent('#ver')) === JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'))).version);
  // Round trips: change in the page, read storage, reload, see the same state.
  await st.goto(`chrome-extension://${extId}/ui/settings.html#filtering`);
  await st.click('#v-filtering [data-key="dial"] button[data-v="1"]');
  await st.click('#v-filtering [data-key="scope"] button[data-v="sentence"]');
  await st.locator('#cats .item', { hasText: 'Political hostility' }).locator('.switch').click();
  await st.locator('#cats .item').filter({ has: st.locator('b', { hasText: /^Slurs$/ }) }).locator('select').selectOption('bleep');
  await sleep(300);
  const s1 = await bgEval(async () => (await chrome.storage.local.get('settings')).settings);
  check('settings round trip: saved to storage', s1.dial === 1 && s1.scope === 'sentence' && s1.categories.political === true && s1.perCategory.slurs === 'bleep', { dial: s1.dial, scope: s1.scope, political: s1.categories.political, slurs: s1.perCategory.slurs });
  await st.reload();
  const ui = await st.evaluate(() => ({
    dial: document.querySelector('#v-filtering [data-key="dial"] [aria-pressed="true"]')?.dataset.v,
    scope: document.querySelector('#v-filtering [data-key="scope"] [aria-pressed="true"]')?.dataset.v,
    political: [...document.querySelectorAll('#cats .item')].find(i => /Political/.test(i.textContent)).querySelector('input').checked,
    slurs: [...document.querySelectorAll('#cats .item')].find(i => /^Slurs/.test(i.textContent)).querySelector('select').value
  }));
  check('settings round trip: shown again after reload', ui.dial === '1' && ui.scope === 'sentence' && ui.political && ui.slurs === 'bleep', ui);
  await st.goto(`chrome-extension://${extId}/ui/settings.html#where`);
  await st.locator('[data-surface="web"]').evaluate(e => e.closest('label').click());
  check('settings: "page text" switch off unmutes generic pages', await until(async () => (await masks(news)).length === 0, 2500));
  await st.reload();
  check('settings: surface switch survives reload', !(await st.$eval('[data-surface="web"]', e => e.checked)));
  await resetSettings();
  await st.goto(`chrome-extension://${extId}/ui/settings.html#learning`);
  check('settings: learning log size shown', /\d+ entr/.test(await until(() => st.textContent('#logSize'), 1500) || ''));
  await st.close();
});

group('console', async () => {
  const ext = consoleErrors.filter(([w]) => /settings|popup/.test(w));
  const pages = consoleErrors.filter(([w]) => !/settings|popup/.test(w));
  check('no console errors on settings and popup', ext.length === 0, ext.slice(0, 5));
  check('no console errors on mock pages', pages.length === 0, pages.slice(0, 5));
});

/* ---------- run ---------- */
(async () => {
  let srv;
  try { srv = await serve(); } catch (e) { console.log('FAIL could not start server on port ' + PORT + ': ' + e.message); process.exit(1); }
  ctx = await chromium.launchPersistentContext(path.join(TMP, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 1000 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  await ctx.route('https://x.com/**', r => {
    const u = new URL(r.request().url());
    r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(PAGES, u.pathname === '/home' ? 'x.html' : 'x2.html'), 'utf8') });
  });
  await ctx.route('https://pbs.twimg.com/**', r => r.fulfill({ contentType: 'image/jpeg', body: fs.readFileSync(path.join(PAGES, 'meme.jpg')) }));
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  extId = sw.url().split('/')[2];
  for (const [name, fn] of groups) {
    if (ONLY.length && !ONLY.some(w => name.includes(w)) && !['boot', 'news'].includes(name)) continue;
    console.log('-- ' + name);
    try { await fn(); } catch (e) { check(name + ': ran to the end', false, e.message.split('\n')[0]); }
  }
  await ctx.close().catch(() => {});
  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)}s`);
  if (failed) console.log('failed: ' + failures.join('; '));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

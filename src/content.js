/* BNet content script for X. Finds hateful phrases in posts, quotes, names, bios and image text,
 * and mutes only the offending words. Click a muted phrase to show it. */
(() => {
  'use strict';
  // An older copy (from before BNet was reloaded) shuts itself down; a live copy is never doubled.
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  if (window.__bnetLoaded && window.__bnetAlive && window.__bnetAlive()) return;
  if (window.__bnetStop) { try { window.__bnetStop(); } catch (e) {} }
  window.__bnetLoaded = true;
  window.__bnetAlive = alive;

  const E = globalThis.BNetEngine, T = globalThis.BNetTreatments, D = globalThis.BNetDefaults;

  let settings = D.DEFAULTS;
  let compiled = null;
  let allowSet = new Set();
  let active = false;
  let version = 0;
  let resumeTimer = null;
  const revealed = new Set();
  const spanInfo = new Map();

  // X's 2026 rebuild dropped data-testid; the old selectors stay as a fallback for the classic layout.
  const SEL = {
    posts: '[data-testid="tweetText"], [data-testid="card.layoutLarge.detail"], [data-testid="card.layoutSmall.detail"], [data-testid="trend"], [dir="auto"]',
    names: '[data-testid="User-Name"], [data-testid="UserName"], a[href^="/"]:not([href*="/status/"]):not([href^="/i/"]):not([href^="/compose"]):not([href^="/hashtag"]):not([href^="/search"]), [class*="text-headline"]',
    bios: '[data-testid="UserDescription"]',
    images: '[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media/"]'
  };
  const ALL_TEXT = [SEL.posts, SEL.names, SEL.bios].join(', ');
  const EDITABLE = '[contenteditable="true"], [contenteditable=""], textarea, input, [role="textbox"], bnet-chip';

  // Find the text block a node belongs to without relying on X's markup: known selectors first,
  // otherwise the nearest non-inline ancestor. Grow to an enclosing block only while it stays small
  // and holds no editor, media or other post.
  const disp = new WeakMap();
  function isInline(e) {
    let d = disp.get(e);
    if (d === undefined) { d = getComputedStyle(e).display; disp.set(e, d); }
    return d === 'inline' || d === 'contents';
  }
  function smallBlock(e) {
    if (!e || e === document.body || e === document.documentElement || e.localName === 'main' || e.localName === 'article') return false;
    if (e.querySelector('article, [contenteditable="true"], textarea, input, [role="textbox"], img[src*="pbs.twimg.com/media/"]')) return false;
    return (e.textContent || '').length < 2500;
  }
  function blockAncestor(el) {
    let e = el;
    while (e && e !== document.body && isInline(e)) e = e.parentElement;
    return e;
  }
  function hostOf(node) {
    const el = node && (node.nodeType === 3 ? node.parentElement : node);
    if (!el || !el.closest) return null;
    if (el.closest(EDITABLE) || el.closest('bnet-mask, bnet-chip, .bnet-img, script, style, noscript, svg')) return null;
    let h = el.closest(ALL_TEXT);
    if (!h || !smallBlock(h)) h = blockAncestor(el);
    if (!smallBlock(h)) return null;
    for (;;) {
      const up = h.parentElement && h.parentElement.closest(ALL_TEXT);
      if (!up || !smallBlock(up)) break;
      h = up;
    }
    return h;
  }
  function textNodesIn(root, cb) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.nodeValue && n.nodeValue.trim().length > 1) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) cb(n);
  }

  /* ---------- settings + packs ---------- */
  let askedForLists = false;
  async function loadAll() {
    const st = await chrome.storage.local.get(['settings', 'lists', 'allow']);
    settings = D.merge(D.DEFAULTS, st.settings || {});
    const lists = st.lists || [];
    if (!lists.length && !askedForLists) { askedForLists = true; send({ type: 'lists:ensure' }); }
    const packs = lists.filter(l => l.enabled !== false && l.data).map(l => l.data);
    compiled = E.compile(packs);
    allowSet = new Set((st.allow || []).map(a => a.key));
    active = D.store.isActive(settings);

    clearTimeout(resumeTimer);
    if (settings.enabled && settings.pausedUntil > Date.now()) {
      resumeTimer = setTimeout(loadAll, Math.min(settings.pausedUntil - Date.now() + 250, 2 ** 31 - 1));
    }
    version++;
    rescanAll();
    pageCount();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.lists || changes.allow) loadAll();
  });

  /* ---------- text helpers ---------- */
  function isQuote(el) {
    const art = el.closest('article');
    if (!art) return false;
    const q = el.closest('div[role="link"]');
    return !!q && art.contains(q) && q !== art;
  }
  function surfaceOf(el) {
    if (el.matches(SEL.bios)) return 'bio';
    if (el.matches(SEL.names) && !el.matches('[data-testid="tweetText"], [dir="auto"]')) return 'name';
    if (!el.closest('article') && el.closest('main') && el.matches('[dir="auto"]')) return 'bio';
    return isQuote(el) ? 'quote' : 'post';
  }
  function surfaceOn(src) {
    const s = settings.surfaces;
    return ({ post: s.posts, quote: s.quotes, name: s.names, bio: s.bios, image: s.images })[src] !== false;
  }
  function enabledCats() { return E.CAT_IDS.filter(c => settings.categories[c]); }
  function minSev() { return E.SEV_FOR_DIAL[settings.dial] || 2; }

  function origText(el) {
    let out = '';
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          if (c.localName === 'bnet-mask') out += c.dataset.o || '';
          else walk(c);
        }
      }
    })(el);
    return out;
  }

  function findSpans(text) {
    let spans = E.scan(compiled, text, { minSev: minSev(), enabled: enabledCats() });
    spans = spans.filter(sp => !allowSet.has(E.normKey(sp.text)));
    if (settings.scope === 'sentence' && spans.length) {
      const ex = spans.map(sp => E.expandToSentence(text, sp)).sort((a, b) => a.start - b.start);
      const merged = [];
      for (const sp of ex) {
        const last = merged[merged.length - 1];
        if (last && sp.start < last.end) {
          last.end = Math.max(last.end, sp.end); last.text = text.slice(last.start, last.end);
          last.cats = [...new Set(last.cats.concat(sp.cats))]; last.sev = Math.max(last.sev, sp.sev);
        } else merged.push({ ...sp });
      }
      spans = merged;
    }
    return spans;
  }

  function treatmentFor(cat, seed) {
    const per = settings.perCategory && settings.perCategory[cat];
    const id = per && per !== 'default' ? per : settings.treatment;
    return T.resolve(id, seed);
  }

  /* ---------- masking ---------- */
  function makeMask(orig, sp, first) {
    const m = document.createElement('bnet-mask');
    const tid = treatmentFor(sp.primary, sp.key);
    m.dataset.o = orig;
    m.dataset.key = sp.key;
    m.dataset.cat = sp.primary;
    m.className = 'bnet-t-' + tid + (revealed.has(sp.key) ? ' bnet-open' : '') + (first ? '' : ' bnet-cont');
    m.setAttribute('role', 'button');
    m.setAttribute('tabindex', first ? '0' : '-1');
    m.setAttribute('aria-label', 'Muted by BNet. Activate to show.');
    if (first && settings.reveal) m.title = 'Muted by BNet \u00B7 click to show';
    const bo = document.createElement('span');
    bo.className = 'bnet-o';
    bo.textContent = orig;
    const ba = document.createElement('span');
    ba.className = 'bnet-a';
    ba.textContent = first ? T.render(tid, sp, sp.key).text : '';
    m.append(bo, ba);
    return m;
  }

  function maskSegment(node, a, b, sp, first) {
    if (b < node.nodeValue.length) { const tail = node.splitText(b); tail.__bnetSplit = true; }
    const mid = node.splitText(a); // a may be 0: the original node stays, empty, so X keeps its reference
    mid.__bnetSplit = true;
    mid.parentNode.replaceChild(makeMask(mid.nodeValue, sp, first), mid);
  }

  function wrap(el, spans) {
    const nodes = [];
    let pos = 0;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const len = n.nodeValue.length;
      nodes.push({ n, s: pos, e: pos + len });
      pos += len;
    }
    for (let k = nodes.length - 1; k >= 0; k--) {
      const { n, s, e } = nodes[k];
      const segs = spans
        .filter(sp => sp.start < e && sp.end > s)
        .map(sp => ({ sp, a: Math.max(sp.start, s) - s, b: Math.min(sp.end, e) - s, first: sp.start >= s && sp.start < e }))
        .filter(g => g.b > g.a && n.nodeValue.slice(g.a, g.b).trim())
        .sort((x, y) => y.a - x.a);
      for (const g of segs) maskSegment(n, g.a, g.b, g.sp, g.first);
    }
  }

  function restore(el) {
    const masks = el.querySelectorAll('bnet-mask');
    if (!masks.length) return;
    const parents = new Set();
    masks.forEach(m => {
      const t = document.createTextNode(m.dataset.o || '');
      t.__bnetSplit = true;
      parents.add(m.parentNode);
      m.parentNode.replaceChild(t, m);
    });
    parents.forEach(p => {
      if (!p) return;
      let c = p.firstChild;
      while (c) {
        const next = c.nextSibling;
        if (c.nodeType === 3 && c.__bnetSplit && c.previousSibling && c.previousSibling.nodeType === 3) {
          c.previousSibling.nodeValue += c.nodeValue;
          c.remove();
        }
        c = next;
      }
    });
  }

  function permalink(el) {
    if (!el.closest) return location.href;
    const wrap = el.closest('[data-href*="/status/"]');
    if (wrap) return new URL(wrap.getAttribute('data-href'), location.origin).href;
    const art = el.closest('article');
    const a = art && (art.querySelector('a[href*="/status/"] time') ? art.querySelector('a[href*="/status/"] time').parentElement : art.querySelector('a[href*="/status/"]'));
    return a ? a.href : location.href;
  }

  let scannedCount = 0;
  function processText(el) {
    if (!el.isConnected) return;
    const text = origText(el);
    const sig = text + '\u0000' + version;
    // Same text, same masks: nothing to do. If X re-rendered and wiped our masks, redo them.
    if (el.__bnetSig === sig && el.querySelectorAll('bnet-mask').length === (el.__bnetMasks || 0)) return;
    el.__bnetSig = sig;
    el.__bnetMasks = 0;
    scannedCount++;
    try { restore(el); } catch (e) { /* X re-rendered under us */ }
    const src = surfaceOf(el);
    if (!active || !compiled || !surfaceOn(src) || text.trim().length < 2) return;
    const spans = findSpans(text);
    if (!spans.length) return;
    const th = T.hash(text).toString(36);
    const bare = text.replace(/\s+/g, ' ').trim().length;
    for (const sp of spans) {
      sp.whole = sp.text.length >= bare * 0.8;
      sp.key = E.normKey(sp.text) + '|' + th;
      spanInfo.set(sp.key, { span: sp.text, cats: sp.cats, cat: sp.primary, rule: sp.rule, sev: sp.sev, src, ctx: text.slice(0, 600), url: permalink(el) });
    }
    try { wrap(el, spans); } catch (e) { try { restore(el); } catch (_) {} return; }
    el.__bnetMasks = el.querySelectorAll('bnet-mask').length;
    report(spans.map(sp => sp.key));
  }

  /* ---------- reporting (batched) ---------- */
  let outbox = [];
  let outTimer = null;
  // Toolbar number: phrases muted on this page (resets when the address changes).
  let pageUrl = location.href;
  const pageKeys = new Set();
  let countTimer = null;
  function pageCount() {
    if (location.href !== pageUrl) { pageUrl = location.href; pageKeys.clear(); }
    clearTimeout(countTimer);
    countTimer = setTimeout(() => send({ type: 'pageCount', n: active ? pageKeys.size : -1 }), 250);
  }
  function report(keys) {
    for (const k of keys) pageKeys.add(k.replace(/\|[^|]*$/, ''));
    pageCount();
    for (const k of keys) {
      const i = spanInfo.get(k);
      if (!i) continue;
      outbox.push({ key: k, span: i.span, cats: i.cats, cat: i.cat, rule: i.rule, sev: i.sev, src: i.src, ctx: settings.learn ? i.ctx : '', url: i.url });
    }
    if (!outTimer) outTimer = setTimeout(flushOutbox, 900);
  }
  function flushOutbox() {
    outTimer = null;
    if (!outbox.length) return;
    const items = outbox; outbox = [];
    send({ type: 'hits', items });
  }
  function send(msg) {
    try { return chrome.runtime.sendMessage(msg).catch(() => null); } catch (e) { return Promise.resolve(null); }
  }

  /* ---------- images ---------- */
  const imgIO = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      imgIO.unobserve(en.target);
      ocrImage(en.target);
    }
  }, { rootMargin: '400px 0px' });

  function watchImg(img) {
    if (img.__bnetWatched) { if (img.__bnetOcr) applyImageMasks(img); return; }
    if (!active || !settings.surfaces.images) return;
    img.__bnetWatched = true;
    imgIO.observe(img);
  }

  function ocrUrl(src) {
    try {
      const u = new URL(src);
      if (!/(^|\.)pbs\.twimg\.com$/.test(u.hostname) || !u.pathname.startsWith('/media/')) return null;
      u.searchParams.set('name', 'small');
      if (!u.searchParams.get('format')) u.searchParams.set('format', 'jpg');
      return u.href;
    } catch (e) { return null; }
  }

  async function ocrImage(img) {
    const url = ocrUrl(img.currentSrc || img.src);
    if (!url) return;
    const res = await send({ type: 'ocr', url });
    if (!res || !res.ok || !img.isConnected) return;
    img.__bnetOcr = res;
    applyImageMasks(img);
  }

  const boxRO = new ResizeObserver(entries => {
    for (const en of entries) { const img = en.target.__bnetImg; if (img) applyImageMasks(img, true); }
  });

  function applyImageMasks(img, fromResize) {
    const res = img.__bnetOcr;
    const box = img.closest('[data-testid="tweetPhoto"]') || img.parentElement;
    if (!res || !box) return;
    box.querySelectorAll(':scope > .bnet-img').forEach(n => n.remove());
    if (!active || !settings.surfaces.images || !compiled || !res.words.length) return;

    let text = '';
    const pos = [];
    let lastLine = -1;
    for (const w of res.words) {
      if (text) text += (w.line !== lastLine ? ' ' : ' ');
      pos.push({ s: text.length, e: text.length + w.text.length, w });
      text += w.text;
      lastLine = w.line;
    }
    const spans = findSpans(text);
    if (!spans.length) return;

    const th = T.hash(res.url || text).toString(36);
    const cw = box.clientWidth, ch = box.clientHeight;
    if (!cw || !ch) return;
    const br = box.getBoundingClientRect(), ir = img.getBoundingClientRect();
    const visible = parseFloat(getComputedStyle(img).opacity) > 0.05 && ir.width > 4;
    const ox = visible ? ir.left - br.left : 0, oy = visible ? ir.top - br.top : 0;
    const iw = visible ? ir.width : cw, ih = visible ? ir.height : ch;
    const fit = visible ? getComputedStyle(img).objectFit : 'cover';
    let sx, sy;
    if (fit === 'contain' || fit === 'scale-down') sx = sy = Math.min(iw / res.w, ih / res.h);
    else if (fit === 'fill') { sx = iw / res.w; sy = ih / res.h; }
    else sx = sy = Math.max(iw / res.w, ih / res.h);
    const dx = ox + (iw - res.w * sx) / 2, dy = oy + (ih - res.h * sy) / 2;

    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const layer = document.createElement('div');
    layer.className = 'bnet-img';
    const keys = [];
    for (const sp of spans) {
      const key = 'img:' + E.normKey(sp.text) + '|' + th;
      keys.push(key);
      if (!fromResize) spanInfo.set(key, { span: sp.text, cats: sp.cats, cat: sp.primary, rule: sp.rule, sev: sp.sev, src: 'image', ctx: text.slice(0, 600), url: permalink(img) });
      const tid = treatmentFor(sp.primary, key);
      const visual = ['veil', 'grain', 'redact'].includes(tid) ? tid : 'frost';
      const lines = new Map();
      for (const p of pos) {
        if (p.s < sp.end && p.e > sp.start) {
          const b = p.w.b;
          const cur = lines.get(p.w.line);
          lines.set(p.w.line, cur ? [Math.min(cur[0], b[0]), Math.min(cur[1], b[1]), Math.max(cur[2], b[2]), Math.max(cur[3], b[3])] : b.slice());
        }
      }
      for (const b of lines.values()) {
        const pad = Math.max(4, (b[3] - b[1]) * 0.22);
        const x = (b[0] - pad) * sx + dx, y = (b[1] - pad) * sy + dy;
        const w = (b[2] - b[0] + pad * 2) * sx, h = (b[3] - b[1] + pad * 2) * sy;
        const m = document.createElement('div');
        m.className = 'bnet-img-mask bnet-it-' + visual + (revealed.has(key) ? ' bnet-open' : '');
        m.dataset.key = key;
        m.title = settings.reveal ? 'Muted by BNet · click to show' : 'Muted by BNet';
        m.style.left = (x / cw * 100) + '%';
        m.style.top = (y / ch * 100) + '%';
        m.style.width = (w / cw * 100) + '%';
        m.style.height = (h / ch * 100) + '%';
        if (visual === 'frost' || visual === 'grain') {
          // Our own blurred copy of this patch of the picture: does not depend on backdrop-filter support.
          const src = img.currentSrc || img.src;
          const patch = document.createElement('i');
          patch.className = 'bnet-patch';
          patch.style.backgroundImage = 'url("' + src.replace(/"/g, '%22') + '")';
          patch.style.width = (res.w * sx) + 'px';
          patch.style.height = (res.h * sy) + 'px';
          patch.style.left = (dx - x) + 'px';
          patch.style.top = (dy - y) + 'px';
          m.appendChild(patch);
        }
        layer.appendChild(m);
      }
    }
    box.appendChild(layer);
    if (!box.__bnetImg) { box.__bnetImg = img; boxRO.observe(box); }
    if (!fromResize && !img.__bnetReported) { img.__bnetReported = true; report(keys); }
  }

  /* ---------- reveal + chip ---------- */
  let chip = null;
  function hideChip() { if (chip) { chip.remove(); chip = null; } }
  function setOpen(key, open) {
    if (open) revealed.add(key); else revealed.delete(key);
    document.querySelectorAll('[data-key]').forEach(n => {
      if (n.dataset.key === key) n.classList.toggle('bnet-open', open);
    });
  }
  function showChip(target, key) {
    hideChip();
    const r = target.getBoundingClientRect();
    chip = document.createElement('bnet-chip');
    chip.innerHTML = '<span class="bnet-dot"></span><button data-act="hide">Hide again</button><button data-act="ok">Not hateful</button>';
    document.documentElement.appendChild(chip);
    const cw = chip.offsetWidth || 220, chh = chip.offsetHeight || 34;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), innerWidth - cw - 8);
    let top = r.bottom + 8;
    if (top + chh > innerHeight - 8) top = r.top - chh - 8;
    chip.style.left = left + 'px';
    chip.style.top = top + 'px';
    chip.dataset.key = key;
  }

  function onActivate(e, el) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!settings.reveal) return;
    const key = el.dataset.key;
    if (revealed.has(key)) { setOpen(key, false); hideChip(); return; }
    setOpen(key, true);
    showChip(el, key);
    const i = spanInfo.get(key);
    if (i && settings.learn) send({ type: 'reveal', item: { key, span: i.span, cat: i.cat, rule: i.rule, src: i.src, url: i.url } });
  }

  function onChip(e) {
    const btn = e.target.closest('button');
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (!btn || !chip) return;
    const key = chip.dataset.key;
    if (btn.dataset.act === 'hide') { setOpen(key, false); hideChip(); return; }
    if (btn.dataset.act === 'ok') {
      const i = spanInfo.get(key) || {};
      revealed.delete(key);
      send({ type: 'notHateful', item: { key: E.normKey(i.span || ''), span: i.span, cats: i.cats, cat: i.cat, rule: i.rule, src: i.src, ctx: i.ctx, url: i.url } });
      chip.innerHTML = '<span class="bnet-dot"></span><span class="bnet-note">Thanks — BNet will leave this alone.</span>';
      setTimeout(hideChip, 1400);
    }
  }

  for (const type of ['click', 'auxclick']) {
    window.addEventListener(type, e => {
      if (!alive()) return;
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('bnet-chip')) { if (type === 'click') onChip(e); else { e.preventDefault(); e.stopPropagation(); } return; }
      const m = t.closest('bnet-mask, .bnet-img-mask');
      if (m) { if (type === 'click') onActivate(e, m); else { e.preventDefault(); e.stopPropagation(); } return; }
      hideChip();
    }, true);
  }
  for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
    window.addEventListener(type, e => {
      if (!alive()) return;
      const t = e.target;
      if (t && t.closest && (t.closest('bnet-chip') || t.closest('.bnet-img-mask'))) e.stopPropagation();
    }, true);
  }
  window.addEventListener('keydown', e => {
    if (!alive()) return;
    const m = e.target && e.target.closest && e.target.closest('bnet-mask');
    if (m && (e.key === 'Enter' || e.key === ' ')) onActivate(e, m);
    if (e.key === 'Escape') hideChip();
  }, true);
  window.addEventListener('scroll', () => { if (alive()) hideChip(); }, { passive: true, capture: true });

  /* ---------- scheduling ---------- */
  const pending = new Set();
  let scheduled = false;
  function queue(el) {
    el = hostOf(el);
    if (!el) return;
    pending.add(el);
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  }
  function flush() {
    scheduled = false;
    if (location.href !== pageUrl) pageCount();
    const els = [...pending];
    pending.clear();
    for (const el of els) {
      try { processText(el); } catch (e) { /* keep going */ }
    }
    mo.takeRecords();
  }

  function rescanAll() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', rescanAll, { once: true }); return; }
    document.querySelectorAll('bnet-mask').forEach(m => queue(m.parentElement));
    textNodesIn(document.body, queue);
    document.querySelectorAll(SEL.images).forEach(img => {
      if (img.__bnetOcr) applyImageMasks(img);
      else watchImg(img);
    });
    if (!active) hideChip();
  }

  const mo = new MutationObserver(recs => {
    if (!alive()) { mo.disconnect(); return; }
    for (const r of recs) {
      let t = r.target;
      if (t.nodeType === 3) t = t.parentElement;
      if (!t || !t.closest) continue;
      if (t.closest('bnet-mask, bnet-chip, .bnet-img')) continue;
      if (r.type === 'characterData' || r.type === 'childList') queue(t);
      if (r.type === 'attributes' && t.matches && t.matches(SEL.images)) { t.__bnetWatched = false; t.__bnetOcr = null; t.__bnetReported = false; watchImg(t); continue; }
      for (const n of r.addedNodes) {
        if (n.nodeType === 3) { queue(n); continue; }
        if (n.nodeType !== 1) continue;
        if (n.localName === 'bnet-mask' || n.localName === 'bnet-chip' || (n.classList && n.classList.contains('bnet-img'))) continue;
        textNodesIn(n, queue);
        if (n.matches(SEL.images)) watchImg(n);
        n.querySelectorAll(SEL.images).forEach(watchImg);
      }
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'toast') { showToast(msg.text); return; }
    if (!msg || msg.type !== 'status') return;
    const keys = new Set();
    document.querySelectorAll('bnet-mask[data-key], .bnet-img-mask[data-key]').forEach(n => keys.add(n.dataset.key));
    sendResponse({ ok: true, active, muted: keys.size, scanned: scannedCount, rules: compiled ? compiled.count : 0 });
  });

  let toastTimer = null;
  function showToast(text) {
    let t = document.querySelector('bnet-chip.bnet-toast');
    if (!t) { t = document.createElement('bnet-chip'); t.className = 'bnet-toast'; document.documentElement.appendChild(t); }
    t.innerHTML = '<span class="bnet-dot"></span><span class="bnet-note"></span>';
    t.querySelector('.bnet-note').textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2200);
    try { getSelection().removeAllRanges(); } catch (e) {}
  }

  window.__bnetStop = () => {
    mo.disconnect();
    document.querySelectorAll('bnet-mask').forEach(m => { const el = m.parentElement; if (el) { try { restore(el.closest('[dir]') || el); } catch (e) {} } });
    document.querySelectorAll('.bnet-img').forEach(n => n.remove());
    hideChip();
  };

  function start() {
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
    loadAll();
  }
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
})();

/* BNet content script. Runs on every site: finds hateful phrases in page text and image text,
 * and mutes only the offending words. X gets extra handling for posts, quotes, names and bios.
 * Click a muted phrase to show it. */
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
  let siteOff = false;
  let version = 0;
  let resumeTimer = null;
  const revealed = new Set();
  const spanInfo = new Map();

  // In a sub-frame the per-site switch follows the page the user is on (the top site); X handling follows
  // the frame's own host.
  const TOP = window.top === window;
  let SITE = location.hostname;
  try { if (!TOP && location.ancestorOrigins && location.ancestorOrigins.length) SITE = new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch (e) {}
  SITE = SITE.replace(/^www\./, '');
  const ON_X = /^(mobile\.)?(x|twitter)\.com$/.test(location.hostname.replace(/^www\./, ''));
  // Off X, each text block owns only the text that is not inside a nested block of its own.
  const OWN = !ON_X;
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'select', 'option', 'svg', 'math', 'iframe', 'canvas', 'video', 'audio', 'object']);
  // Subtrees the page walker never enters (X keeps its older, narrower list).
  const WALK_SKIP = ON_X ? new Set(['script', 'style', 'noscript', 'svg', 'textarea']) : SKIP;
  // Code editors draw their text in plain divs; editing those would corrupt the editor's own model.
  const EXCLUDE = 'bnet-mask, bnet-chip, .bnet-img, script, style, noscript, template, svg, select, option, pre, code, kbd, samp, .monaco-editor, .CodeMirror, .cm-editor, .ace_editor';
  const MAX_TEXT = 400000; // longer blocks are read in slices across frames, not skipped
  const CHUNK = 1500;

  // X's 2026 rebuild dropped data-testid; the old selectors stay as a fallback for the classic layout.
  const SEL = ON_X ? {
    posts: '[data-testid="tweetText"], [data-testid="card.layoutLarge.detail"], [data-testid="card.layoutSmall.detail"], [data-testid="trend"], [dir="auto"]',
    names: '[data-testid="User-Name"], [data-testid="UserName"], a[href^="/"]:not([href*="/status/"]):not([href^="/i/"]):not([href^="/compose"]):not([href^="/hashtag"]):not([href^="/search"]), [class*="text-headline"]',
    bios: '[data-testid="UserDescription"]',
    images: '[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media/"]'
  } : { posts: '', names: '', bios: '', images: 'img' };
  const ALL_TEXT = [SEL.posts, SEL.names, SEL.bios].filter(Boolean).join(', ');
  const EDITABLE = '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], textarea, input, [role="textbox"], bnet-chip';

  /* ---------- shadow roots ---------- */
  // Reddit, YouTube and other component sites draw comments inside shadow roots, which the page-wide
  // observer and stylesheet never reach. Each root we find gets its own observation and our styles.
  const roots = new Set();
  function shadowOf(el) {
    let sr = el.shadowRoot;
    if (!sr && el.localName.includes('-') && chrome.dom && chrome.dom.openOrClosedShadowRoot) {
      try { sr = chrome.dom.openOrClosedShadowRoot(el); } catch (e) { sr = null; }
    }
    return sr || null;
  }
  function deepContains(a, b) {
    for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true;
    return false;
  }
  function closestDeep(el, sel) {
    for (let e = el; e && e.closest;) {
      const m = e.closest(sel);
      if (m) return m;
      const r = e.getRootNode();
      e = r && r.host;
    }
    return null;
  }
  function forEachRoot(cb) {
    cb(document);
    for (const r of roots) { if (r.isConnected) cb(r); else if (roots.size > 400) roots.delete(r); }
  }
  function adoptRoot(sr) {
    roots.add(sr);
    if (sr.__bnetRoot) return;
    sr.__bnetRoot = true;
    try { mo.observe(sr, MO_OPTS); } catch (e) {}
    if (sr.mode === 'closed') listenOn(sr);
    walks.push({ root: sr });
    kick();
  }
  // Components that are not defined yet attach their root later; look again a few times.
  const lateHosts = new Map();
  let lateTimer = null;
  function watchLate(el) {
    if (lateHosts.has(el) || lateHosts.size > 2000) return;
    lateHosts.set(el, 0);
    if (!lateTimer) lateTimer = setTimeout(checkLate, 400);
  }
  function checkLate() {
    lateTimer = null;
    for (const [el, n] of lateHosts) {
      const sr = el.isConnected && shadowOf(el);
      if (sr) { lateHosts.delete(el); adoptRoot(sr); } else if (!el.isConnected || n >= 7) lateHosts.delete(el); else lateHosts.set(el, n + 1);
    }
    if (lateHosts.size) lateTimer = setTimeout(checkLate, 1200);
  }
  // Content-script CSS does not apply inside shadow roots, so those get a copy of ours.
  const FALLBACK_CSS = 'bnet-mask{display:inline;cursor:pointer;border-radius:.4em;padding:.04em .2em;background:rgba(74,120,238,.22)}' +
    'bnet-mask .bnet-o{display:none}bnet-mask .bnet-a{display:inline}bnet-mask.bnet-cont:not(.bnet-open){display:none}' +
    'bnet-mask.bnet-open .bnet-o{display:inline}bnet-mask.bnet-open .bnet-a{display:none}' +
    '.bnet-img{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden}.bnet-img-mask{position:absolute;pointer-events:auto;cursor:pointer;background:rgba(14,15,20,.94)}' +
    '.bnet-img-mask.bnet-open{background:transparent}.bnet-patch{display:none}' +
    '::highlight(bnet-hold){color:transparent;background-color:rgba(74,120,238,.3);text-shadow:none;text-decoration:none}';
  let sheet = null;
  function styleRoot(sr) {
    if (!sr || sr.nodeType !== 11) return;
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(FALLBACK_CSS);
        // The full styles come from the service worker: exposing content.css to web pages would let any site
        // detect BNet. Until they arrive, the fallback keeps words hidden.
        send({ type: 'css' }).then(t => { if (typeof t === 'string' && t) sheet.replaceSync(t); }).catch(() => {});
      }
      if (!sr.adoptedStyleSheets.includes(sheet)) sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
    } catch (e) {}
  }

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
    if (!e || !e.localName || e === document.body || e === document.documentElement || e.localName === 'main' || e.localName === 'article') return false;
    if (e.querySelector('article, [contenteditable="true"], textarea, input, [role="textbox"], img[src*="pbs.twimg.com/media/"]')) return false;
    return (e.textContent || '').length < 2500;
  }
  // The nearest non-inline ancestor; at the top of a shadow tree the root itself owns its loose text.
  function blockAncestor(el) {
    let e = el;
    while (e && e !== document.body && isInline(e)) {
      if (!e.parentElement) { const r = e.parentNode; return r && r.nodeType === 11 ? r : e; }
      e = e.parentElement;
    }
    return e;
  }
  // Never touch anything the user can type into: inputs, contenteditable (any kind, inherited too),
  // designMode documents, code editors.
  function editable(el) { return document.designMode === 'on' || el.isContentEditable; }
  function hostOf(node) {
    if (!node) return null;
    if (node.nodeType === 11) return OWN && node.host && !editable(node.host) && !closestDeep(node.host, EXCLUDE) ? node : null;
    const el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || !el.closest) {
      const p = node.nodeType === 3 && node.parentNode;
      return p && p.nodeType === 11 ? hostOf(p) : null;
    }
    if (editable(el)) return null;
    if (OWN) {
      if (closestDeep(el, EDITABLE) || closestDeep(el, EXCLUDE)) return null;
      const b = blockAncestor(el);
      return b && b !== document.documentElement ? b : null;
    }
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

  /* ---------- settings + packs ---------- */
  const WARM = ['ok', 'user1 12 points', 'Great game last night, see you at 5pm.', 'Honestly immigrants are vermin and they should all be deported.'];
  let askedForLists = false;
  let packsSig = null, building = null, loadSeq = 0, waitedFor = null, waitTimer = null;
  async function build(packs) {
    const c = E.compile(packs);
    // The engine does much of its setup lazily on the first few scans (hundreds of ms). Pay that now, one
    // short task at a time, instead of inside a frame while the user scrolls.
    // Big shared regexes first, one per task, then a few full scans for the rest.
    for (const step of (E.warmSteps ? E.warmSteps(c) : [])) { await new Promise(r => setTimeout(r, 0)); try { step(); } catch (e) {} }
    for (const w of WARM) { await new Promise(r => setTimeout(r, 0)); try { E.scan(c, w, { minSev: 1, enabled: E.CAT_IDS }); } catch (e) {} }
    return c;
  }
  async function loadAll() {
    const seq = ++loadSeq;
    // Small keys first. The rule data itself (several hundred KB) is read only when the lists really changed,
    // so a settings change or "Not hateful" click costs every open frame almost nothing.
    const st = await chrome.storage.local.get(['settings', 'allow', 'listsSig', 'preparedSig']);
    const sig = typeof st.listsSig === 'string' ? st.listsSig : null;
    if (!sig || sig !== packsSig || !building) {
      const ready = sig && st.preparedSig === sig;
      const big = await chrome.storage.local.get(ready ? ['prepared'] : ['lists', 'prepared']);
      const usePrepared = ready && big.prepared && big.prepared.bnetPrepared === E.PREPARED;
      if (usePrepared) { packsSig = sig; building = build(big.prepared); }
      else {
        const lists = Array.isArray(big.lists) ? big.lists.filter(l => l && typeof l === 'object') : [];
        if (!lists.length && !askedForLists) { askedForLists = true; send({ type: 'lists:ensure' }); }
        // Lists just changed and the service worker is still preparing them: keep the current rules for a
        // moment instead of every open tab compiling from scratch, then fall back if nothing arrives.
        if (compiled && sig && waitedFor !== sig) { waitedFor = sig; clearTimeout(waitTimer); waitTimer = setTimeout(loadAll, 1500); return; }
        packsSig = sig || ('raw:' + Date.now());
        building = build(lists.filter(l => l.enabled !== false && l.data).map(l => l.data));
      }
    }
    const c = await building;
    if (seq !== loadSeq) return; // a newer load is under way
    compiled = c;
    settings = D.merge(D.DEFAULTS, st.settings && typeof st.settings === 'object' && !Array.isArray(st.settings) ? st.settings : {});
    for (const k of ['surfaces', 'categories', 'perCategory']) if (!settings[k] || typeof settings[k] !== 'object') settings[k] = D.DEFAULTS[k];
    allowSet = new Set((Array.isArray(st.allow) ? st.allow : []).map(a => a && a.key).filter(Boolean));
    siteOff = Array.isArray(settings.offSites) && settings.offSites.includes(SITE);
    active = D.store.isActive(settings) && !siteOff;

    clearTimeout(resumeTimer);
    if (settings.enabled && settings.pausedUntil > Date.now()) {
      resumeTimer = setTimeout(loadAll, Math.min(settings.pausedUntil - Date.now() + 250, 2 ** 31 - 1));
    }
    version++;
    rescanAll();
    pageCount(true);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !alive()) return;
    if (changes.settings || changes.listsSig || changes.allow || changes.preparedSig) loadAll();
  });

  /* ---------- text helpers ---------- */
  function isQuote(el) {
    const art = el.closest('article');
    if (!art) return false;
    const q = el.closest('div[role="link"]');
    return !!q && art.contains(q) && q !== art;
  }
  function surfaceOf(el) {
    if (!ON_X || !el.matches) return 'web';
    if (el.matches(SEL.bios)) return 'bio';
    if (el.matches(SEL.names) && !el.matches('[data-testid="tweetText"], [dir="auto"]')) return 'name';
    if (!el.closest('article') && el.closest('main') && el.matches('[dir="auto"]')) return 'bio';
    return isQuote(el) ? 'quote' : 'post';
  }
  function surfaceOn(src) {
    const s = settings.surfaces;
    return ({ post: s.posts, quote: s.quotes, name: s.names, bio: s.bios, image: s.images, web: s.web })[src] !== false;
  }
  function enabledCats() { return E.CAT_IDS.filter(c => settings.categories[c]); }
  function minSev() { return E.SEV_FOR_DIAL[settings.dial] || 2; }

  // Walk the text a block owns, in order. Masks count as their original words.
  // On X a fallback host (a plain container, not post text) leaves the post and name blocks inside it to
  // their own hosts; otherwise it overlapped them and rewriting it stripped a quote post's mask.
  function ownWalk(host, onText, onMask) {
    const nested = !OWN && host.matches && !host.matches(ALL_TEXT);
    (function walk(n) {
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) onText(c);
        else if (c.nodeType === 1) {
          if (c.localName === 'bnet-mask') { if (onMask) onMask(c); continue; }
          if (OWN && (SKIP.has(c.localName) || c.localName === 'bnet-chip' || !isInline(c))) continue;
          if (nested && c.matches(ALL_TEXT)) continue;
          walk(c);
        }
      }
    })(host);
  }
  function origText(el) {
    let out = '';
    ownWalk(el, n => { out += n.nodeValue; }, m => { out += m.dataset.o || ''; });
    return out;
  }
  function ownMasks(el) {
    const out = [];
    ownWalk(el, () => {}, m => out.push(m));
    return out;
  }
  // Where the masked phrases sit in the block's text right now.
  function maskLayout(el) {
    const out = [];
    let pos = 0, cur = null;
    ownWalk(el, n => { pos += n.nodeValue.length; }, m => {
      const len = (m.dataset.o || '').length;
      if (!cur || !m.classList.contains('bnet-cont') || cur.key !== m.dataset.key) { cur = { start: pos, end: pos + len, key: m.dataset.key || '' }; out.push(cur); }
      else cur.end = pos + len;
      pos += len;
    });
    return out;
  }
  const nkOf = key => key.slice(0, key.lastIndexOf('|'));
  function sameLayout(el, spans) {
    const lay = maskLayout(el);
    if (lay.length !== spans.length) return false;
    for (let i = 0; i < lay.length; i++) {
      const a = lay[i], b = spans[i];
      if (a.start !== b.start || a.end !== b.end || nkOf(a.key) !== E.normKey(b.text)) return false;
    }
    return true;
  }

  function rawSpans(text) {
    return E.scan(compiled, text, { minSev: minSev(), enabled: enabledCats() }).filter(sp => !allowSet.has(E.normKey(sp.text)));
  }
  function mergeSpans(text, list) {
    const merged = [];
    for (const sp of list.sort((a, b) => a.start - b.start || b.end - a.end)) {
      const last = merged[merged.length - 1];
      if (last && sp.start < last.end) {
        if (sp.end > last.end) { last.end = sp.end; last.text = text.slice(last.start, last.end); }
        last.cats = [...new Set(last.cats.concat(sp.cats))]; last.sev = Math.max(last.sev, sp.sev);
      } else merged.push({ ...sp });
    }
    return merged;
  }
  function finishSpans(text, spans) {
    if (settings.scope === 'sentence' && spans.length) return mergeSpans(text, spans.map(sp => E.expandToSentence(text, sp)));
    return spans.sort((a, b) => a.start - b.start);
  }
  function findSpans(text) { return finishSpans(text, rawSpans(text)); }
  // A slice boundary near i: just after a sentence end if there is one close by.
  function cut(text, i) {
    if (i >= text.length) return text.length;
    const back = text.slice(Math.max(0, i - 400), i);
    const m = back.match(/.*[.!?\n]\s/s) || back.match(/.*\s/s);
    return m ? i - back.length + m[0].length : i;
  }
  // Long blocks are scanned in slices, as many as fit in this frame (slices overlap so a phrase on a boundary
  // is still seen). Returns the spans when done, or null when the caller should come back next frame.
  function scanSome(el, text, sig, until) {
    if (text.length <= CHUNK * 1.5) return findSpans(text);
    let st = el.__bnetScan;
    if (!st || st.sig !== sig) st = el.__bnetScan = { sig, at: 0, spans: [] };
    do {
      const from = st.at ? cut(text, st.at - 300) : 0;
      const end = cut(text, st.at + CHUNK);
      for (const sp of rawSpans(text.slice(from, end))) st.spans.push({ ...sp, start: sp.start + from, end: sp.end + from });
      st.at = end > st.at ? end : st.at + CHUNK;
    } while (st.at < text.length && performance.now() < until);
    if (st.at < text.length) return null;
    el.__bnetScan = null;
    return finishSpans(text, mergeSpans(text, st.spans));
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
    if (first && settings.reveal) m.title = 'Muted by BNet · click to show';
    const bo = document.createElement('span');
    bo.className = 'bnet-o';
    bo.textContent = orig;
    const ba = document.createElement('span');
    ba.className = 'bnet-a';
    ba.textContent = first ? T.render(tid, sp, sp.key).text : '';
    m.append(bo, ba);
    return m;
  }

  // The page's own text node keeps the head of its text; what we split off is remembered on it, so when a
  // framework later rewrites or removes that node (React, Vue, Lit all hold on to it) our pieces go too.
  function maskSegment(node, a, b, sp, first) {
    const parts = node.__bnetParts || (node.__bnetParts = []);
    if (b < node.nodeValue.length) { const tail = node.splitText(b); tail.__bnetSplit = true; parts.push(tail); }
    const mid = node.splitText(a); // a may be 0: the original node stays, empty, so the page keeps its reference
    mid.__bnetSplit = true;
    const m = makeMask(mid.nodeValue, sp, first);
    mid.parentNode.replaceChild(m, mid);
    parts.push(m);
  }
  function dropParts(n, parent) {
    const ps = n.__bnetParts;
    n.__bnetParts = null;
    const live = ps.filter(p => p.parentNode && p.parentNode === parent).reverse();
    if (!live.length) return;
    // Removed or moved: give the node back its whole text first. Rewritten: the page already did.
    if (parent !== n.parentNode) n.nodeValue += live.map(p => p.nodeType === 3 ? p.nodeValue : (p.dataset.o || '')).join('');
    live.forEach(p => p.remove());
  }

  function wrap(el, spans) {
    const nodes = [];
    let pos = 0;
    ownWalk(el, n => {
      const len = n.nodeValue.length;
      nodes.push({ n, s: pos, e: pos + len });
      pos += len;
    });
    for (let k = nodes.length - 1; k >= 0; k--) {
      const { n, s, e } = nodes[k];
      const segs = spans
        .filter(sp => sp.start < e && sp.end > s)
        .map(sp => ({ sp, a: Math.max(sp.start, s) - s, b: Math.min(sp.end, e) - s, first: sp.start >= s && sp.start < e }))
        .filter(g => g.b > g.a && n.nodeValue.slice(g.a, g.b).trim())
        .sort((x, y) => y.a - x.a);
      if (segs.length && n.__bnetParts) n.__bnetParts = n.__bnetParts.filter(p => p.isConnected);
      for (const g of segs) maskSegment(n, g.a, g.b, g.sp, g.first);
    }
  }

  function restoreMasks(masks) {
    if (!masks.length) return;
    const parents = new Set();
    masks.forEach(m => {
      if (!m.parentNode) return;
      const t = document.createTextNode(m.dataset.o || '');
      t.__bnetSplit = true;
      parents.add(m.parentNode);
      m.parentNode.replaceChild(t, m);
    });
    parents.forEach(p => {
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
  function restore(el) { restoreMasks(ownMasks(el)); }

  /* ---------- hold mode: pages that undo every edit ---------- */
  // Some pages redraw their text the moment anything touches it. Fighting that every frame is what makes a
  // pointer flicker, and backing off would leave the words showing. Instead such text is covered with a
  // CSS highlight, which paints over the words without changing the page at all.
  let HL = null;
  try { if (typeof Highlight === 'function' && CSS.highlights) HL = new Highlight(); } catch (e) { HL = null; }
  const holds = new Set(); // { r: Range, key, el }
  function clearHold(el) {
    if (!el.__bnetHolds) return;
    for (const h of el.__bnetHolds) { holds.delete(h); HL.delete(h.r); }
    el.__bnetHolds = null;
  }
  function holdSpans(el, spans) {
    const nodes = [];
    let pos = 0;
    ownWalk(el, n => { const len = n.nodeValue.length; if (len) nodes.push({ n, s: pos, e: pos + len }); pos += len; });
    const at = (off, end) => {
      for (const x of nodes) if (end ? off > x.s && off <= x.e : off >= x.s && off < x.e) return [x.n, off - x.s];
      return null;
    };
    try { if (!CSS.highlights.has('bnet-hold')) CSS.highlights.set('bnet-hold', HL); } catch (e) {}
    el.__bnetHolds = [];
    for (const sp of spans) {
      const a = at(sp.start, false), b = at(sp.end, true);
      if (!a || !b) continue;
      const r = new Range();
      try { r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); } catch (e) { continue; }
      const h = { r, key: sp.key, el };
      el.__bnetHolds.push(h); holds.add(h);
      if (!revealed.has(sp.key)) HL.add(r);
    }
  }
  function holdAt(x, y) {
    if (!holds.size) return null;
    let node, off;
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
    if (!node) return null;
    for (const h of holds) {
      if (h.r.collapsed) continue;
      try {
        if (!h.r.isPointInRange(node, off)) continue;
        const rect = h.r.getBoundingClientRect();
        if (x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2) return h;
      } catch (e) {}
    }
    return null;
  }
  // Text hash -> how quickly the page undid our last edit to it. Keyed by text, not element, so a page that
  // swaps in a fresh copy of the element is recognised too.
  const fights = new Map();
  const FIGHT_MS = 1500;
  function fightOf(text) { return fights.get(T.hash(text)); }
  function noteWrite(text, el) {
    const h = T.hash(text), f = fights.get(h);
    if (fights.size > 3000) fights.delete(fights.keys().next().value);
    fights.set(h, { t: Date.now(), n: f ? f.n : 0, el, hold: f ? f.hold : false });
  }
  function noteRevert(f) {
    if (!f) return;
    f.n = Date.now() - f.t < FIGHT_MS ? f.n + 1 : 0;
    if (f.n >= 3) f.hold = true;
  }

  function permalink(el) {
    if (!ON_X || !el.closest) return location.href;
    const wrap = el.closest('[data-href*="/status/"]');
    if (wrap) return new URL(wrap.getAttribute('data-href'), location.origin).href;
    const art = el.closest('article');
    const a = art && (art.querySelector('a[href*="/status/"] time') ? art.querySelector('a[href*="/status/"] time').parentElement : art.querySelector('a[href*="/status/"]'));
    return a ? a.href : location.href;
  }

  /* ---------- selection guard ---------- */
  // Rewriting a block the user is selecting in would drop their selection, so that waits until they are done.
  let pointerDown = false;
  const waitingForSel = new Set();
  let selTimer = null;
  function selectingIn(el) {
    const s = getSelection();
    if (!s || !s.rangeCount || (s.isCollapsed && !pointerDown)) return false;
    try { return s.getRangeAt(0).intersectsNode(el.nodeType === 11 ? el.host : el); } catch (e) { return false; }
  }
  function releaseSel() {
    clearTimeout(selTimer); selTimer = null;
    for (const el of waitingForSel) pending.add(el);
    waitingForSel.clear();
    kick();
  }
  function waitForSel(el) {
    waitingForSel.add(el);
    if (!selTimer) selTimer = setTimeout(releaseSel, 10000);
  }

  let scannedCount = 0, changed = false;
  // Returns true when a long block still has slices to read.
  function processText(el, until) {
    if (!el.isConnected) return false;
    const text = origText(el);
    const sig = text + '\u0000' + version;
    let f = null;
    if (el.__bnetSig === sig) {
      if (el.__bnetHolds) {
        // Held text: nothing to do unless the page redrew it, which leaves our ranges empty.
        if (el.__bnetHolds.every(h => !h.r.collapsed)) return false;
      } else {
        if (ownMasks(el).length === (el.__bnetMasks || 0)) return false;
        // Same text, masks gone: the page redrew it.
        f = fightOf(text); noteRevert(f);
      }
    } else if (el.__bnetSig === undefined && (f = fightOf(text)) && f.el !== el && !f.el.isConnected) {
      // A fresh copy of text we masked a moment ago, its predecessor gone: the page swapped elements.
      noteRevert(f);
    }
    const src = surfaceOf(el);
    let spans = [];
    if (active && compiled && surfaceOn(src) && text.trim().length >= 2 && text.length <= MAX_TEXT) {
      spans = scanSome(el, text, sig, until || 0);
      if (!spans) return true;
    }
    if (!f && !el.__bnetHolds) f = fightOf(text);
    const hold = HL && (el.__bnetHolds || (f && f.hold)) && spans.length;
    scannedCount++;
    // Same phrases in the same places (a like counter ticked, a timestamp moved on): leave the page alone,
    // so the pointer, the selection and anything revealed stay exactly as they are.
    if (!hold && el.__bnetVer === version && !el.__bnetHolds && sameLayout(el, spans)) {
      el.__bnetSig = sig; el.__bnetMasks = ownMasks(el).length;
      return false;
    }
    if (!hold && selectingIn(el)) { waitForSel(el); return false; }
    el.__bnetSig = sig;
    el.__bnetVer = version;
    el.__bnetMasks = 0;
    changed = true;
    try { restore(el); } catch (e) { /* the page re-rendered under us */ }
    if (HL) clearHold(el);
    if (!spans.length) return false;
    const th = T.hash(text).toString(36);
    const bare = text.replace(/\s+/g, ' ').trim().length;
    for (const sp of spans) {
      sp.whole = sp.text.length >= bare * 0.8;
      sp.key = E.normKey(sp.text) + '|' + th;
      spanInfo.set(sp.key, { span: sp.text, cats: sp.cats, cat: sp.primary, rule: sp.rule, sev: sp.sev, src, ctx: text.slice(0, 600), url: permalink(el) });
    }
    if (hold) { holdSpans(el, spans); report(spans.map(sp => sp.key)); return false; }
    styleRoot(el.nodeType === 11 ? el : el.getRootNode());
    try { wrap(el, spans); } catch (e) { try { restore(el); } catch (_) {} return false; }
    el.__bnetMasks = ownMasks(el).length;
    noteWrite(text, el);
    report(spans.map(sp => sp.key));
    return false;
  }

  /* ---------- reporting (batched) ---------- */
  let outbox = [];
  let outTimer = null;
  // Toolbar number: what is muted on the page right now (the same count the popup shows), so it drops when
  // a setting unmutes something or the page removes it.
  let countTimer = null, lastCount = null;
  function liveKeys() {
    const keys = new Set();
    forEachRoot(r => r.querySelectorAll('bnet-mask[data-key], .bnet-img-mask[data-key]').forEach(n => keys.add(n.dataset.key)));
    for (const h of holds) {
      // Posts scrolled out of an endless feed are gone for good: let them (and their DOM) be freed.
      if (!h.el.isConnected) { holds.delete(h); try { HL.delete(h.r); } catch (e) {} h.el.__bnetHolds = null; continue; }
      if (!h.r.collapsed) keys.add(h.key);
    }
    return keys;
  }
  let countSent = false;
  // A frame that goes away (removed iframe, navigation) takes its count with it.
  addEventListener('pagehide', () => { try { chrome.runtime.sendMessage({ type: 'pageCount', n: 0 }).catch(() => {}); } catch (e) {} });
  function pageCount(force) {
    if (force) lastCount = null;
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      const n = active ? liveKeys().size : -1;
            // Every frame reports its own count; the service worker adds them up per tab.
      if (n !== lastCount) { lastCount = n; send({ type: 'pageCount', n, fresh: TOP && !countSent }); countSent = true; }
    }, 250);
  }
  function report(keys) {
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
  // On X, post pictures are read as they come near the screen. Elsewhere a picture is read only after it has
  // stayed on screen for a moment and scrolling has stopped, one at a time, so a page full of thumbnails
  // never keeps the computer busy.
  let lastScroll = 0;
  const dwell = new Map();
  const imgIO = new IntersectionObserver(entries => {
    for (const en of entries) {
      const img = en.target;
      if (ON_X) { if (en.isIntersecting) { imgIO.unobserve(img); ocrImage(img); } continue; }
      clearTimeout(dwell.get(img));
      if (!en.isIntersecting) { dwell.delete(img); continue; }
      dwell.set(img, setTimeout(function tryRead() {
        if (!img.isConnected) return;
        if (Date.now() - lastScroll < 400 || ocrBusy) { dwell.set(img, setTimeout(tryRead, 500)); return; }
        dwell.delete(img); imgIO.unobserve(img); ocrImage(img);
      }, 700));
    }
  }, ON_X ? { rootMargin: '400px 0px' } : { threshold: 0.5 });

  function watchImg(img) {
    if (img.__bnetWatched) { if (img.__bnetOcr) applyImageMasks(img); return; }
    if (!active || !settings.surfaces.images) return;
    img.__bnetWatched = true;
    imgIO.observe(img);
  }

  function ocrUrl(src, img) {
    try {
      const u = new URL(src);
      if (!ON_X) {
        if (!/^https?:$/.test(u.protocol) || /\.svg($|\?)/i.test(u.pathname)) return null;
        // Only pictures big enough to carry readable text: memes, screenshots, banners.
        const r = img.getBoundingClientRect();
        if (img.naturalWidth < 200 || img.naturalHeight < 80 || r.width < 150 || r.height < 60) return null;
        return u.href;
      }
      if (!/(^|\.)pbs\.twimg\.com$/.test(u.hostname) || !u.pathname.startsWith('/media/')) return null;
      u.searchParams.set('name', 'small');
      if (!u.searchParams.get('format')) u.searchParams.set('format', 'jpg');
      return u.href;
    } catch (e) { return null; }
  }

  let ocrCount = 0, ocrBusy = false;
  async function ocrImage(img) {
    if (!img.complete) { img.addEventListener('load', () => ocrImage(img), { once: true }); return; }
    const url = ocrUrl(img.currentSrc || img.src, img);
    if (!url || ocrCount >= (ON_X ? 200 : 24)) return;
    ocrCount++;
    ocrBusy = true;
    let res;
    try { res = await send({ type: 'ocr', url }); } finally { ocrBusy = false; }
    if (!res || !res.ok || !img.isConnected) return;
    img.__bnetOcr = res;
    applyImageMasks(img);
  }

  // A box that keeps resizing (an animation, a carousel) gets its covers redrawn at most every 100 ms.
  const boxRO = new ResizeObserver(entries => {
    for (const en of entries) {
      const img = en.target.__bnetImg;
      if (!img || img.__bnetRedraw) continue;
      img.__bnetRedraw = setTimeout(() => { img.__bnetRedraw = null; applyImageMasks(img, true); }, 100);
    }
  });

  // Covers laid over loose pictures follow them if the page shifts (content loading above, a resize).
  const framed = new Set();
  let framedTimer = null;
  function checkFramed() {
    for (const img of framed) {
      if (!img.isConnected || !img.__bnetLayer || !img.__bnetLayer.isConnected) { if (img.__bnetLayer) img.__bnetLayer.remove(); framed.delete(img); continue; }
      const r = img.getBoundingClientRect(), f = img.__bnetFrame;
      if (Math.abs(r.left + scrollX - f.x) > 2 || Math.abs(r.top + scrollY - f.y) > 2 || Math.abs(r.width - f.w) > 2 || Math.abs(r.height - f.h) > 2) applyImageMasks(img, true);
    }
    if (!framed.size) { clearInterval(framedTimer); framedTimer = null; }
  }

  function applyImageMasks(img, fromResize) {
    const res = img.__bnetOcr;
    let box = ON_X ? (img.closest('[data-testid="tweetPhoto"]') || img.parentElement) : img.parentElement;
    if (box && !ON_X && (box.localName === 'picture' || isInline(box))) box = blockAncestor(box);
    if (box && box.nodeType !== 1) box = img.parentElement;
    if (!res || !box) return;
    // Off X the picture often sits loose in a big column. Rather than repositioning that column, the cover
    // is laid exactly over the picture inside the nearest already-positioned ancestor.
    let frame = null;
    if (!ON_X) {
      const b = box.getBoundingClientRect(), r = img.getBoundingClientRect();
      if (b.width > r.width * 1.5 + 40 || b.height > r.height * 1.5 + 40) {
        let c = img.parentElement;
        while (c && c !== document.documentElement && getComputedStyle(c).position === 'static') c = c.parentElement;
        if (!c || c === document.body) c = document.documentElement;
        const cr = c.getBoundingClientRect();
        frame = c === document.documentElement
          ? { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }
          : { left: r.left - cr.left - c.clientLeft + c.scrollLeft, top: r.top - cr.top - c.clientTop + c.scrollTop, width: r.width, height: r.height };
        box = c;
      }
    }
    if (img.__bnetLayer) { img.__bnetLayer.remove(); img.__bnetLayer = null; }
    if (!frame) box.querySelectorAll(':scope > .bnet-img').forEach(n => { if (!n.__bnetFramed) n.remove(); });
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
    const ir = img.getBoundingClientRect();
    const cw = frame ? frame.width : box.clientWidth, ch = frame ? frame.height : box.clientHeight;
    if (!cw || !ch) return;
    const br = frame ? ir : box.getBoundingClientRect();
    const visible = parseFloat(getComputedStyle(img).opacity) > 0.05 && ir.width > 4;
    const ox = visible ? ir.left - br.left : 0, oy = visible ? ir.top - br.top : 0;
    const iw = visible ? ir.width : cw, ih = visible ? ir.height : ch;
    const fit = visible ? getComputedStyle(img).objectFit : 'cover';
    let sx, sy;
    if (fit === 'contain' || fit === 'scale-down') sx = sy = Math.min(iw / res.w, ih / res.h);
    else if (fit === 'fill') { sx = iw / res.w; sy = ih / res.h; }
    else sx = sy = Math.max(iw / res.w, ih / res.h);
    const dx = ox + (iw - res.w * sx) / 2, dy = oy + (ih - res.h * sy) / 2;

    if (!frame && getComputedStyle(box).position === 'static') box.style.position = 'relative';
    styleRoot(box.getRootNode());
    const layer = document.createElement('div');
    layer.className = 'bnet-img';
    if (frame) {
      layer.__bnetFramed = true;
      Object.assign(layer.style, { inset: 'auto', left: frame.left + 'px', top: frame.top + 'px', width: frame.width + 'px', height: frame.height + 'px' });
    }
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
      let firstBox = true;
      for (const b of lines.values()) {
        const pad = Math.max(4, (b[3] - b[1]) * 0.22);
        const x = (b[0] - pad) * sx + dx, y = (b[1] - pad) * sy + dy;
        const w = (b[2] - b[0] + pad * 2) * sx, h = (b[3] - b[1] + pad * 2) * sy;
        const m = document.createElement('div');
        m.className = 'bnet-img-mask bnet-it-' + visual + (revealed.has(key) ? ' bnet-open' : '');
        m.dataset.key = key;
        m.title = settings.reveal ? 'Muted by BNet · click to show' : 'Muted by BNet';
        // One keyboard stop per phrase, like text masks.
        m.setAttribute('role', 'button');
        m.setAttribute('tabindex', firstBox ? '0' : '-1');
        m.setAttribute('aria-label', 'Muted text in a picture. Activate to show.');
        firstBox = false;
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
    img.__bnetLayer = layer;
    if (frame) { img.__bnetFrame = { x: ir.left + scrollX, y: ir.top + scrollY, w: ir.width, h: ir.height }; framed.add(img); if (!framedTimer) framedTimer = setInterval(checkFramed, 1000); }
    else if (!box.__bnetImg) { box.__bnetImg = img; boxRO.observe(box); }
    if (!fromResize && !img.__bnetReported) { img.__bnetReported = true; report(keys); }
  }

  /* ---------- reveal + chip ---------- */
  // The chip goes in the browser's top layer (a popover), so fixed headers, modals and stacking contexts
  // can never cover it, and it follows its phrase while the page scrolls.
  let chip = null;
  function hideChip(refocus) {
    if (!chip) return;
    const t = chip.__bnetTarget;
    const hadFocus = chip.contains(document.activeElement);
    try { chip.hidePopover(); } catch (e) {}
    chip.remove(); chip = null;
    if ((refocus || hadFocus) && t && t.focus && t.isConnected) try { t.focus({ preventScroll: true }); } catch (e) {}
  }
  function setOpen(key, open) {
    if (open) revealed.add(key); else revealed.delete(key);
    const sel = '[data-key="' + CSS.escape(key) + '"]';
    forEachRoot(r => r.querySelectorAll('bnet-mask' + sel + ', .bnet-img-mask' + sel).forEach(n => n.classList.toggle('bnet-open', open)));
    for (const h of holds) if (h.key === key) { if (open) HL.delete(h.r); else HL.add(h.r); }
  }
  function chipButton(act, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.act = act; b.textContent = label;
    return b;
  }
  function dot() { const d = document.createElement('span'); d.className = 'bnet-dot'; return d; }
  function note(text) { const n = document.createElement('span'); n.className = 'bnet-note'; n.textContent = text; return n; }
  function toTopLayer(el) {
    try { el.popover = 'manual'; el.showPopover(); } catch (e) { /* older browser: stays a fixed element */ }
  }
  function showChip(target, key) {
    hideChip();
    chip = document.createElement('bnet-chip');
    chip.setAttribute('role', 'group');
    chip.setAttribute('aria-label', 'BNet');
    chip.append(dot(), chipButton('hide', 'Hide again'), chipButton('ok', 'Not hateful'));
    chip.__bnetTarget = target;
    chip.dataset.key = key;
    chip.style.visibility = 'hidden';
    // Inside an open modal dialog the rest of the page is inert, so the chip has to live in the dialog.
    const dlg = target.closest && target.closest('dialog[open]');
    (dlg || document.documentElement).appendChild(chip);
    toTopLayer(chip);
    placeChip();
  }
  function placeChip() {
    if (!chip) return;
    const t = chip.__bnetTarget;
    if (t instanceof Range ? t.collapsed : !t.isConnected) { hideChip(); return; }
    const r = t.getBoundingClientRect();
    const cw = chip.offsetWidth || 220, chh = chip.offsetHeight || 34;
    // Phrase scrolled off screen or tucked under a fixed header: keep the chip out of the way until it is back.
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), cy = r.top + r.height / 2;
    let shown = r.bottom > 0 && r.top < innerHeight && (r.width || r.height);
    if (shown) {
      const hit = document.elementFromPoint(cx, Math.min(Math.max(cy, 1), innerHeight - 1));
      const anchor = t instanceof Range ? t.commonAncestorContainer : t;
      shown = !hit || hit === chip || chip.contains(hit) || deepContains(hit, anchor) || deepContains(anchor, hit);
    }
    if (!shown) { chip.style.visibility = 'hidden'; return; }
    const left = Math.min(Math.max(8, r.left + r.width / 2 - cw / 2), innerWidth - cw - 8);
    let top = r.bottom + 8;
    if (top + chh > innerHeight - 8) top = r.top - chh - 8;
    top = Math.min(Math.max(8, top), innerHeight - chh - 8);
    chip.style.left = left + 'px';
    chip.style.top = top + 'px';
    chip.style.visibility = '';
  }
  let placeQueued = false;
  function queuePlace() {
    if (!chip || placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => { placeQueued = false; placeChip(); });
  }

  function onActivate(e, el, key) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!settings.reveal) return;
    if (revealed.has(key)) { setOpen(key, false); hideChip(e.type === 'keydown'); return; }
    setOpen(key, true);
    showChip(el, key);
    // From the keyboard, focus moves into the chip; Escape or "Hide again" brings it back.
    if (e.type === 'keydown' && chip) try { chip.querySelector('button').focus({ preventScroll: true }); } catch (err) {}
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
      const hadFocus = chip.contains(document.activeElement);
      chip.replaceChildren(dot(), note('Thanks — BNet will leave this alone.'));
      const c = chip;
      if (hadFocus) { c.tabIndex = -1; try { c.focus({ preventScroll: true }); } catch (err) {} }
      setTimeout(() => { if (chip === c) hideChip(); }, 1400);
    }
  }

  const targetOf = e => { const t = e.composedPath ? e.composedPath()[0] : e.target; return t && t.closest ? t : (t && t.parentElement) || e.target; };
  // Clicks inside a closed shadow root never show their real target to the window, so those roots get the
  // same listeners.
  function listenOn(on) {
    for (const type of ['click', 'auxclick']) {
      on.addEventListener(type, e => {
        if (!alive()) return;
        const t = targetOf(e);
        if (!t || !t.closest) return;
        // A page script can call .click() on our elements; only the person's own clicks count, or a site
        // could add phrases to the "Not hateful" list (which applies on every site) or flood the log.
        const ours = t.closest('bnet-chip, bnet-mask, .bnet-img-mask');
        if (ours && !e.isTrusted) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return; }
        if (t.closest('bnet-chip')) { if (type === 'click') onChip(e); else { e.preventDefault(); e.stopPropagation(); } return; }
        const m = t.closest('bnet-mask, .bnet-img-mask');
        if (m) { if (type === 'click') onActivate(e, m, m.dataset.key); else { e.preventDefault(); e.stopPropagation(); } return; }
        if (on !== window) return;
        const h = holds.size && e.clientX != null && holdAt(e.clientX, e.clientY);
        if (h) { if (!e.isTrusted) return; if (type === 'click') onActivate(e, h.r, h.key); else { e.preventDefault(); e.stopPropagation(); } return; }
        hideChip();
      }, true);
    }
    for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
      on.addEventListener(type, e => {
        if (!alive()) return;
        if (on === window && type === 'pointerdown' && e.button === 0) pointerDown = true;
        if (on === window && type === 'pointerup') { pointerDown = false; if (waitingForSel.size && getSelection().isCollapsed) releaseSel(); }
        const t = targetOf(e);
        if (t && t.closest && (t.closest('bnet-chip') || t.closest('.bnet-img-mask'))) e.stopPropagation();
      }, true);
    }
    on.addEventListener('keydown', e => {
      if (!alive()) return;
      const t = targetOf(e);
      const m = t && t.closest && t.closest('bnet-mask, .bnet-img-mask');
      if (m && e.isTrusted && (e.key === 'Enter' || e.key === ' ')) onActivate(e, m, m.dataset.key);
      if (on === window && e.key === 'Escape' && chip) hideChip(true);
    }, true);
  }
  listenOn(window);
  window.addEventListener('blur', () => { pointerDown = false; });
  document.addEventListener('selectionchange', () => { if (waitingForSel.size && !pointerDown && getSelection().isCollapsed) releaseSel(); });
  window.addEventListener('scroll', () => { lastScroll = Date.now(); if (alive()) queuePlace(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => queuePlace(), { passive: true });
  // Text that becomes editable (a "Edit" button, designMode) gets its original words back before typing starts.
  document.addEventListener('focusin', e => {
    if (!alive()) return;
    const t = targetOf(e);
    if (document.designMode === 'on') unmaskIn(document.documentElement);
    else if (t && t.isContentEditable) unmaskIn(t);
  }, true);

  /* ---------- scheduling ---------- */
  // Nothing heavy happens in the mutation callback: nodes are noted, and each frame resolves and reads a
  // slice of them (less while the user is scrolling), so a long page or an infinite feed never stutters.
  const raw = new Set();     // nodes whose text block is not known yet
  const walks = [];          // subtrees (and shadow roots) still to be read
  const pending = new Set(); // text blocks to read
  let scheduled = false;
  function kick() { if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } }
  function queue(n) { if (n) { raw.add(n); kick(); } }
  const WALK_FILTER = {
    acceptNode(n) {
      if (n.nodeType === 3) return n.nodeValue.length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      if (WALK_SKIP.has(n.localName) || n.localName === 'bnet-mask' || n.localName === 'bnet-chip' || n.classList.contains('bnet-img')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  };
  function visit(n) {
    if (n.nodeType === 3) {
      if (n.nodeValue.trim().length > 1) { const h = hostOf(n); if (h) pending.add(h); }
      return;
    }
    if (n.nodeType !== 1) return;
    if (n.localName === 'img' && n.matches(SEL.images)) watchImg(n);
    const sr = shadowOf(n);
    if (sr) adoptRoot(sr);
    else if (n.localName.includes('-') && n.matches(':not(:defined)')) watchLate(n);
  }
  function stepWalk(limit) {
    const w = walks[0];
    if (!w.tw || !w.tw.currentNode.isConnected) {
      if (!w.root.isConnected || (w.root.nodeType === 1 && WALK_FILTER.acceptNode(w.root) === NodeFilter.FILTER_REJECT)) { walks.shift(); return; }
      w.tw = document.createTreeWalker(w.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, WALK_FILTER);
      visit(w.root);
    }
    for (let i = 0; i < limit; i++) {
      const n = w.tw.nextNode();
      if (!n) { walks.shift(); return; }
      visit(n);
    }
  }
  function flush() {
    scheduled = false;
    if (!alive()) return;
    if (!compiled) return; // loadAll walks the whole page once the rules are ready
    const until = performance.now() + (Date.now() - lastScroll < 300 ? 6 : 12);
    while (performance.now() < until) {
      if (pending.size) {
        for (const el of pending) {
          pending.delete(el);
          let more = false;
          try { more = processText(el, until); } catch (e) { /* keep going */ }
          if (more) pending.add(el);
          if (performance.now() > until) break;
        }
        continue;
      }
      if (raw.size) {
        let k = 0;
        for (const n of raw) { raw.delete(n); try { const h = hostOf(n); if (h) pending.add(h); } catch (e) {} if (++k >= 100) break; }
        continue;
      }
      if (walks.length) { try { stepWalk(300); } catch (e) { walks.shift(); } continue; }
      break;
    }
    mo.takeRecords();
    if (changed) { changed = false; pageCount(); }
    if (pending.size || raw.size || walks.length) kick();
  }

  function rescanAll() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', rescanAll, { once: true }); return; }
    forEachRoot(r => r.querySelectorAll('bnet-mask').forEach(m => queue(m.parentNode)));
    for (const h of holds) pending.add(h.el);
    walks.length = 0;
    walks.push({ root: document.body });
    for (const r of roots) if (r.isConnected) walks.push({ root: r });
    kick();
    if (!active) hideChip();
  }

  // Put the original words back under a node that just became editable, so they never end up in what is typed or saved.
  function unmaskIn(root) {
    const masks = [...root.querySelectorAll('bnet-mask')];
    if (root.shadowRoot) masks.push(...root.shadowRoot.querySelectorAll('bnet-mask'));
    for (const h of [...holds]) if (root.contains(h.el.nodeType === 11 ? h.el.host : h.el)) clearHold(h.el);
    if (!masks.length) return;
    const hosts = new Set(masks.map(m => m.parentElement ? blockAncestor(m.parentElement) : m.parentNode));
    restoreMasks(masks);
    hosts.forEach(h => { if (h) { h.__bnetSig = undefined; h.__bnetMasks = 0; } });
  }

  const ours = n => n.localName === 'bnet-mask' || n.localName === 'bnet-chip' || (n.classList && n.classList.contains('bnet-img'));
  const MO_OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'contenteditable'] };
  const mo = new MutationObserver(recs => {
    if (!alive()) { mo.disconnect(); return; }
    for (const r of recs) {
      const tgt = r.target;
      if (r.type === 'characterData') {
        // The page rewrote one of its text nodes we had split: our pieces after it are stale now.
        if (tgt.__bnetParts) dropParts(tgt, tgt.parentNode);
        const p = tgt.parentElement;
        if (p && p.closest('bnet-mask, bnet-chip, .bnet-img')) continue;
        if (compiled) queue(tgt);
        continue;
      }
      if (tgt.nodeType === 1 && tgt.closest('bnet-mask, bnet-chip, .bnet-img')) continue;
      if (r.type === 'attributes') {
        if (r.attributeName === 'contenteditable') { if (editable(tgt)) unmaskIn(tgt); else if (compiled) { walks.push({ root: tgt }); kick(); } continue; }
        if (tgt.matches(SEL.images)) { tgt.__bnetWatched = false; tgt.__bnetOcr = null; tgt.__bnetReported = false; watchImg(tgt); }
        continue;
      }
      for (const n of r.removedNodes) {
        if (n.nodeType === 3 && n.__bnetParts) dropParts(n, tgt);
        else if (n.nodeType === 1 && (n.localName === 'bnet-mask' || n.querySelector('bnet-mask, .bnet-img-mask'))) pageCount();
      }
      if (!compiled) continue;
      // On X a container outside any post text (an article body) would become one big host overlapping the
      // post and quote hosts, and rewriting it stripped the quote's mask. Read the text inside it instead.
      if (ON_X && tgt.nodeType === 1 && !tgt.closest(ALL_TEXT)) { if ((tgt.textContent || '').length < 2500) walks.push({ root: tgt }); }
      else queue(tgt);
      for (const n of r.addedNodes) {
        if (n.nodeType === 3) { queue(n); continue; }
        if (n.nodeType !== 1 || ours(n)) continue;
        walks.push({ root: n });
      }
      kick();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'toast') { if (TOP) showToast(msg.text); return; }
    if (!msg || msg.type !== 'status' || !TOP) return;
    sendResponse({ ok: true, active, siteOff, site: SITE, muted: liveKeys().size, scanned: scannedCount, rules: compiled ? compiled.count : 0 });
  });

  let toastTimer = null;
  function showToast(text) {
    let t = document.querySelector('bnet-chip.bnet-toast');
    if (!t) { t = document.createElement('bnet-chip'); t.className = 'bnet-toast'; t.setAttribute('role', 'status'); document.documentElement.appendChild(t); toTopLayer(t); }
    t.replaceChildren(dot(), note(text));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { try { t.hidePopover(); } catch (e) {} t.remove(); }, 2200);
    try { getSelection().removeAllRanges(); } catch (e) {}
  }

  window.__bnetStop = () => {
    mo.disconnect();
    forEachRoot(r => {
      restoreMasks([...r.querySelectorAll('bnet-mask')]);
      r.querySelectorAll('.bnet-img').forEach(n => n.remove());
    });
    if (HL) { HL.clear(); holds.clear(); }
    hideChip();
  };

  function start() {
    mo.observe(document.documentElement, MO_OPTS);
    loadAll();
  }
  // Tiny frames (ads, trackers, buttons) can't hold a comment thread; don't spend rule setup on them.
  // A frame that grows later (lazy embeds) is picked up when it does.
  const roomy = () => TOP || (innerWidth >= 240 && innerHeight >= 120);
  function begin() {
    if (roomy()) { start(); return; }
    const onResize = () => { if (roomy()) { removeEventListener('resize', onResize); start(); } };
    addEventListener('resize', onResize);
  }
  if (document.documentElement) begin();
  else document.addEventListener('readystatechange', begin, { once: true });
})();

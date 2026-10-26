/* BNet engine — on-device pattern matcher. No AI at runtime.
 * Packs (JSON) supply groups, predicates, prefixes, slurs, phrases and allow rules.
 * scan(text) returns spans in ORIGINAL string indices. */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'racism', label: 'Racism & ethnic hate' },
    { id: 'religion', label: 'Religious hate' },
    { id: 'sexism', label: 'Misogyny & sexism' },
    { id: 'lgbtq', label: 'Anti-LGBTQ+ hate' },
    { id: 'ableism', label: 'Ableist hate' },
    { id: 'slurs', label: 'Slurs' },
    { id: 'dehumanising', label: 'Dehumanising language' },
    { id: 'extremism', label: 'Violent extremism' },
    { id: 'political', label: 'Political hostility' }
  ];
  const CAT_IDS = CATEGORIES.map(c => c.id);

  const ZW = /[​-‏⁠-⁤﻿­͏᠎]/;
  const MARKS = /\p{M}/gu;
  const HOMO = {
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'і': 'i', 'х': 'x', 'у': 'y', 'ѕ': 's',
    'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'ո': 'n', 'ı': 'i', 'ｉ': 'i', 'κ': 'k', 'ν': 'v', 'τ': 't',
    'ο': 'o', 'α': 'a', 'ε': 'e', 'ρ': 'p', 'ι': 'i'
  };
  const QUOTES = { '’': "'", '‘': "'", 'ʼ': "'", '′': "'", '`': "'" };

  // One code point -> its normalised form ('' = drop), before look-alike mapping. ASCII is handled inline;
  // other characters are memoised because NFKD + regex per character is the slow part of normalising a page.
  const charMemo = new Map();
  function normChar(ch) {
    let p = charMemo.get(ch);
    if (p !== undefined) return p;
    p = ZW.test(ch) ? '' : QUOTES[ch] || ch.toLowerCase().normalize('NFKD').replace(MARKS, '');
    if (charMemo.size < 20000) charMemo.set(ch, p);
    return p;
  }
  // Look-alike letters are a disguise only inside a Latin word ("nіgger" with a Cyrillic і) or a word made
  // entirely of look-alikes; a real Greek or Russian word keeps its own letters so rules in that script match.
  const TOKEN = /[\p{L}\p{N}]+/gu, LATIN = /\p{sc=Latin}/u, NUM = /\p{N}/u;
  const homoToken = tok => {
    let any = false, latin = LATIN.test(tok), all = true;
    for (const c of tok) { if (HOMO[c]) any = true; else if (!NUM.test(c)) all = false; }
    if (!any || !(latin || all)) return tok;
    let out = '';
    for (const c of tok) out += HOMO[c] || c;
    return out;
  };
  const homoMap = str => str.replace(TOKEN, homoToken);   // HOMO maps one unit to one unit: indices stay put

  // Rules are written (or copied from a page) with curly quotes and accents; text is matched after normalising,
  // so rules get the same treatment: "weren’t" in a rule must match "weren’t" on the page.
  // Plain ASCII without a backtick is already in normal form; skipping the work keeps compile fast.
  // Non-ASCII characters get exactly the text's treatment; escapes (\s, \p{L}) are kept out of the words.
  const PLAIN = /^[\x00-\x5f\x61-\x7f]*$/;
  const ruleNorm = src => {
    const str = String(src == null ? '' : src);
    if (PLAIN.test(str)) return str;
    let out = '';
    for (const ch of str) out += ch === '`' ? "'" : ch.charCodeAt(0) < 0x80 ? ch : normChar(ch);
    return out.replace(/\\.|[\p{L}\p{N}]+/gsu, t => t[0] === '\\' ? t : homoToken(t));
  };

  /* Normalise per code point, keeping a map from each normalised unit back to the original. */
  function normalize(text) {
    const out = [];
    const s = [], e = [];
    const n = text.length;
    let homo = false;
    for (let i = 0; i < n;) {
      const c = text.charCodeAt(i);
      if (c < 0x80) {
        // ASCII: lower-case, backtick -> apostrophe (same result as the general path, without the cost).
        out.push(c === 96 ? "'" : c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : text[i]);
        s.push(i); e.push(i + 1); i++;
        continue;
      }
      const len = text.codePointAt(i) > 0xffff ? 2 : 1;
      const p = normChar(len === 1 ? text[i] : text.slice(i, i + 2));
      if (p.length === 1 && HOMO[p]) homo = true;
      for (let k = 0; k < p.length; k++) { out.push(p[k]); s.push(i); e.push(i + len); }
      i += len;
    }
    const norm = out.join('');
    return { norm: homo ? homoMap(norm) : norm, s, e };
  }

  function normKey(text) {
    return normalize(String(text || '')).norm.replace(/\s+/g, ' ').trim();
  }

  const reEsc = str => str.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
  const clsEsc = str => str.replace(/[\\\]\[^\-]/g, '\\$&');

  // Only symbol and digit swaps count as disguise; letter-for-letter swaps (l/i, c/k, s/z) hit real words.
  const LEET = {
    a: 'a@4*', b: 'b8', e: 'e3*', g: 'g9', i: 'i1!|*', l: 'l1|', o: 'o0*', s: 's$5', t: 't7+', u: 'u*'
  };
  const SEP = "[._\\-*~'`]?";

  // Prefix tree -> regex: shared beginnings are matched once ("black (?:people|men|women)").
  const END = '\u0000';
  function trieSource(seqs) {
    const root = new Map();
    for (const seq of seqs) {
      let node = root;
      for (const tok of seq) { if (!node.has(tok)) node.set(tok, new Map()); node = node.get(tok); }
      node.set(END, null);
    }
    const emit = node => {
      const end = node.has(END);
      const parts = [];
      for (const [k, child] of node) if (k !== END) parts.push(k + emit(child));
      if (!parts.length) return '';
      if (parts.length === 1 && !end) return parts[0];
      return '(?:' + parts.join('|') + ')' + (end ? '?' : '');
    };
    return emit(root);
  }
  const SPACEY = /[\s-]/, SPECIAL = new Set('\\^$.*+?()[]{}|/');
  const charTokens = term => {
    const out = [];
    for (const ch of term) {
      if (SPACEY.test(ch)) { if (out[out.length - 1] !== '[\\s-]+') out.push('[\\s-]+'); }
      else out.push(SPECIAL.has(ch) ? '\\' + ch : ch);
    }
    return out;
  };
  // The slur body as tokens (for the prefix tree); tokens.join('') is the slur's own pattern.
  function slurTokens(entry) {
    const w = String(entry.word).toLowerCase().trim();
    const toks = [];
    w.split(/[\s-]+/).forEach((part, pi) => {
      if (pi) toks.push("[\\s._\\-*]*");
      wordRuns(part).forEach((r, ri) => { if (ri) toks.push(SEP); toks.push(r); });
    });
    toks.push(/o$/.test(w) ? '(?:e?s)?' : '(?:s|z)?');
    return toks;
  }
  // Any match of a slur starts with a character of this class (null: no such guarantee).
  function slurFirst(entry) {
    const first = String(entry.word).toLowerCase().trim().split(/[\s-]+/)[0];
    if (!first) return null;
    const ch = String.fromCodePoint(first.codePointAt(0));
    return clsEsc(LEET[ch] || ch);
  }
  // A letter matches its own count, or a deliberate stretch of 3+ extra ("niiigger"), never one extra ("woops").
  function wordRuns(word) {
    const runs = [];
    for (const ch of word) {
      if (runs.length && runs[runs.length - 1].ch === ch) runs[runs.length - 1].n++;
      else runs.push({ ch, n: 1 });
    }
    return runs.map(r => {
      const cls = '[' + clsEsc(LEET[r.ch] || r.ch) + ']';
      return '(?:' + cls + '{' + r.n + '}|' + cls + '{' + (r.n + 2) + ',})';
    });
  }

  const SUBJECT_SWITCH = /(?<![\p{L}'])(?<!(?:like|than|as|of|to|for|with|at|about)\s+)(?:i|you|u|he|she|we|it)(?:'(?:m|re|s|ll|d|ve))?(?![\p{L}'])(?!\s+(?:think|thought|believe|swear|guess|mean|know|reckon|bet|feel|suppose|admit|agree|said|say|says|hear|heard|read|see|saw|told|tell|notice|noticed|find|found|realise|realize|must\s+admit|have\s+to\s+say|gotta\s+say)\b)/u;
  const L = '(?<![\\p{L}\\p{N}])';
  const R = '(?![\\p{L}\\p{N}])';
  const RL = '(?![\\p{L}])';
  const PREFIX_TAIL = "\\s+(?:(?:all|the|these|those|every|any|them|filthy|dirty|stinking|fucking|f\\*+ing|bloody|damn|of|you|single|last|one|other|such|those|goddamn|lousy|stupid)\\s+)*$";
  const PREPARED = 2;   // bump when the prepared shape changes; stale prepared rules are then refused
  // Scripts written without spaces between words: a word boundary there would never be satisfied.
  const NOSPACE = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
  const edge = (pat, b) => NOSPACE.test(pat) ? '' : b;

  /* A rule that backtracks catastrophically would freeze every page it runs on. prepare() times each
   * pattern rule on short hostile strings built from its own words (growing, so a blow-up shows before it
   * hangs) and reports any that crawl. Compiling raw packs skips this to keep page loads cheap. */
  const SLOW_MS = 10;
  function tooSlow(src, flags, need) {
    let re;
    // V8 compiles on the first run and again (to machine code) on the second: keep both off the clock.
    try { re = new RegExp(src, flags); re.exec('x'); re.exec('xy'); } catch (err) { return false; }
    const words = (need || []).slice(0, 3).concat(['a', '1']);
    for (let n = 8; n <= 48; n += 8) {
      for (const w of words) {
        const k = Math.max(1, Math.ceil(n / (w.length + 1)));
        for (const t of [(w + ' ').repeat(k) + '!', w.repeat(k) + '!', (w + '-').repeat(k) + '!', ' '.repeat(n) + w]) {
          // A busy machine or a GC pause can stall one run; a real blow-up is slow every time.
          let ms = Infinity;
          for (let r = 0; r < 3 && ms > SLOW_MS; r++) {
            re.lastIndex = 0;
            const t0 = performance.now();
            re.exec(t);
            ms = Math.min(ms, performance.now() - t0);
          }
          if (ms > SLOW_MS) return Math.round(ms);
        }
      }
    }
    return 0;
  }

  /* Packs -> plain JSON (regex sources + metadata). Building the sources is most of compile's cost,
   * so the service worker can do it once and content scripts only construct the RegExps.
   * made (optional Map) keeps the RegExps built while validating so compile(packs) need not rebuild them. */
  function prepare(packs, made, guard) {
    const bad = [];
    const P = { bnetPrepared: PREPARED, groups: [], preds: [], prefixes: [], slurs: [], slurIdx: [], phrases: [], allow: [], count: 0, errors: bad };
    const ok = (src, flags, label) => {
      try { const re = new RegExp(src, flags); if (made) made.set(flags + '/' + src, re); return true; }
      catch (err) { bad.push(label + ': ' + err.message); return false; }
    };
    const fast = (src, flags, label) => {
      const ms = guard ? tooSlow(src, flags, needs(src)) : 0;
      if (ms) bad.push(label + ': too slow on hostile text (' + ms + ' ms), skipped');
      return !ms;
    };
    const byCat = {};
    const toks = [];        // token lists of bounded slurs, for the slur index

    for (const pack of packs || []) {
      if (!pack || pack.enabled === false) continue;
      const d = pack.data || pack;
      for (const [cat, terms] of Object.entries(d.groups || {})) {
        (byCat[cat] = byCat[cat] || new Set());
        for (const t of terms || []) byCat[cat].add(ruleNorm(t).toLowerCase().trim());
      }
      for (const p of d.predicates || []) {
        const pat = ruleNorm(p.pattern);
        const src = '^([^.!?\\n;:]{0,42}?)' + edge(pat, L) + '(?:' + pat + ')' + edge(pat, RL);
        if (ok(src, 'iu', 'predicate ' + p.id) && fast(src, 'iu', 'predicate ' + p.id)) { P.preds.push({ src, need: needs(src), sev: p.sev || 2, tags: p.tags || [], groups: p.groups || null, id: p.id }); P.count++; }
      }
      for (const p of d.prefixes || []) {
        const pat = ruleNorm(p.pattern);
        const src = edge(pat, L) + '(?:' + pat + ')' + PREFIX_TAIL;
        if (ok(src, 'iu', 'prefix ' + p.id) && fast(src, 'iu', 'prefix ' + p.id)) { P.prefixes.push({ src, need: needs(src), sev: p.sev || 2, tags: p.tags || [], groups: p.groups || null, id: p.id }); P.count++; }
      }
      for (let s of d.slurs || []) {
        s = Object.assign({}, s, { word: ruleNorm(s.word) });
        const open = NOSPACE.test(s.word);   // no word boundaries in scripts without spaces
        if (open) s.anyLeft = true;
        const tk = slurTokens(s), body = tk.join('');
        // The search pattern and the whole-word pattern wrap the same body in self-contained pieces,
        // so one is valid exactly when the other is: validate the whole-word one, build the other on demand.
        const full = '^(?:' + body + ')$';
        let valid = true;
        try { const re = new RegExp(full, 'iu'); if (made) made.set('iu/' + full, re); }
        catch (err) {
          valid = false;
          try { new RegExp((s.anyLeft ? '' : L) + '(?:' + body + ')' + (open ? '' : RL), 'giu'); } catch (e2) { bad.push('slur ' + s.word + ': ' + e2.message); }
          bad.push('slur ' + s.word + ': ' + err.message);
        }
        if (!valid) continue;
        P.slurs.push({ body, cat: s.cat, sev: s.sev || 3, id: 'slur:' + s.word, anyLeft: !!s.anyLeft, open, first: slurFirst(s) }); P.count++;
        if (!s.anyLeft) toks.push(tk);
        // A slur can also be the subject of a claim ("<slur> cannot be trusted").
        const w = String(s.word).toLowerCase().trim();
        if (s.cat && s.cat !== 'slurs') { (byCat[s.cat] = byCat[s.cat] || new Set()).add(w); byCat[s.cat].add(/o$/.test(w) ? w + 'es' : w + 's'); }
      }
      for (const p of d.phrases || []) {
        const src0 = p.literal ? reEsc(ruleNorm(p.pattern).toLowerCase().trim()).replace(/\s+/g, '\\s+') : ruleNorm(p.pattern);
        const src = p.raw ? src0 : edge(src0, L) + '(?:' + src0 + ')' + edge(src0, R);
        if (ok(src, 'giu', 'phrase ' + (p.id || p.pattern)) && fast(src, 'giu', 'phrase ' + (p.id || p.pattern))) { P.phrases.push({ src, need: needs(src), cats: p.cats || [p.cat || 'dehumanising'], sev: p.sev || 2, id: p.id || ('phrase:' + p.pattern) }); P.count++; }
      }
      for (const a of d.allow || []) {
        const pat = ruleNorm(a);
        const src = edge(pat, L) + '(?:' + pat + ')' + edge(pat, R);
        if (ok(src, 'giu', 'allow ' + a) && fast(src, 'giu', 'allow ' + a)) P.allow.push({ src, need: needs(src) });
      }
    }

    for (const [cat, set] of Object.entries(byCat)) {
      const all = [...set].filter(Boolean).sort((a, b) => b.length - a.length);
      // "trans-shipment", "gay-friendly": a hyphen joins the word to something else.
      const terms = all.filter(t => !NOSPACE.test(t)), open = all.filter(t => NOSPACE.test(t));
      // One huge regex takes ~100 ms for the browser to compile on its first use, in one go. Chunks of a few
      // hundred terms (whole first-word families kept together) compile in short tasks instead.
      const fam = new Map();
      for (const t of terms) { const k = t.split(/\s+/)[0]; if (!fam.has(k)) fam.set(k, []); fam.get(k).push(t); }
      const chunks = [];
      let cur = [];
      for (const f of fam.values()) { if (cur.length && cur.length + f.length > 250) { chunks.push(cur); cur = []; } cur.push(...f); }
      if (cur.length) chunks.push(cur);
      for (const ch of chunks) {
        const src = L + '(?:' + trieSource(ch.map(charTokens)) + ')(?![\\p{L}]|-\\p{L})';
        if (ok(src, 'giu', 'groups ' + cat)) { P.groups.push({ src, cat }); P.count += ch.length; }
      }
      if (open.length) {   // Chinese, Japanese, Thai...: no boundaries
        const src = '(?:' + trieSource(open.map(charTokens)) + ')';
        if (ok(src, 'giu', 'groups ' + cat)) { P.groups.push({ src, cat }); P.count += open.length; }
      }
    }
    if (toks.length) {
      // The slur index is split like the group words: one 46 KB regex cost ~140 ms to compile in one go.
      const fam = new Map();
      for (const tk of toks) { const k = tk[0]; if (!fam.has(k)) fam.set(k, []); fam.get(k).push(tk); }
      let cur = [];
      const flushIdx = () => { if (!cur.length) return; const src = L + '(?:' + trieSource(cur) + ')' + RL; if (ok(src, 'giu', 'slur index')) P.slurIdx.push(src); cur = []; };
      for (const f of fam.values()) { if (cur.length && cur.length + f.length > 24) flushIdx(); cur.push(...f); }
      flushIdx();
    }
    return P;
  }

  /* Text a match must contain: a list of lower-case strings of which at least one occurs in the
   * lower-cased text, or null when the pattern gives no such guarantee. Only plain a-z 0-9 ' count:
   * for those, case-insensitive matching on normalised text equals includes() on its toLowerCase().
   * Lets scan skip a rule (and V8 skip compiling it) without changing what it can match. */
  function needs(src) {
    let i = 0;
    const LIT = /^[a-z0-9']$/;
    const score = set => set ? Math.min(...set.map(x => x.length)) * 100 - set.length : -1;
    const skipClass = () => { i++; while (i < src.length && src[i] !== ']') i += src[i] === '\\' ? 2 : 1; i++; };
    const skipBraces = () => { if (src[i] === '{') { while (i < src.length && src[i] !== '}') i++; i++; } };
    function quant() {   // minimum repeat count of the atom just read (1 when unquantified)
      const c = src[i];
      let min = 1, q = false;
      if (c === '*' || c === '?') { min = 0; q = true; i++; }
      else if (c === '+') { q = true; i++; }
      else if (c === '{') { const m = /^\{(\d+)(,\d*)?\}/.exec(src.slice(i)); if (m) { min = +m[1]; q = true; i += m[0].length; } }
      if (q && src[i] === '?') i++;
      return { min, q };
    }
    function alt() {
      const sets = [seq()];
      while (src[i] === '|') { i++; sets.push(seq()); }
      if (sets.some(s => !s)) return null;
      const all = [...new Set([].concat(...sets))];
      return all.length <= 300 ? all : null;
    }
    function seq() {
      let best = null, run = '';
      const take = set => { if (score(set) > score(best)) best = set; };
      const flush = () => { if (run) take([run]); run = ''; };
      while (i < src.length && src[i] !== '|' && src[i] !== ')') {
        const c = src[i];
        let lit = null, set = null;
        if (c === '\\') {
          const d = src[i + 1]; i += 2;
          if (d === 'p' || d === 'P' || d === 'u' && src[i] === '{') skipBraces();
          else if (d === 'u') i += 4;
          else if (d === 'x') i += 2;
          else if (d === 'c') i += 1;
          else if (d === 'k') { while (i < src.length && src[i] !== '>') i++; i++; }
          else if (/[^a-zA-Z0-9]/.test(d)) lit = d;     // escaped punctuation is itself
        } else if (c === '[') skipClass();
        else if (c === '(') {
          i++;
          let look = false;
          if (src[i] === '?') {
            if (src[i + 1] === ':') i += 2;
            else if (src[i + 1] === '=' || src[i + 1] === '!') { i += 2; look = true; }
            else if (src[i + 1] === '<' && (src[i + 2] === '=' || src[i + 2] === '!')) { i += 3; look = true; }
            else if (src[i + 1] === '<') { while (i < src.length && src[i] !== '>') i++; i++; }
            else throw new Error('group');
          }
          const inner = alt();
          if (src[i] !== ')') throw new Error('paren');
          i++;
          if (!look) set = inner;
        } else if (c === '.' || c === '^' || c === '$') i++;
        else { lit = c.toLowerCase(); i++; }
        const q = quant();
        if (lit != null && LIT.test(lit)) {
          if (q.min >= 1) run += lit;
          if (q.q) flush();
        } else {
          flush();
          if (set && q.min >= 1) take(set);
        }
      }
      flush();
      return best;
    }
    try {
      const r = alt();
      return i === src.length ? r : null;
    } catch (err) { return null; }
  }

  // RegExps are built on first use: with the needs() pre-check most rules never run on a given page,
  // and building plus compiling a \p{L} pattern costs V8 about a millisecond each.
  // Only reached with sources prepare() already validated; a pattern that still fails matches nothing.
  function lazyRe(src, flags) { try { return new RegExp(src, flags); } catch (err) { return /(?!)/; } }
  const take = (made, src, flags) => {
    const k = flags + '/' + src, re = made && made.get(k);
    if (re) made.delete(k);
    return re || null;
  };
  class Rule {
    constructor(d, flags, made) { Object.assign(this, d); this.flags = flags; this._re = take(made, d.src, flags); }
    get re() { return this._re || (this._re = lazyRe(this.src, this.flags)); }
  }
  class Slur {
    constructor(d, made) {
      this.cat = d.cat; this.sev = d.sev; this.id = d.id; this.anyLeft = d.anyLeft; this.open = !!d.open; this.body = d.body; this.first = d.first;
      this._full = take(made, '^(?:' + d.body + ')$', 'iu');
      this._re = null;
    }
    get full() { return this._full || (this._full = lazyRe('^(?:' + this.body + ')$', 'iu')); }
    get re() { return this._re || (this._re = lazyRe((this.anyLeft ? '' : L) + '(?:' + this.body + ')' + (this.open ? '' : RL), 'giu')); }
  }

  /* Merge several packs (or the result of prepare) into one compiled matcher. */
  function compile(input) {
    let P, made = null;
    if (input && !Array.isArray(input) && input.bnetPrepared != null) {
      P = input.bnetPrepared === PREPARED ? input
        : { groups: [], preds: [], prefixes: [], slurs: [], slurIdx: [], phrases: [], allow: [], count: 0, errors: ['prepared rules are from another BNet version: prepare them again'] };
    } else { made = new Map(); P = prepare(input, made); }
    const bad = P.errors.slice();
    const groups = [];
    for (const g of P.groups) {
      // Groups stay eager: every page runs them, and the service worker reads .re directly.
      let re = take(made, g.src, 'giu');
      if (!re) try { re = new RegExp(g.src, 'giu'); } catch (err) { bad.push('groups ' + g.cat + ': ' + err.message); }
      if (re) groups.push({ re, cat: g.cat });
    }
    return {
      groups,
      preds: P.preds.map(p => new Rule(p, 'iu', made)),
      prefixes: P.prefixes.map(p => new Rule(p, 'iu', made)),
      slurs: P.slurs.map(d => new Slur(d, made)),
      slurIdx: (P.slurIdx || []).map(src => take(made, src, 'giu') || lazyRe(src, 'giu')),
      phrases: P.phrases.map(p => new Rule(p, 'giu', made)),
      allow: P.allow.map(a => new Rule(a, 'giu', made)),
      spaced: /(?<![\p{L}])(?:\p{L}[\s._\-*]{1,2}){2,}\p{L}(?![\p{L}])/gu,
      count: P.count, errors: bad,
      firstMemo: new Map(), firstRes: new Map(), predsFor: {}, prefixesFor: {}
    };
  }
  const hasAny = (str, need) => { for (const n of need) if (str.includes(n)) return true; return false; };

  // Slurs (in rule order) whose first character class admits the first character of str.
  function slurCandidates(C, str) {
    const ch = str.length ? String.fromCodePoint(str.codePointAt(0)) : '';
    let list = C.firstMemo.get(ch);
    if (list) return list;
    list = [];
    for (const sl of C.slurs) {
      if (sl.first == null) { list.push(sl); continue; }
      if (!ch) continue;
      let re = C.firstRes.get(sl.first);
      if (!re) { re = lazyRe('^[' + sl.first + ']', 'iu'); C.firstRes.set(sl.first, re); }
      if (re.test(ch)) list.push(sl);
    }
    if (C.firstMemo.size < 5000) C.firstMemo.set(ch, list);
    return list;
  }
  // Rules that apply to a group category, in rule order (memoised per compiled matcher).
  function forCat(C, key, cat) {
    const memo = C[key + 'For'];
    return memo[cat] || (memo[cat] = C[key].filter(p => !p.groups || p.groups.includes(cat)));
  }

  const COUNTER = /(?:^|[^\p{L}])(?:hear|heard|hearing|hears|claim|claims|claimed|claiming|call|calls|called|calling|tell|tells|told|telling|accuse|accused|stop\s+(?:saying|calling|spreading|pretending|claiming|repeating|with)|stopped\s+(?:saying|calling)|myth|lie|false|untrue|not\s+true|wrong\s+to|bigots?|racists?|homophobes?|transphobes?|nazis?|people\s+who|some\s+(?:people|folks|idiots|trolls|bigots)\s+(?:say|said|claim|claimed|believe|think|insist|argue)|idea\s+that|notion\s+that|stereotype|stereotypes|offensive|unacceptable|disgusting\s+to|sick\s+of\s+people|tired\s+of\s+people|why\s+do\s+people|don'?t\s+understand\s+why|no\s+one\s+should|nobody\s+should|never\s+say|it'?s\s+not\s+(?:ok|okay|fine|right)|isn'?t\s+(?:ok|okay|fine|right)|against\s+people|report|reported|quote|quoting)(?:[^\p{L}]|$)/u;

  // Reporting: news, court and research verbs in front of a claim.
  const REPORT = /(?:^|[^\p{L}])(?:shouted|yelled|screamed|chanted|wrote|written|posted|tweeted|tweets?\s+saying|saying\s+that|propaganda|graffiti|scrawled|daubed|labell?ed|deniers?|falsely|convicted\s+of|jailed\s+for|sentenced\s+for|charged\s+with|guilty\s+of|prosecutors?|the\s+court\s+heard|segregationists)(?:[^\p{L}]|$)/u;
  // A strong frame: the whole sentence is about the hate, not hate itself. Steps down one more level.
  const STRONG = /(?:^|[^\p{L}])(?:nazi\s+propaganda|propaganda\s+(?:claimed|said|portrayed|depicted|called)|falsely\s+(?:claim|claimed|claims|said|say|says)|deniers?|convicted\s+of|jailed\s+for|sentenced\s+for|prosecutors?\s+said|the\s+court\s+heard|pleaded\s+guilty|found\s+guilty|the\s+dataset|posts?\s+such\s+as|labell?ed\s+as)(?:[^\p{L}]|$)/u;
  // Judged after the claim: "... is a lie", "..., the report said".
  const JUDGED = /^[^\p{L}]{0,3}(?:\p{L}+\s+){0,3}?(?:is|was|are|were)\s+(?:a\s+lie|a\s+myth|false|untrue|not\s+true|nonsense|wrong|hateful|racist|bigoted|sexist|homophobic|disgusting|offensive|designed\s+to\s+stir)|^\s*[,"'”]*\s*(?:the\s+)?(?:report|reports|police|prosecutors|officials|the\s+court|witnesses|researchers|study|survey|un|critics|experts|analysts|campaigners|activists|historians|scholars)\s+(?:said|says|found|reported|heard|warn|warned|argue|argued|note|noted)|(?:evidence|history|the\s+facts|research|records)\s+(?:proves?|shows?|showed)\s+(?:them|this|that|it|otherwise)|\b(?:debunked|disproven|refuted)\b/u;

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  /* opts: { minSev: 1..3, enabled: Set|array of category ids } */
  function scan(compiled, text, opts) {
    opts = opts || {};
    const minSev = opts.minSev || 2;
    const enabled = opts.enabled ? new Set(opts.enabled) : new Set(CAT_IDS);
    if (!compiled || !text || text.length < 2) return [];
    const { norm, s, e } = normalize(text);
    const lower = norm.toLowerCase();   // for the needs() pre-checks only
    const raw = [];

    // Allow ranges
    const allowed = [];
    for (const a of compiled.allow) {
      if (a.need && !hasAny(lower, a.need)) continue;
      const re = a.re;
      re.lastIndex = 0; let m;
      while ((m = re.exec(norm))) { allowed.push({ start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; }
    }

    // A disguised slur still needs real letters: "480" is a number, not a slur.
    const lettery = w => { const n = (w.match(/\p{L}/gu) || []).length; return n >= 2 || n * 2 >= w.length; };
    // Slurs: one prefix-tree pass finds bounded slurs; slurs allowed inside words run on their own.
    // Matches from every index chunk, kept leftmost-longest and non-overlapping, as one index regex would.
    const sm0 = [];
    for (const re of compiled.slurIdx || []) {
      re.lastIndex = 0; let x;
      while ((x = re.exec(norm))) { sm0.push({ index: x.index, 0: x[0] }); if (!x[0].length) re.lastIndex++; }
    }
    sm0.sort((a, b) => a.index - b.index || b[0].length - a[0].length);
    let slurEnd = -1;
    for (const cm of sm0) {
      if (cm.index < slurEnd) continue;
      slurEnd = cm.index + cm[0].length;
      {
        const w = cm[0];
        // Only slurs that can start with w's first character are tried (same first match, far fewer tests).
        if (lettery(w)) for (const sl of slurCandidates(compiled, w)) {
          if (sl.anyLeft || !sl.full.test(w)) continue;
          raw.push({ start: cm.index, end: cm.index + w.length, cats: [...new Set([sl.cat, 'slurs'])], sev: sl.sev, rule: sl.id, kind: 'slur', word: sl.id.slice(5) });
          break;
        }
      }
    }
    for (const sl of compiled.slurs) {
      if (!sl.anyLeft) continue;
      sl.re.lastIndex = 0; let m;
      while ((m = sl.re.exec(norm))) {
        if (lettery(m[0])) raw.push({ start: m.index, end: m.index + m[0].length, cats: [...new Set([sl.cat, 'slurs'])], sev: sl.sev, rule: sl.id, kind: 'slur', word: sl.id.slice(5) });
        if (!m[0].length) sl.re.lastIndex++;
      }
    }
    // Spaced-out letters: "n i g g e r"
    compiled.spaced.lastIndex = 0; let sm;
    while ((sm = compiled.spaced.exec(norm))) {
      const joined = sm[0].replace(/[\s._\-*]/g, '');
      for (const sl of slurCandidates(compiled, joined)) {
        if (sl.full.test(joined)) { raw.push({ start: sm.index, end: sm.index + sm[0].length, cats: [sl.cat, 'slurs'], sev: sl.sev, rule: sl.id + ':spaced', kind: 'slur', word: sl.id.slice(5) }); break; }
      }
    }
    // Phrases
    for (const ph of compiled.phrases) {
      if (ph.need && !hasAny(lower, ph.need)) continue;
      const re = ph.re;
      re.lastIndex = 0; let m;
      while ((m = re.exec(norm))) {
        raw.push({ start: m.index, end: m.index + m[0].length, cats: ph.cats.slice(), sev: ph.sev, rule: ph.id, kind: 'phrase' });
        if (!m[0].length) re.lastIndex++;
      }
    }
    // Group + predicate / prefix + group
    // Group words: each category may be split over several regexes (smaller regexes compile in short tasks).
    // Collect every match, then keep them leftmost-longest and non-overlapping per category, exactly as one
    // regex per category would.
    const gm = [];
    for (const g of compiled.groups) {
      g.re.lastIndex = 0; let mm;
      while ((mm = g.re.exec(norm))) { gm.push({ index: mm.index, 0: mm[0], g }); if (!mm[0].length) g.re.lastIndex++; }
    }
    gm.sort((a, b) => a.index - b.index || b[0].length - a[0].length);
    const groupEnd = {};
    for (const m of gm) {
      const g = m.g;
      if (groupEnd[g.cat] != null && m.index < groupEnd[g.cat]) continue;
      groupEnd[g.cat] = m.index + m[0].length;
      {
        const gs = m.index, ge = m.index + m[0].length;
        const after = norm.slice(ge, ge + 160), afterL = after.toLowerCase();
        let best = null;
        const preds = forCat(compiled, 'preds', g.cat);
        for (const p of preds) {
          if (p.need && !hasAny(afterL, p.need)) continue;
          const pm = p.re.exec(after);
          if (!pm) continue;
          // A new subject between the group and the claim means the claim is about someone else:
          // "Muslims, he said, are…" is fine, "women's rights? I smell…" is not.
          if (pm[1] && SUBJECT_SWITCH.test(pm[1])) continue;
          const gap = pm[1].length;
          let sev = p.sev - (gap > 24 ? 1 : 0);
          const end = ge + pm[0].length;
          if (!best || sev > best.sev || (sev === best.sev && end > best.end)) {
            best = { start: gs, end, cats: [g.cat].concat(p.tags), sev, rule: p.id, kind: 'claim', pred: p.id, gs, ge, gcat: g.cat };
          }
        }
        const before = norm.slice(Math.max(0, gs - 48), gs);
        // Every prefix rule ends in whitespace right before the group word.
        const beforeL = before.toLowerCase();
        if (before && /\s/.test(before[before.length - 1])) for (const p of forCat(compiled, 'prefixes', g.cat)) {
          if (p.need && !hasAny(beforeL, p.need)) continue;
          const pm = p.re.exec(before);
          if (!pm) continue;
          const start = gs - (before.length - pm.index);
          const cand = { start, end: ge, cats: [g.cat].concat(p.tags), sev: p.sev, rule: p.id, kind: 'prefix', pre: p.id, gs, ge, gcat: g.cat };
          if (best && overlaps(best, cand)) {
            best = Object.assign({}, best, { start: Math.min(best.start, start), cats: [...new Set(best.cats.concat(cand.cats))], sev: Math.max(best.sev, p.sev), rule: best.rule + '+' + p.id, pre: p.id });
          } else if (!best || p.sev > best.sev) best = cand;
        }
        // "<group> are X and they should be Y": the pronoun carries the claim on.
        if (best) {
          for (let hop = 0; hop < 3; hop++) {
            const rest = norm.slice(best.end, best.end + 200);
            const link = rest.match(/^[^.!?\n]{0,40}?(?:,|\band\b|\bbut\b|\bso\b|\bwho\b|\bthat\b)\s+(?:(?:they|them|these\s+people|those\s+people)\s*(?:'re\b)?)?\s*/u);
            if (!link) break;
            const tail = norm.slice(best.end + link[0].length - 1, best.end + 200), tailL = tail.toLowerCase();
            let ext = null;
            for (const p of preds) {
              if (p.need && !hasAny(tailL, p.need)) continue;
              const pm = p.re.exec(tail);
              if (pm && pm[1].length <= 2) { if (!ext || p.sev > ext.sev) ext = { len: pm[0].length, sev: p.sev, tags: p.tags }; }
            }
            if (!ext) break;
            best.end = best.end + link[0].length - 1 + ext.len;
            best.cats = [...new Set(best.cats.concat(ext.tags))];
            best.sev = Math.max(best.sev, ext.sev);
          }
          raw.push(best);
        }
      }
    }

    // Counter-speech and reporting ("I hear that…", "stop saying…", "it's a myth that…") step claims down one level.
    // Slurs are left alone: the word itself is what people do not want to see.
    for (const r of raw) {
      if (!r.rule || r.rule.startsWith('slur:')) continue;
      let a = r.start;
      while (a > 0 && !/[.!?\n]/.test(norm[a - 1])) a--;
      const before = norm.slice(a, r.start);
      if (COUNTER.test(before) || REPORT.test(before)) { r.sev -= 1; r.countered = true; }
      // A news, court or research frame, or a verdict after the claim, steps it down once more.
      let b = r.end;
      while (b < norm.length && !/[.!?\n]/.test(norm[b])) b++;
      if (STRONG.test(before) || JUDGED.test(norm.slice(r.end, b))) r.sev -= 1;
    }

    // Filter by allow, severity, categories
    const kept = raw.filter(r => {
      if (r.sev < minSev) return false;
      if (allowed.some(a => overlaps(a, r))) return false;
      return r.cats.some(c => enabled.has(c));
    });

    const pick = r => ({ kind: r.kind, word: r.word, pred: r.pred, pre: r.pre, gs: r.gs, ge: r.ge, gcat: r.gcat });
    // Merge overlaps
    kept.sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];
    for (const r of kept) {
      const last = merged[merged.length - 1];
      if (last && r.start < last.end) {
        last.end = Math.max(last.end, r.end);
        last.cats = [...new Set(last.cats.concat(r.cats))];
        last.sev = Math.max(last.sev, r.sev);
        if (!last.rule.includes(r.rule)) last.rule += ' | ' + r.rule;
        if (r.sev > (last.lead || 0) && r.kind) { last.lead = r.sev; Object.assign(last, pick(r)); }
      } else merged.push(Object.assign({ ...r, cats: r.cats.slice(), lead: r.sev }, pick(r)));
    }

    // Map back to original indices, trimming whitespace
    return merged.map(r => {
      let start = s[r.start], end = e[r.end - 1];
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      const cats = r.cats.filter(c => CAT_IDS.includes(c));
      const out = { start, end, text: text.slice(start, end), cats, primary: cats.find(c => enabled.has(c)) || cats[0], sev: r.sev, rule: r.rule, kind: r.kind || 'phrase' };
      if (r.word) out.word = r.word;
      if (r.pred) out.pred = r.pred;
      if (r.pre) out.pre = r.pre;
      const inner = raw.filter(x => x.kind === 'slur' && x.start >= r.start && x.end <= r.end && !(x.start === r.start && x.end === r.end))
        .map(x => [s[x.start] - start, e[x.end - 1] - start]).filter(([a, b]) => a >= 0 && b <= end - start);
      if (inner.length) out.inner = inner.sort((a, b) => b[0] - a[0]).filter((x, i, arr) => !i || x[1] <= arr[i - 1][0]);
      if ((r.kind === 'claim' || r.kind === 'prefix') && raw.some(x => x.kind === 'slur' && x.start >= r.gs && x.end <= r.ge)) out.groupSlur = true;
      if (r.gs != null && r.kind !== 'slur') {
        const a = s[r.gs], b = e[r.ge - 1];
        if (a >= start && b <= end) { out.group = text.slice(a, b); out.groupAt = a - start; out.gcat = r.gcat; }
      }
      return out;
    }).filter(r => r.end > r.start);
  }

  function expandToSentence(text, span) {
    let a = span.start, b = span.end;
    while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--;
    while (b < text.length && !/[.!?\n]/.test(text[b])) b++;
    if (b < text.length) b++;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    return { ...span, start: a, end: b, text: text.slice(a, b) };
  }

  const SEV_FOR_DIAL = { 1: 3, 2: 2, 3: 1 };

  /* The browser compiles a regex on its first runs. warmSteps(compiled) returns small jobs, one regex each,
     that a caller can run in separate tasks so that cost never lands in one long task. */
  function warmSteps(compiled) {
    const sample = 'warm up text: people are fine, see you at 5pm. immigrants women muslims jews gays disabled';
    const res = [...(compiled.groups || []).map(g => g.re), ...(compiled.slurIdx || []), compiled.spaced].filter(Boolean);
    return res.map(re => () => { for (let k = 0; k < 3; k++) { re.lastIndex = 0; if (re.global) { while (re.exec(sample)) { if (!re.lastIndex) break; } } else re.test(sample); } });
  }

  const api = { CATEGORIES, CAT_IDS, normalize, normKey, prepare: packs => prepare(packs, null, true), PREPARED, compile, scan, warmSteps, expandToSentence, SEV_FOR_DIAL, escape: reEsc };
  root.BNetEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

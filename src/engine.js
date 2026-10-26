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

  /* Normalise per code point, keeping a map from each normalised unit back to the original. */
  function normalize(text) {
    let norm = '';
    const s = [], e = [];
    let i = 0;
    for (const ch of text) {
      const at = i; i += ch.length;
      if (ZW.test(ch)) continue;
      let p = QUOTES[ch] || ch.toLowerCase().normalize('NFKD').replace(MARKS, '');
      if (p.length === 1 && HOMO[p]) p = HOMO[p];
      if (!p) continue;
      for (let k = 0; k < p.length; k++) { norm += p[k]; s.push(at); e.push(at + ch.length); }
    }
    return { norm, s, e };
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
      const keys = [...node.keys()].filter(k => k !== END);
      if (!keys.length) return '';
      const end = node.has(END);
      const parts = keys.map(k => k + emit(node.get(k)));
      if (parts.length === 1 && !end) return parts[0];
      return '(?:' + parts.join('|') + ')' + (end ? '?' : '');
    };
    return emit(root);
  }
  const charTokens = term => {
    const out = [];
    for (const ch of term) out.push(/[\s-]/.test(ch) ? '[\\s-]+' : reEsc(ch));
    return out.filter((t, i, a) => !(t === '[\\s-]+' && a[i - 1] === '[\\s-]+'));
  };
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

  function wordPattern(word) {
    const runs = [];
    for (const ch of word) {
      if (runs.length && runs[runs.length - 1].ch === ch) runs[runs.length - 1].n++;
      else runs.push({ ch, n: 1 });
    }
    // A letter matches its own count, or a deliberate stretch of 3+ extra ("niiigger"), never one extra ("woops").
    return runs.map(r => {
      const cls = '[' + clsEsc(LEET[r.ch] || r.ch) + ']';
      return '(?:' + cls + '{' + r.n + '}|' + cls + '{' + (r.n + 2) + ',})';
    }).join(SEP);
  }
  function slurPattern(entry) {
    const w = String(entry.word).toLowerCase().trim();
    const parts = w.split(/[\s-]+/).map(wordPattern);
    return parts.join("[\\s._\\-*]*") + (/o$/.test(w) ? '(?:e?s)?' : '(?:s|z)?');
  }

  const L = '(?<![\\p{L}\\p{N}])';
  const R = '(?![\\p{L}\\p{N}])';
  const RL = '(?![\\p{L}])';

  function tryRe(src, flags, bad, label) {
    try { return new RegExp(src, flags); } catch (err) { bad.push(label + ': ' + err.message); return null; }
  }

  /* Merge several packs into one compiled matcher. */
  function compile(packs) {
    const bad = [];
    const groups = [];      // {re, cat}
    const preds = [];       // {re, sev, tags, groups, id}
    const prefixes = [];    // {re, sev, tags, groups, id}
    const slurs = [];       // {re, full, cat, sev, id}
    const phrases = [];     // {re, cats, sev, id}
    const allow = [];       // re
    const byCat = {};
    let count = 0;

    for (const pack of packs) {
      if (!pack || pack.enabled === false) continue;
      const d = pack.data || pack;
      for (const [cat, terms] of Object.entries(d.groups || {})) {
        (byCat[cat] = byCat[cat] || new Set());
        for (const t of terms || []) byCat[cat].add(String(t).toLowerCase().trim());
      }
      for (const p of d.predicates || []) {
        const re = tryRe('^([^.!?\\n;]{0,42}?)' + L + '(?:' + p.pattern + ')' + RL, 'iu', bad, 'predicate ' + p.id);
        if (re) { preds.push({ re, sev: p.sev || 2, tags: p.tags || [], groups: p.groups || null, id: p.id }); count++; }
      }
      for (const p of d.prefixes || []) {
        const re = tryRe(L + '(?:' + p.pattern + ")\\s+(?:(?:all|the|these|those|every|any|them|filthy|dirty|stinking|fucking|f\\*+ing|bloody|damn|of|you|single|last|one|other|such|those|goddamn|lousy|stupid)\\s+)*$", 'iu', bad, 'prefix ' + p.id);
        if (re) { prefixes.push({ re, sev: p.sev || 2, tags: p.tags || [], groups: p.groups || null, id: p.id }); count++; }
      }
      for (const s of d.slurs || []) {
        const body = slurPattern(s);
        const left = s.anyLeft ? '' : L;
        const re = tryRe(left + '(?:' + body + ')' + RL, 'giu', bad, 'slur ' + s.word);
        const full = tryRe('^(?:' + body + ')$', 'iu', bad, 'slur ' + s.word);
        if (re && full) {
          slurs.push({ re, full, cat: s.cat, sev: s.sev || 3, id: 'slur:' + s.word, anyLeft: !!s.anyLeft, toks: slurTokens(s) }); count++;
          // A slur can also be the subject of a claim ("<slur> cannot be trusted").
          const w = String(s.word).toLowerCase().trim();
          if (s.cat && s.cat !== 'slurs') { (byCat[s.cat] = byCat[s.cat] || new Set()).add(w); byCat[s.cat].add(/o$/.test(w) ? w + 'es' : w + 's'); }
        }
      }
      for (const p of d.phrases || []) {
        const src = p.literal ? reEsc(String(p.pattern).toLowerCase().trim()).replace(/\s+/g, '\\s+') : p.pattern;
        const re = tryRe(p.raw ? src : L + '(?:' + src + ')' + R, 'giu', bad, 'phrase ' + (p.id || p.pattern));
        if (re) { phrases.push({ re, cats: p.cats || [p.cat || 'dehumanising'], sev: p.sev || 2, id: p.id || ('phrase:' + p.pattern) }); count++; }
      }
      for (const a of d.allow || []) {
        const re = tryRe(L + '(?:' + a + ')' + R, 'giu', bad, 'allow ' + a);
        if (re) allow.push(re);
      }
    }

    for (const [cat, set] of Object.entries(byCat)) {
      const terms = [...set].filter(Boolean).sort((a, b) => b.length - a.length);
      if (!terms.length) continue;
      const re = tryRe(L + '(?:' + trieSource(terms.map(charTokens)) + ')' + RL, 'giu', bad, 'groups ' + cat);
      if (re) { groups.push({ re, cat }); count += terms.length; }
    }

    const spaced = /(?<![\p{L}])(?:\p{L}[\s._\-*]{1,2}){2,}\p{L}(?![\p{L}])/gu;
    let slurAny = null;
    const bounded = slurs.filter(x => !x.anyLeft);
    if (bounded.length) slurAny = tryRe(L + '(?:' + trieSource(bounded.map(x => x.toks)) + ')' + RL, 'giu', bad, 'slur index');
    return { groups, preds, prefixes, slurs, slurAny, phrases, allow, spaced, count, errors: bad };
  }

  const COUNTER = /(?:^|[^\p{L}])(?:hear|heard|hearing|hears|claim|claims|claimed|claiming|call|calls|called|calling|tell|tells|told|telling|accuse|accused|stop|stopped|myth|lie|false|untrue|not\s+true|wrong\s+to|bigots?|racists?|homophobes?|transphobes?|nazis?|people\s+who|idea\s+that|notion\s+that|stereotype|stereotypes|offensive|unacceptable|disgusting\s+to|sick\s+of\s+people|tired\s+of\s+people|why\s+do\s+people|don'?t\s+understand\s+why|no\s+one\s+should|nobody\s+should|never\s+say|it'?s\s+not\s+(?:ok|okay|fine|right)|isn'?t\s+(?:ok|okay|fine|right)|against\s+people|report|reported|quote|quoting)(?:[^\p{L}]|$)/u;

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  /* opts: { minSev: 1..3, enabled: Set|array of category ids } */
  function scan(compiled, text, opts) {
    opts = opts || {};
    const minSev = opts.minSev || 2;
    const enabled = opts.enabled ? new Set(opts.enabled) : new Set(CAT_IDS);
    if (!compiled || !text || text.length < 2) return [];
    const { norm, s, e } = normalize(text);
    const raw = [];

    // Allow ranges
    const allowed = [];
    for (const re of compiled.allow) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(norm))) { allowed.push({ start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; }
    }

    // Slurs: one prefix-tree pass finds bounded slurs; slurs allowed inside words run on their own.
    if (compiled.slurAny) {
      compiled.slurAny.lastIndex = 0; let cm;
      while ((cm = compiled.slurAny.exec(norm))) {
        const w = cm[0];
        for (const sl of compiled.slurs) {
          if (sl.anyLeft || !sl.full.test(w)) continue;
          raw.push({ start: cm.index, end: cm.index + w.length, cats: [...new Set([sl.cat, 'slurs'])], sev: sl.sev, rule: sl.id, kind: 'slur', word: sl.id.slice(5) });
          break;
        }
        if (!w.length) compiled.slurAny.lastIndex++;
      }
    }
    for (const sl of compiled.slurs) {
      if (!sl.anyLeft) continue;
      sl.re.lastIndex = 0; let m;
      while ((m = sl.re.exec(norm))) {
        raw.push({ start: m.index, end: m.index + m[0].length, cats: [...new Set([sl.cat, 'slurs'])], sev: sl.sev, rule: sl.id, kind: 'slur', word: sl.id.slice(5) });
        if (!m[0].length) sl.re.lastIndex++;
      }
    }
    // Spaced-out letters: "n i g g e r"
    compiled.spaced.lastIndex = 0; let sm;
    while ((sm = compiled.spaced.exec(norm))) {
      const joined = sm[0].replace(/[\s._\-*]/g, '');
      for (const sl of compiled.slurs) {
        if (sl.full.test(joined)) { raw.push({ start: sm.index, end: sm.index + sm[0].length, cats: [sl.cat, 'slurs'], sev: sl.sev, rule: sl.id + ':spaced', kind: 'slur', word: sl.id.slice(5) }); break; }
      }
    }
    // Phrases
    for (const ph of compiled.phrases) {
      ph.re.lastIndex = 0; let m;
      while ((m = ph.re.exec(norm))) {
        raw.push({ start: m.index, end: m.index + m[0].length, cats: ph.cats.slice(), sev: ph.sev, rule: ph.id, kind: 'phrase' });
        if (!m[0].length) ph.re.lastIndex++;
      }
    }
    // Group + predicate / prefix + group
    for (const g of compiled.groups) {
      g.re.lastIndex = 0; let m;
      while ((m = g.re.exec(norm))) {
        const gs = m.index, ge = m.index + m[0].length;
        const after = norm.slice(ge, ge + 160);
        let best = null;
        for (const p of compiled.preds) {
          if (p.groups && !p.groups.includes(g.cat)) continue;
          const pm = p.re.exec(after);
          if (!pm) continue;
          const gap = pm[1].length;
          let sev = p.sev - (gap > 24 ? 1 : 0);
          const end = ge + pm[0].length;
          if (!best || sev > best.sev || (sev === best.sev && end > best.end)) {
            best = { start: gs, end, cats: [g.cat].concat(p.tags), sev, rule: p.id, kind: 'claim', pred: p.id, gs, ge, gcat: g.cat };
          }
        }
        const before = norm.slice(Math.max(0, gs - 48), gs);
        for (const p of compiled.prefixes) {
          if (p.groups && !p.groups.includes(g.cat)) continue;
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
            const tail = norm.slice(best.end + link[0].length - 1, best.end + 200);
            let ext = null;
            for (const p of compiled.preds) {
              if (p.groups && !p.groups.includes(g.cat)) continue;
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
        if (!m[0].length) g.re.lastIndex++;
      }
    }

    // Counter-speech and reporting ("I hear that…", "stop saying…", "it's a myth that…") step claims down one level.
    // Slurs are left alone: the word itself is what people do not want to see.
    for (const r of raw) {
      if (!r.rule || r.rule.startsWith('slur:')) continue;
      let a = r.start;
      while (a > 0 && !/[.!?\n]/.test(norm[a - 1])) a--;
      const before = norm.slice(a, r.start);
      if (COUNTER.test(before)) { r.sev -= 1; r.countered = true; }
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

  const api = { CATEGORIES, CAT_IDS, normalize, normKey, compile, scan, expandToSentence, SEV_FOR_DIAL, escape: reEsc };
  root.BNetEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

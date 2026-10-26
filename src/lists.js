/* BNet rule lists: a plain-text, one-rule-per-line format in the spirit of ad-blocker filter lists.
 *
 *   ! Title: BNet Core            header fields (Title, Version, Description, Homepage, Expires)
 *   ! anything else after ! is a comment; "rule ! note" adds a note to a rule
 *   define COP (?:are|is)\s+      reusable regex piece, used as {COP} in later rules of the same list
 *   group racism immigrants, migrants, refugees
 *   slur racism 3 wetback, beaner              $inword lets it match inside words (e.g. "sandn...")
 *   phrase racism 2 go back to your country    plain text: spaces match any spacing
 *   phrase extremism,religion 3 /holo\s*hoax/  regex between slashes; $raw = no word boundaries
 *   claim 3 /{COP}vermin/ $tag=dehumanising $for=racism,religion   what follows a group word
 *   before 3 /kill|gas/ $tag=extremism                               what comes right before one
 *   allow /chink\s+in\s+the\s+armou?r/        never mute this
 *
 * Severity: 3 unmistakable, 2 clear hate, 1 borderline. Categories: racism religion sexism lgbtq
 * ableism slurs dehumanising extremism political. */
(function (root) {
  'use strict';
  const CATS = ['racism', 'religion', 'sexism', 'lgbtq', 'ableism', 'slurs', 'dehumanising', 'extremism', 'political'];
  const TYPES = ['define', 'group', 'slur', 'phrase', 'claim', 'before', 'allow'];
  const escape = s => s.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');

  function splitOptions(rest) {
    const opts = {};
    const m = rest.match(/((?:\s+\$[a-z]+(?:=[^\s$]+)?)+)\s*$/i);
    if (m) {
      rest = rest.slice(0, m.index);
      for (const part of m[1].trim().split(/\s+/)) {
        const [k, v] = part.slice(1).split('=');
        opts[k.toLowerCase()] = v === undefined ? true : v;
      }
    }
    return { rest: rest.trim(), opts };
  }

  function patternOf(text, defs) {
    const t = text.trim();
    let src;
    if (t.length > 2 && t[0] === '/' && t[t.length - 1] === '/') src = t.slice(1, -1);
    else src = escape(t.toLowerCase()).replace(/\s+/g, '\\s+');
    return src.replace(/(?<!\\[pP])\{([A-Z][A-Z0-9_]+)\}/g, (all, name) => {
      if (!(name in defs)) throw new Error('unknown {' + name + '}');
      return defs[name];
    });
  }

  function catList(s) {
    const cats = String(s || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    for (const c of cats) if (!CATS.includes(c)) throw new Error('unknown category "' + c + '"');
    if (!cats.length) throw new Error('missing category');
    return cats;
  }
  function sevOf(s) {
    const n = Number(s);
    if (![1, 2, 3].includes(n)) throw new Error('severity must be 1, 2 or 3');
    return n;
  }
  function tagsOf(opts) { return opts.tag ? catList(opts.tag) : []; }

  // A careless or hostile regex such as (a+)+b can freeze every page it runs on, and a running regex
  // cannot be stopped. Rules from outside lists are timed on short probe strings first: inputs are kept
  // small enough that even an exploding pattern finishes in milliseconds, and the growth gives it away.
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function probeSeeds(src) {
    const words = (src.replace(/\\[pPu]\{[^}]*\}|\\./g, ' ').toLowerCase().match(/[a-z]{2,}/g) || []).slice(0, 2);
    const loops = [...new Set((src.toLowerCase().match(/[a-z](?=[+*{])/g) || []))].slice(0, 3);
    return ['a', 'a ', ' ', 'ab1', '1', '.', 'aa\'', ...loops, ...words.map(w => w + ' '), ...words];
  }
  // Rules are timed the way the engine runs them: claims anchored just after a group word, "before" rules
  // anchored at the end of the words before one, phrases and allows searched through the whole text.
  function wrapFor(kind, src) {
    if (kind === 'claim') return new RegExp('^[^.!?\\n;:]{0,42}?(?:' + src + ')', 'iu');
    if (kind === 'before') return new RegExp('(?:' + src + ')\\s*$', 'iu');
    return new RegExp(src, 'giu');
  }
  function tooSlow(src, kind) {
    let re;
    try { re = wrapFor(kind, src); } catch (e) { return false; }
    const once = s => { re.lastIndex = 0; const t = clock(); re.test(s); return clock() - t; };
    // The first run includes compiling the regex and a run can catch a garbage collection, so a slow
    // reading is confirmed once before it counts.
    const run = s => { const a = once(s); return a > 0.5 ? Math.min(a, once(s)) : a; };
    once('warm up the regex');
    for (const seed of probeSeeds(src)) {
      for (const n of [6, 10, 14, 18, 22]) if (run(seed.repeat(n) + '\u0001!') > 20) return true;
      // Polynomial blow-ups show as the line grows (pages hand the engine up to 20,000 characters):
      // double the length, stop as soon as one run is slow, and project the growth rate to 20,000.
      let prev = 0;
      for (let len = 50; len <= 3200; len *= 2) {
        const t = run(seed.repeat(Math.ceil(len / seed.length)) + '\u0001!');
        if (t > 25) return true;
        if (prev >= 1 && t * Math.pow(20000 / len, Math.log2(Math.max(1, t / prev))) > 300) return true;
        prev = t;
      }
    }
    return false;
  }
  // Static check, before any timing: a repeated group whose inside can itself repeat and holds no fixed
  // letter to anchor it, as in (a+)+, (\w+\s?)*, (x+x+){2,}. Such a group can split the same text in
  // exponentially many ways. "(?:all|just)\s+)*" stays allowed: every branch has a fixed word.
  function nestedQuantifier(src) {
    const stack = [{ loop: false, lit: true, branchLit: false }];
    const quantAt = i => {
      const c = src[i];
      if (c === '+' || c === '*') return 'many';
      if (c === '?') return 'opt';
      if (c === '{') { const m = src.slice(i).match(/^\{(\d+)(,(\d*))?\}/); if (m) return m[2] === undefined ? (+m[1] > 10 ? 'many' : 'one') : (m[3] === '' || +m[3] > 10 ? 'many' : 'opt'); } // {0,3} is a small, safe bound
      return null;
    };
    for (let i = 0; i < src.length; i++) {
      const c = src[i], top = stack[stack.length - 1];
      let atomEnd = i, literal = false;
      if (quantAt(i)) { if (c === '{') i = src.indexOf('}', i); continue; } // the repeat itself, already counted
      if (c === '\\') {
        const n = src[i + 1] || '';
        if (/[pPu]/.test(n) && src[i + 2] === '{') atomEnd = src.indexOf('}', i + 2);
        else if (n === 'x') atomEnd = i + 3;
        else { atomEnd = i + 1; literal = !/[dDwWsSbBnrtfv0-9]/.test(n); }
        if (/[bB]/.test(n)) { i = atomEnd; continue; }
      } else if (c === '[') {
        let j = i + 1;
        if (src[j] === '^') j++;
        if (src[j] === ']') j++;
        for (; j < src.length && src[j] !== ']'; j++) if (src[j] === '\\') j++;
        atomEnd = j;
      } else if (c === '(') {
        const look = /^\(\?<?[=!]/.test(src.slice(i));
        stack.push({ loop: false, lit: true, branchLit: false, look });
        const m = src.slice(i).match(/^\(\?(?::|<?[=!]|<[A-Za-z]\w*>)/);
        if (m) i += m[0].length - 1;
        continue;
      } else if (c === '|') {
        top.lit = top.lit && top.branchLit; top.branchLit = false;
        continue;
      } else if (c === ')') {
        const g = stack.pop();
        if (!stack.length) return false;
        g.lit = g.lit && g.branchLit;
        const q = quantAt(i + 1), parent = stack[stack.length - 1];
        if (q === 'many' && g.loop && !g.lit && !g.look) return true;
        if (q === 'many' || g.loop) parent.loop = true;
        if (!q && g.lit && !g.look) parent.branchLit = true;
        continue;
      } else if (c === '^' || c === '$') continue;
      else literal = c !== '.';
      i = atomEnd;
      const q = quantAt(i + 1);
      if (q === 'many') top.loop = true;
      if (!q && literal) top.branchLit = true;
    }
    return false;
  }

  function checkSpeed(pattern, opts, kind) {
    if (!opts || !opts.guard) return;
    if (nestedQuantifier(pattern)) throw new Error('a repeated group inside a repeated group, like (a+)+, can freeze pages; rewrite it without the outer repeat');
    if (tooSlow(pattern, kind)) throw new Error('this pattern is too slow to run safely; simplify it');
  }

  /* text -> { meta, data (engine pack), errors: [{line, text, message}], rules }
   * opts.guard: time each regex and skip slow ones (lists from outside BNet); opts.maxRules: stop after that many. */
  function parse(text, fallbackId, opts) {
    const popts = opts || {};
    const meta = {};
    const data = { format: 'bnet-pack/1', id: fallbackId || 'list', groups: {}, predicates: [], prefixes: [], slurs: [], phrases: [], allow: [] };
    const defs = {};
    const errors = [];
    let rules = 0;
    const lines = String(text || '').split(/\r?\n/);
    let capped = false;
    lines.forEach((raw, i) => {
      if (capped) return;
      if (popts.maxRules && rules >= popts.maxRules) {
        capped = true;
        errors.push({ line: i + 1, text: '', message: 'list is too long: rules from here on are ignored (limit ' + popts.maxRules + ')' });
        return;
      }
      // "rule ! note": a space, !, a space starts an inline comment.
      const line = (/^\s*[!#]/.test(raw) ? raw : raw.replace(/\s+!\s.*$/, '')).trim();
      if (!line) return;
      if (line[0] === '!' || line[0] === '#') {
        const h = line.match(/^!\s*([A-Za-z]+)\s*:\s*(.+)$/);
        if (h && ['title', 'version', 'description', 'homepage', 'expires'].includes(h[1].toLowerCase())) meta[h[1].toLowerCase()] = h[2].trim();
        return;
      }
      try {
        const sp = line.indexOf(' ');
        const type = (sp < 0 ? line : line.slice(0, sp)).toLowerCase();
        let rest = sp < 0 ? '' : line.slice(sp + 1);
        if (!TYPES.includes(type)) throw new Error('unknown rule type "' + type + '"');
        const id = 'L' + (i + 1);
        if (type === 'define') {
          const m = rest.match(/^([A-Z][A-Z0-9_]+)\s+(.+)$/);
          if (!m) throw new Error('write it as: define NAME regex');
          defs[m[1]] = patternOf('/' + m[2].trim().replace(/^\/|\/$/g, '') + '/', defs);
          return;
        }
        const o = splitOptions(rest);
        rest = o.rest;
        const opts = o.opts;
        const fields = rest.split(/\s+/);
        if (type === 'group') {
          const cat = catList(fields[0])[0];
          const terms = rest.slice(fields[0].length).split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          if (!terms.length) throw new Error('no words given');
          (data.groups[cat] = data.groups[cat] || []).push(...terms);
          rules += terms.length;
        } else if (type === 'slur') {
          const cat = catList(fields[0])[0], sev = sevOf(fields[1]);
          const words = rest.split(/\s+/).slice(2).join(' ').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
          if (!words.length) throw new Error('no words given');
          for (const w of words) data.slurs.push({ word: w, cat, sev, anyLeft: !!opts.inword });
          rules += words.length;
        } else if (type === 'phrase') {
          const cats = catList(fields[0]), sev = sevOf(fields[1]);
          const body = rest.split(/\s+/).slice(2).join(' ');
          if (!body) throw new Error('no phrase given');
          const pattern = patternOf(body, defs);
          new RegExp(pattern, 'iu');
          checkSpeed(pattern, popts);
          data.phrases.push({ id: opts.id || id, pattern, cats, sev, raw: !!opts.raw });
          rules++;
        } else if (type === 'claim' || type === 'before') {
          const sev = sevOf(fields[0]);
          const body = rest.split(/\s+/).slice(1).join(' ');
          if (!body) throw new Error('no pattern given');
          const pattern = patternOf(body, defs);
          new RegExp(pattern, 'iu');
          checkSpeed(pattern, popts, type);
          const r = { id: opts.id || id, sev, tags: tagsOf(opts), pattern };
          if (opts.for) r.groups = catList(opts.for);
          (type === 'claim' ? data.predicates : data.prefixes).push(r);
          rules++;
        } else if (type === 'allow') {
          if (!rest) throw new Error('no pattern given');
          const pattern = patternOf(rest, defs);
          new RegExp(pattern, 'iu');
          checkSpeed(pattern, popts);
          data.allow.push(pattern);
          rules++;
        }
      } catch (err) {
        errors.push({ line: i + 1, text: line.slice(0, 120), message: err.message });
      }
    });
    if (meta.title) data.name = meta.title;
    if (meta.version) data.version = meta.version;
    return { meta, data, errors, rules };
  }

  /* engine pack (JSON) -> text list. Used by the build tool and to convert old JSON packs. */
  function fromPack(pack, header) {
    const out = [];
    const h = Object.assign({ title: pack.name || pack.id, version: pack.version || '1', description: pack.description || '' }, header || {});
    out.push('! Title: ' + h.title, '! Version: ' + h.version);
    if (h.description) out.push('! Description: ' + h.description);
    if (h.expires) out.push('! Expires: ' + h.expires);
    out.push('');
    const lit = s => /^[\p{L}\p{N} '’&-]+$/u.test(s) ? s : null;
    const body = src => '/' + src + '/';
    if (pack.groups && Object.keys(pack.groups).length) {
      out.push('! Groups: who a hateful claim can be about');
      for (const [cat, terms] of Object.entries(pack.groups)) out.push('group ' + cat + ' ' + terms.join(', '));
      out.push('');
    }
    if ((pack.slurs || []).length) {
      out.push('! Slurs: plain spellings; disguised spellings are handled automatically');
      const byKey = {};
      for (const s of pack.slurs) {
        const k = s.cat + ' ' + s.sev + (s.anyLeft ? ' $inword' : '');
        (byKey[k] = byKey[k] || []).push(s.word);
      }
      for (const [k, words] of Object.entries(byKey)) {
        const [cat, sev, opt] = k.split(' ');
        out.push('slur ' + cat + ' ' + sev + ' ' + words.join(', ') + (opt ? ' ' + opt : ''));
      }
      out.push('');
    }
    const optStr = (r, extra) => {
      const o = [];
      if (r.tags && r.tags.length) o.push('$tag=' + r.tags.join(','));
      if (r.groups && r.groups.length) o.push('$for=' + r.groups.join(','));
      if (extra) o.push(...extra);
      if (r.id && !/^L\d+$/.test(r.id)) o.push('$id=' + r.id);
      return o.length ? ' ' + o.join(' ') : '';
    };
    if ((pack.predicates || []).length) {
      out.push('! Claims: what follows a group word ("<group> are vermin")');
      for (const p of pack.predicates) out.push('claim ' + p.sev + ' ' + body(p.pattern) + optStr(p));
      out.push('');
    }
    if ((pack.prefixes || []).length) {
      out.push('! Before: what comes right before a group word ("deport all <group>")');
      for (const p of pack.prefixes) out.push('before ' + p.sev + ' ' + body(p.pattern) + optStr(p));
      out.push('');
    }
    if ((pack.phrases || []).length) {
      out.push('! Phrases: slogans, codes and stand-alone hateful lines');
      for (const p of pack.phrases) {
        const cats = (p.cats || [p.cat || 'dehumanising']).join(',');
        const pat = p.literal ? (lit(String(p.pattern)) || body(escape(String(p.pattern).toLowerCase()).replace(/\s+/g, '\\s+'))) : body(p.pattern);
        out.push('phrase ' + cats + ' ' + (p.sev || 2) + ' ' + pat + optStr({ id: p.id }, p.raw ? ['$raw'] : null));
      }
      out.push('');
    }
    if ((pack.allow || []).length) {
      out.push('! Allow: never mute these');
      for (const a of pack.allow) out.push('allow ' + body(a));
      out.push('');
    }
    return out.join('\n');
  }

  const api = { parse, fromPack, tooSlow, nestedQuantifier, CATS };
  root.BNetLists = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Engine speed and equivalence check. Usage: node tools/bench.js [old-engine.js] [--sample N] | --guards
//   With an old engine: every text in data/benign.tsv, the dyna/hatexplain/davidson datasets and the
//   tools/test-engine.js cases must give byte-identical spans (JSON) from old and new, at two settings.
//   Without one, the new engine's compile(packs) and compile(prepare(packs)) paths are compared instead.
//   Prints CPU ms: cold compile, cold compile from prepared, the first 200 blocks after it (V8 compiles
//   each RegExp the first time it runs, so this is the real page-load cost) and warm ms/block.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), D = path.join(ROOT, 'data');
const NEW = path.join(ROOT, 'src/engine.js');
const args = process.argv.slice(2);
// CPU time, not wall time: the numbers stay comparable on a busy machine.
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

// Child mode: one cold measurement in a fresh process (a page load is a fresh isolate too).
if (args[0] === '--child') {
  const [, enginePath, mode, packFile, textFile] = args;
  const E = require(enginePath);
  const input = fs.readFileSync(packFile, 'utf8');
  const texts = JSON.parse(fs.readFileSync(textFile, 'utf8'));
  const t0 = cpu();
  const C = mode === 'prepared' ? E.compile(JSON.parse(input)) : E.compile([JSON.parse(input)]);
  const t1 = cpu();
  for (const t of texts) E.scan(C, t, { minSev: 2 });
  const t2 = cpu();
  process.stdout.write(JSON.stringify({ compile: t1 - t0, first: t2 - t1 }));
  return;
}

// Guards (not pure speed): user rules in non-Latin scripts must match, a catastrophic rule must be dropped.
if (args[0] === '--guards') {
  const E = require(NEW), L = require('../src/lists.js');
  let fail = 0;
  const check = (rule, text, want) => {
    const C = E.compile(E.prepare([L.parse(rule + '\n', 'user').data]));
    const got = E.scan(C, text, { minSev: 1 }).map(x => x.text);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(rule), '|', text, '->', JSON.stringify(got), C.errors.length ? C.errors : '');
  };
  check('phrase racism 2 καταραμένοι ξένοι', 'Αυτοί οι καταραμένοι ξένοι πάλι.', ['καταραμένοι ξένοι']);
  check('phrase racism 2 ΚΑΤΑΡΑΜΕΝΟΙ', 'οι καταραμένοι', ['καταραμένοι']);
  check('phrase racism 2 грязные мигранты', 'Эти грязные мигранты опять.', ['грязные мигранты']);
  check('slur racism 3 чурка', 'какой чурка', ['чурка']);
  check('group racism мигранты\nclaim 2 /это\\s+крысы/', 'мигранты это крысы', ['мигранты это крысы']);
  check('phrase racism 2 外国人は出て行け', '外国人は出て行けと言った', ['外国人は出て行け']);
  check('group racism 外国人\nclaim 2 /泥棒/', '外国人は泥棒だ', ['外国人は泥棒']);
  check('slur racism 3 支那', '支那人', ['支那']);
  check('phrase racism 2 كلاب قذرة', 'هم كلاب قذرة', ['كلاب قذرة']);
  check('phrase racism 2 грязные', 'Чистые улицы', []);
  check('slur racism 3 spic', 'what a ѕріс', ['ѕріс']);                 // all look-alikes: still a disguise
  check('slur racism 3 nigger', 'what a nіgger', ['nіgger']);           // one Cyrillic і in a Latin word
  for (const r of ['phrase racism 2 /(?:a+)+b/ $raw', 'phrase racism 2 /(?:\\w+\\s?)+x/']) {
    const P = E.prepare([L.parse(r + '\n', 'user').data]);
    const ok = P.phrases.length === 0 && /too slow/.test(P.errors.join(' '));
    if (!ok) fail++;
    console.log(ok ? 'ok  ' : 'FAIL', 'slow rule dropped:', r, P.errors);
  }
  const P = E.prepare([core0()]);
  if (P.errors.length) { fail++; console.log('FAIL core rules reported:', P.errors); } else console.log('ok   no core rule dropped by the guard');
  console.log('guards fail', fail);
  process.exitCode = fail ? 1 : 0;
  return;
}
function core0() { return require('../src/lists.js').parse(fs.readFileSync(path.join(ROOT, 'rules/core.txt'), 'utf8'), 'core').data; }

const oldArg = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const si = args.indexOf('--sample'), sample = si >= 0 ? Number(args[si + 1]) : 0;
const OLD = oldArg ? path.resolve(oldArg) : null;
const L = require('../src/lists.js');
const core = L.parse(fs.readFileSync(path.join(ROOT, 'rules/core.txt'), 'utf8'), 'core').data;
const En = require(NEW);
const Eo = OLD ? require(OLD) : null;

function csv(text) { // minimal RFC4180 parser (as in eval.js)
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const sets = {};
sets.benign = fs.readFileSync(path.join(D, 'benign.tsv'), 'utf8').split('\n').map(l => l.split('\t')[1]).filter(t => t != null);
{ const r = csv(fs.readFileSync(path.join(D, 'dyna.csv'), 'utf8')); const ti = r[0].indexOf('text'); sets.dyna = r.slice(1).filter(x => x.length > ti).map(x => x[ti]); }
sets.hatexplain = Object.values(JSON.parse(fs.readFileSync(path.join(D, 'hatexplain.json'), 'utf8'))).map(v => v.post_tokens.join(' ').replace(/<user>/g, '@user'));
sets.davidson = csv(fs.readFileSync(path.join(D, 'davidson.csv'), 'utf8')).slice(1).filter(x => x.length >= 7).map(x => x[6]);
{ // the unit-test sentences, plus the text the test uses for its speed check
  const src = fs.readFileSync(path.join(__dirname, 'test-engine.js'), 'utf8');
  const cases = Function('return ' + src.slice(src.indexOf('const cases = [') + 14, src.indexOf('];\nlet fail') + 1))();
  sets.tests = cases.map(c => c[0]); sets.tests.push(sets.tests.join('. ').repeat(5).slice(0, 280));
}
if (sample) for (const k in sets) if (k !== 'tests') sets[k] = sets[k].filter((_, i) => i % Math.max(1, Math.floor(sets[k].length / sample)) === 0);

const enabled = En.CAT_IDS.filter(c => c !== 'political');
const configs = [{ minSev: 1 }, { minSev: 2, enabled }];

// 1. Equivalence
const Cn = En.compile(En.prepare([core]));
const ref = Eo ? { E: Eo, C: Eo.compile([core]), name: 'old engine' } : { E: En, C: En.compile([core]), name: 'compile(packs)' };
const srcs = C => JSON.stringify([C.count, C.errors, C.groups.map(g => [g.cat, g.re.source, g.re.flags]), C.preds.map(p => p.re.source), C.prefixes.map(p => p.re.source),
  C.phrases.map(p => [p.re.source, p.cats, p.sev, p.id]), C.allow.map(r => (r.re || r).source), (C.slurIdx || []).map(r => r.source), C.slurs.map(s => [s.id, s.full.source, s.re.source])]);
console.log('compiled regexes identical to ' + ref.name + ':', srcs(ref.C) === srcs(Cn) ? 'yes' : 'NO');
let diffs = 0, total = 0;
for (const [name, texts] of Object.entries(sets)) {
  let d = 0;
  for (const t of texts) for (const o of configs) {
    total++;
    const a = JSON.stringify(ref.E.scan(ref.C, t, o)), b = JSON.stringify(En.scan(Cn, t, o));
    if (a !== b) { if (++d <= 3) console.log('DIFF', name, JSON.stringify(o), JSON.stringify(t).slice(0, 160), '\n  ref', a, '\n  new', b); }
  }
  console.log('equivalence', name, texts.length, 'texts x', configs.length, 'settings:', d ? d + ' differ' : 'identical');
  diffs += d;
}
console.log('TOTAL', total, 'scans,', diffs, 'differences');

// 2. Speed. Cold numbers come from fresh processes, interleaved, median of 7.
const tmp = path.join(require('os').tmpdir(), 'bnet-bench-' + process.pid);
fs.mkdirSync(tmp, { recursive: true });
const packFile = path.join(tmp, 'core.json'), prepFile = path.join(tmp, 'prepared.json'), textFile = path.join(tmp, 'texts.json');
fs.writeFileSync(packFile, JSON.stringify(core));
const prepJson = JSON.stringify(En.prepare([core]));
fs.writeFileSync(prepFile, prepJson);
fs.writeFileSync(textFile, JSON.stringify(sets.benign.filter((_, i) => i % Math.ceil(sets.benign.length / 200) === 0)));
const runs = { old: [], raw: [], prepared: [] };
for (let i = 0; i < 7; i++) {
  for (const [k, eng, mode, file] of [['old', OLD, 'raw', packFile], ['raw', NEW, 'raw', packFile], ['prepared', NEW, 'prepared', prepFile]]) {
    if (!eng) continue;
    runs[k].push(JSON.parse(execFileSync(process.execPath, [__filename, '--child', eng, mode, file, textFile], { encoding: 'utf8' })));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
const med = (a, f) => { const v = a.map(f).sort((x, y) => x - y); return v[v.length >> 1]; };
const row = {};
for (const [k, label] of [['old', 'old compile(packs)'], ['raw', 'new compile(packs)'], ['prepared', 'new compile(prepared)']]) {
  if (runs[k].length) row[label] = { 'cold compile ms': med(runs[k], r => r.compile).toFixed(1), 'first 200 blocks ms': med(runs[k], r => r.first).toFixed(1) };
}
// Warm scan: same mixed sample through both engines.
const warm = [].concat(sets.benign.filter((_, i) => i % 20 === 0), sets.dyna.filter((_, i) => i % 10 === 0), sets.hatexplain.filter((_, i) => i % 10 === 0), sets.davidson.filter((_, i) => i % 10 === 0));
const msPer = (E, C) => { const t0 = cpu(); for (const t of warm) E.scan(C, t, configs[1]); return (cpu() - t0) / warm.length; };
const best = { o: Infinity, n: Infinity };
for (let i = 0; i < 5; i++) { if (Eo) best.o = Math.min(best.o, msPer(Eo, ref.C)); best.n = Math.min(best.n, msPer(En, Cn)); }
if (Eo) row['old compile(packs)']['warm ms/block'] = best.o.toFixed(3);
row['new compile(prepared)']['warm ms/block'] = best.n.toFixed(3);
console.table(row);
console.log('prepared object:', (prepJson.length / 1024).toFixed(0) + ' KB JSON; warm sample', warm.length, 'blocks');
if (diffs) process.exitCode = 1;

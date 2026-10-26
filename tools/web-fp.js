// False alarms on ordinary web text (news, reviews, forums, chat). Usage: node tools/web-fp.js [dial] [corpus.tsv] [--core]
// Loads rules/core.txt (the build folds rules/extra/ into it). --extra also loads rules/extra/ directly, for testing a list before a build.
// Hits are written to <tmp>/<corpus>.hits.txt, never into data/.
const fs = require('fs'), os = require('os'), path = require('path');
const E = require('../src/engine.js'), L = require('../src/lists.js');
const flags = process.argv.slice(2).filter(a => a.startsWith('--')), args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const dial = Number(args[0] || 2), file = args[1] || path.join(__dirname, '../data/benign.tsv');
const R = path.join(__dirname, '../rules'), X = path.join(R, 'extra');
const lists = ['core.txt'].concat(flags.includes('--extra') && fs.existsSync(X) ? fs.readdirSync(X).filter(f => f.endsWith('.txt')).sort().map(f => 'extra/' + f) : []);
const C = E.compile(lists.map(f => L.parse(fs.readFileSync(path.join(R, f), 'utf8'), f).data));
const enabled = E.CAT_IDS.filter(c => c !== 'political');
const rows = fs.readFileSync(file, 'utf8').split('\n').map(l => l.split('\t')).filter(r => r.length > 1);
const by = {}, rules = {}, hits = [];
for (const [src, t] of rows) {
  const k = src.split(':')[0]; by[k] = by[k] || { n: 0, hit: 0 }; by[k].n++;
  const s = E.scan(C, t, { minSev: E.SEV_FOR_DIAL[dial], enabled });
  if (s.length) { by[k].hit++; for (const x of s) { rules[x.rule] = (rules[x.rule] || 0) + 1; } hits.push(src + '\t' + s.map(x => x.text + ' [' + x.rule + ']').join(' ; ') + '  <<  ' + t.slice(0, 200)); }
}
by.ALL = { n: rows.length, hit: hits.length };
for (const k in by) by[k].rate = (by[k].hit / by[k].n * 100).toFixed(3) + '%';
console.log('lists:', lists.join(', '));
console.table(by);
console.log(Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 25).map(x => x.join(' ')).join('\n'));
const out = path.join(os.tmpdir(), path.basename(file).replace(/\.tsv$/, '') + '.hits.txt');
fs.writeFileSync(out, hits.join('\n'));
console.log('hits ->', out);

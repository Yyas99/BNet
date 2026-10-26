// False alarms on ordinary web text (news, reviews, forums, chat). Usage: node tools/web-fp.js [dial] [corpus.tsv]
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js'), L = require('../src/lists.js');
const dial = Number(process.argv[2] || 2), file = process.argv[3] || path.join(__dirname, '../data/benign.tsv');
const C = E.compile([L.parse(fs.readFileSync(path.join(__dirname, '../rules/core.txt'), 'utf8'), 'core').data]);
const enabled = E.CAT_IDS.filter(c => c !== 'political');
const rows = fs.readFileSync(file, 'utf8').split('\n').map(l => l.split('\t'));
const by = {}, rules = {}, hits = [];
for (const [src, t] of rows) {
  const k = src.split(':')[0]; by[k] = by[k] || { n: 0, hit: 0 }; by[k].n++;
  const s = E.scan(C, t, { minSev: E.SEV_FOR_DIAL[dial], enabled });
  if (s.length) { by[k].hit++; for (const x of s) { rules[x.rule] = (rules[x.rule] || 0) + 1; } hits.push(s.map(x => x.text + ' [' + x.rule + ']').join(' ; ') + '  <<  ' + t.slice(0, 200)); }
}
for (const k in by) by[k].rate = (by[k].hit / by[k].n * 100).toFixed(3) + '%';
console.table(by);
console.log(Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 25).map(x => x.join(' ')).join('\n'));
fs.writeFileSync(path.join(path.dirname(file), 'benign.hits.txt'), hits.join('\n'));

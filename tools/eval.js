// Scores the core rules against labelled datasets. Usage: node tools/eval.js [dial] [split]
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js'), L = require('../src/lists.js');
const dial = Number(process.argv[2] || 2), only = process.argv[3] || 'test';
const C = E.compile([L.parse(fs.readFileSync(path.join(__dirname, '../rules/core.txt'), 'utf8'), 'core').data]);
const enabled = E.CAT_IDS.filter(c => c !== 'political');
const hit = t => E.scan(C, t, { minSev: E.SEV_FOR_DIAL[dial], enabled }).length > 0;
const D = path.join(__dirname, '../data');
function csv(text) { // minimal RFC4180 parser
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
{ const r = csv(fs.readFileSync(D + '/dyna.csv', 'utf8')); const h = r[0];
  const ti = h.indexOf('text'), li = h.indexOf('label'), si = h.indexOf('split');
  sets.dyna = r.slice(1).filter(x => x.length > si && (only === 'all' || x[si] === only)).map(x => ({ t: x[ti], y: x[li] === 'hate' })); }
{ const d = JSON.parse(fs.readFileSync(D + '/hatexplain.json', 'utf8'));
  sets.hatexplain = Object.values(d).map(v => { const labs = v.annotators.map(a => a.label); const maj = labs.sort((a, b) => labs.filter(x => x === b).length - labs.filter(x => x === a).length)[0];
    return { t: v.post_tokens.join(' ').replace(/<user>/g, '@user'), y: maj === 'hatespeech', off: maj === 'offensive' }; }); }
{ const r = csv(fs.readFileSync(D + '/davidson.csv', 'utf8')).slice(1).filter(x => x.length >= 7);
  sets.davidson = r.map(x => ({ t: x[6], y: x[5] === '0', off: x[5] === '1' })); }
const out = {};
for (const [name, rows] of Object.entries(sets)) {
  let tp = 0, fn = 0, fp = 0, tn = 0, offHit = 0, off = 0;
  const misses = [], fps = [];
  for (const r of rows) {
    const h = hit(r.t);
    if (r.off) { off++; if (h) offHit++; continue; }
    if (r.y) { if (h) tp++; else { fn++; misses.push(r.t); } } else { if (h) { fp++; fps.push(r.t); } else tn++; }
  }
  out[name] = { n: rows.length, recall: (tp / (tp + fn) * 100).toFixed(1) + '%', falseAlarm: (fp / (fp + tn) * 100).toFixed(2) + '%', precision: (tp / Math.max(1, tp + fp) * 100).toFixed(1) + '%', offensiveMuted: off ? (offHit / off * 100).toFixed(1) + '%' : '-' };
  fs.writeFileSync(path.join(D, name + '.misses.txt'), misses.join('\n'));
  fs.writeFileSync(path.join(D, name + '.fps.txt'), fps.join('\n'));
}
console.table(out);

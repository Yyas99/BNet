// Prints what each rewrite voice says in place of muted spans, in the sentence around them, and flags
// rewrites that would still be muted, repeat a word, or break a/an. Prints "flagged N" at the end.
// Usage: node tools/voices.js [voice|all] "sentence" ...     rewrite these sentences
//        node tools/voices.js [voice|all] --data [n]          sample n spans of each kind from data/hatexplain.json and data/dyna.csv
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js'), L = require('../src/lists.js');
require('../src/treatments.js');
const T = globalThis.BNetTreatments;
const C = E.compile([L.parse(fs.readFileSync(path.join(__dirname, '../rules/core.txt'), 'utf8'), 'core').data]);
const scan = t => E.scan(C, t, { minSev: 1, enabled: E.CAT_IDS });

const args = process.argv.slice(2);
const which = args[0] && !args[0].startsWith('-') && T.byId(args[0]) || args[0] === 'all' ? args.shift() : 'all';
const voices = which === 'all' ? T.TREATMENTS.filter(t => t.group === 'voice').map(t => t.id) : [which];

let items = [];
if (args[0] === '--data') {
  const per = Number(args[1] || 25), D = path.join(__dirname, '../data');
  const posts = Object.values(JSON.parse(fs.readFileSync(D + '/hatexplain.json', 'utf8'))).map(v => v.post_tokens.join(' ').replace(/<user>/g, '@user'));
  for (const line of fs.readFileSync(D + '/dyna.csv', 'utf8').split('\n')) { const m = line.match(/^"\d+","[^"]*",\d+,"((?:[^"]|"")*)","(?:hate|nothate)"/); if (m) posts.push(m[1].replace(/""/g, '"')); }
  const byKind = {}, seen = new Set();
  for (const p of posts) for (const sp of scan(p)) {
    const k = sp.kind + '|' + sp.text.toLowerCase();
    if (seen.has(k)) continue; seen.add(k);
    (byKind[sp.kind] = byKind[sp.kind] || []).push({ post: p, sp });
  }
  for (const list of Object.values(byKind)) { const step = Math.max(1, Math.floor(list.length / per)); for (let i = 0; i < list.length && i < step * per; i += step) items.push(list[i]); }
} else {
  for (const s of args) for (const sp of scan(s)) items.push({ post: s, sp });
}

let flagged = 0;
for (const { post, sp } of items) {
  console.log(`\n${sp.kind}/${sp.pred || sp.pre || sp.rule}  «${sp.text}»`);
  for (const id of voices) {
    const out = T.render(id, sp, sp.text).text;
    const sentence = post.slice(0, sp.start) + out + post.slice(sp.end);
    const issues = [];
    if (scan(out).length) issues.push('still muted');
    if (/\b(\w{3,})\s+\1\b/i.test(out)) issues.push('repeats');
    if (/\ba\s+[aeio]\w/i.test(sentence.slice(Math.max(0, sp.start - 3), sp.start + out.length)) || /\ban\s+[bcdfgjklmnpqrstvwxyz]/i.test(sentence.slice(Math.max(0, sp.start - 4), sp.start + out.length))) issues.push('a/an');
    if (issues.length) flagged++;
    const ctx = sentence.slice(Math.max(0, sp.start - 50), sp.start + out.length + 40).replace(/\s+/g, ' ');
    console.log(`  ${id.padEnd(12)} ${out}${issues.length ? '   <-- ' + issues.join(', ') : ''}\n  ${''.padEnd(12)} …${ctx}…`);
  }
}
console.log(`\nspans ${items.length}, voices ${voices.length}, flagged ${flagged}`);

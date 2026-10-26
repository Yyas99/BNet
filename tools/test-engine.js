const E = require('../src/engine.js');
const core = require('../src/lists.js').parse(require('fs').readFileSync(require('path').join(__dirname,'..','rules','core.txt'),'utf8'),'core').data;
const C = E.compile([core]);
if (C.errors.length) { console.log('ERRORS', C.errors); process.exitCode = 1; }
console.log('rules', C.count);
const cases = [
 // [text, shouldHit(at balanced), note]
 ['Immigrants are vermin and should be deported', true],
 ['immigrants are not vermin', false],
 ['These muslims are literally animals lol', true],
 ['kill all the jews', true],
 ['deport them all', true],
 ['women belong in the kitchen', true],
 ['Trans people are mentally ill', true],
 ['what a n1gg3r', true],
 ['n i g g e r', true],
 ['sandnigger', true],
 ['𝓷𝓲𝓰𝓰𝓮𝓻', true],
 ['ni​gger', true],
 ['niger is a country in africa', false],
 ['Nigeria and Niger', false],
 ['a chink in the armor', false],
 ['homo sapiens evolved', false],
 ['I love spice', false],
 ['the raccoon ate my bins', false],
 ['pakistan cricket team', false],
 ['go back to your country', true],
 ['1488', true],
 ['call me at 1488 3022', true],
 ['(((globalists)))', true],
 ['the great replacement is happening', true],
 ['Black people are amazing artists', false],
 ['Asian women are beautiful', false],
 ['Liberals are traitors', false, 'political off by default'],
 ['jews control the media', true],
 ['Muslims should be banned', true],
 ['I think refugees deserve support', false],
 ['the only good immigrant is a dead immigrant', true],
 ['your body my choice', true],
 ['pajeets everywhere', true],
 ['bloody immigrants', false, 'sev1'],
 ['My grandmother says migrants are ruining the country', true],
 ['refugees are fleeing war', false],
 ['the right to vote', false],
 ['coon cheese is now cheer', false],
 ['f4gg0t', true],
 ['shut up retard', true],
 ['i love my wife and the women in my life are great', false],
 ['men are trash', true],
 ['the left are retards', true, 'slur still hidden'],
 // everyday web text that must stay readable
 ['Gunmen kill Christians in northern Nigeria, officials say', false, 'news headline'],
 ['The government plans to deport migrants who arrived this year', false, 'policy news'],
 ['Woman: Mmm, I smell some good weed', false, 'speaker label'],
 ['((((hugs to everyone in the room))))', false, 'chat hugs'],
 ['the ABO blood group and Rh antibodies', false, 'blood type'],
 ['just popping out for a fag break', false, 'UK cigarette'],
 ['my tranny fluid is leaking again', false, 'car transmission'],
 ['a doo-wop group from the fifties', false, 'music'],
 ['you will never pass the exam without studying', false, 'exam'],
 ['let us not be racist in public', false, 'negated'],
 ['Did you kill all those guards?', false, 'game'],
 ['the Nazi plan to exterminate the Jews was horrific', false, 'history writing stays readable'],
 ['trans-shipment is a problem for customs', false, 'hyphen compound'],
 ['refugees bring nothing but crime and misery', true, 'new claim'],
 ['muslims should be buried alive', true, 'new violence'],
 ['blacks have low iqs', true, 'low iq'],
 ['the jews control 99% of the world\'s money', true, 'control share'],
 ['jews are behind 9/11', true, 'behind-it'],
 ['I really dont want any muslims living near me', true, 'dont-want'],
 ['we need a world free of jews', true, 'free-of'],
 ['europe is for europeans', true, 'ethnostate'],
 ['get the immigrants out', true, 'get-them-out'],
 ['tarrant did nothing wrong', true, 'shooter praise'],
 ['moslems are vermin', true, 'spelling variant'],
 ['kill all the muslims', true, 'kill all'],
 ['deport them all', true, 'deport all'],
 ['Maybe if Muslims weren\u2019t so horrible, things like this wouldn\u2019t happen.', true, 'counterfactual insult, curly apostrophe'],
 ['Muslims weren\'t so bad after all', false, 'positive'],
];
// Extra case files: tools/cases/*.tsv, one case per line as  text<TAB>1|0[<TAB>note]
// (1 = must be muted at Balanced, 0 = must stay readable). Lines starting with # are comments.
// Every file in the folder is picked up on its own, so owners can add cases without touching this script.
const fs = require('fs'), path = require('path');
const CASE_DIR = path.join(__dirname, 'cases');
function loadCaseFile(file) {
  const out = [], bad = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim() || line.trim()[0] === '#') return;
    const cols = line.split('\t');
    const want = (cols[1] || '').trim();
    if (cols.length < 2 || !/^[01]$/.test(want) || !cols[0].trim()) { bad.push(i + 1); return; }
    out.push([cols[0], want === '1', (cols[2] || '').trim() || 'line ' + (i + 1)]);
  });
  return { out, bad };
}
const suites = [['built-in', cases, []]];
if (fs.existsSync(CASE_DIR)) {
  for (const f of fs.readdirSync(CASE_DIR).filter(f => f.endsWith('.tsv')).sort()) {
    const { out, bad } = loadCaseFile(path.join(CASE_DIR, f));
    suites.push([f, out, bad]);
  }
}
let fail = 0;
const enabled = E.CAT_IDS.filter(c=>c!=='political');
const summary = [];
for (const [name, list, bad] of suites) {
  let f = 0;
  if (list !== cases) console.log('--', name);
  for (const [t, want, note] of list) {
    const r = E.scan(C, t, {minSev:2, enabled});
    const ok = (r.length>0)===want;
    if(!ok) f++;
    if (!ok || list === cases) console.log(ok?'ok  ':'FAIL', JSON.stringify(t), '→', r.map(x=>`[${x.text}] ${x.cats.join('/')} s${x.sev} ${x.rule}`).join(' ; '), note||'');
  }
  // A malformed line is a failure: a case that silently never runs is worse than no case.
  for (const ln of bad) { f++; console.log('FAIL', name, 'line', ln, 'is not  text<TAB>1|0'); }
  fail += f;
  summary.push(`${f ? 'FAIL' : 'ok  '} ${name}: ${list.length - (f - bad.length)}/${list.length} passed${bad.length ? ', ' + bad.length + ' malformed lines' : ''}`);
}
console.log('-- per file');
summary.forEach(l => console.log(l));
console.log('fail', fail);
if (fail) process.exitCode = 1;
// perf
const big = cases.map(c=>c[0]).join('. ').repeat(5);
let t0=Date.now(); for(let i=0;i<200;i++) E.scan(C, big.slice(0,280), {minSev:2, enabled}); console.log('ms/tweet', (Date.now()-t0)/200);
// A rule copied from the page keeps the page's curly apostrophes; it must still match.
{
  const L = require('../src/lists.js');
  const user = L.parse('phrase racism 3 they weren’t invited\n', 'user').data;
  const ok = E.scan(E.compile([user]), 'They weren’t invited, again.', { minSev: 1 }).length === 1;
  console.log(ok ? 'ok   curly-quote user rule' : 'FAIL curly-quote user rule');
  if (!ok) process.exitCode = 1;
}

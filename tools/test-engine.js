const E = require('../src/engine.js');
const core = require('../src/lists.js').parse(require('fs').readFileSync(require('path').join(__dirname,'..','rules','core.txt'),'utf8'),'core').data;
const C = E.compile([core]);
if (C.errors.length) { console.log('ERRORS', C.errors); }
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
];
let fail=0;
const enabled = E.CAT_IDS.filter(c=>c!=='political');
for (const [t, want, note] of cases) {
  const r = E.scan(C, t, {minSev:2, enabled});
  const ok = (r.length>0)===want;
  if(!ok) fail++;
  console.log(ok?'ok  ':'FAIL', JSON.stringify(t), '→', r.map(x=>`[${x.text}] ${x.cats.join('/')} s${x.sev} ${x.rule}`).join(' ; '), note||'');
}
console.log('fail', fail);
// perf
const big = cases.map(c=>c[0]).join('. ').repeat(5);
let t0=Date.now(); for(let i=0;i<200;i++) E.scan(C, big.slice(0,280), {minSev:2, enabled}); console.log('ms/tweet', (Date.now()-t0)/200);

// Harmless sentences that must never be muted, plus tools/cases/precision.tsv (text<TAB>0 harmless | 1 must mute).
// Loads rules/core.txt (the build folds rules/extra/ into it). --extra also loads rules/extra/ directly, for testing a list before a build. Usage: node tools/fp.js [--extra]
const fs = require('fs'), path = require('path');
const E = require('../src/engine.js'), Lists = require('../src/lists.js');
const R = path.join(__dirname, '..', 'rules'), X = path.join(R, 'extra');
const lists = ['core.txt'].concat(process.argv.includes('--extra') && fs.existsSync(X) ? fs.readdirSync(X).filter(f => f.endsWith('.txt')).sort().map(f => 'extra/' + f) : []);
const C = E.compile(lists.map(f => Lists.parse(fs.readFileSync(path.join(R, f), 'utf8'), f).data));
const en = E.CAT_IDS;
const benign = `Women are underrepresented in STEM fields.
Muslims are celebrating Eid this week.
Jews are marking Yom Kippur.
Immigrants are essential to the economy.
Refugees should be welcomed with open arms.
Gay people are just people.
Trans women are women.
Asians are the fastest growing group in the US.
Liberals are planning a rally on Sunday.
The left needs to get its act together on housing.
Black people are disproportionately affected by this policy.
Men are more likely to die by heart disease.
Indians are winning the cricket.
Mexicans are amazing cooks.
Girls are taking over chess tournaments.
Chinese people are celebrating new year.
Natives are the original custodians of the land.
Kill the lights when you leave.
My dog is a beast at fetch.
We need to get rid of these bugs in the code.
The Japanese are known for their craftsmanship.
Death to the patriarchy lol (joke)
Ban all ads on YouTube
Hindus are celebrating Diwali tonight
I hate mondays
fuck the government
Arabs are hospitable people
Women should be paid equally
Christians are gathering at church
Migrants are being exploited by employers
Israelis and Palestinians both deserve peace
Russians are fleeing conscription
the women in my team are animals at work (compliment)
Boomers are buying all the houses
Republicans are meeting in Ohio`.split('\n');
const show = r => r.map(x => x.text + ' ' + x.rule).join('; ');
for (const s of [1, 2, 3]) {
  const hits = benign.map(t => [t, E.scan(C, t, { minSev: E.SEV_FOR_DIAL[s], enabled: en })]).filter(x => x[1].length);
  console.log('dial', s, 'FP', hits.length);
  hits.forEach(([t, r]) => console.log('   ', t, '→', show(r)));
}
// Hard cases from the open web: news, history, research, counter-speech, games, names. Scored at Balanced (dial 2).
const cases = fs.readFileSync(path.join(__dirname, 'cases', 'precision.tsv'), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
const enabled = E.CAT_IDS.filter(c => c !== 'political');
let fa = 0, miss = 0, neg = 0;
for (const [t, y] of cases) {
  const r = E.scan(C, t, { minSev: E.SEV_FOR_DIAL[2], enabled });
  if (y === '1') { if (!r.length) { miss++; console.log('    MISS ', t); } }
  else { neg++; if (r.length) { fa++; console.log('    FALSE', t, '→', show(r)); } }
}
console.log('precision.tsv dial 2:', fa + '/' + neg, 'harmless muted,', miss + '/' + (cases.length - neg), 'must-mute missed', '(' + lists.join(', ') + ')');

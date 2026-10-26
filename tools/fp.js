const E=require('../src/engine.js'),C=E.compile([require('../src/lists.js').parse(require('fs').readFileSync(require('path').join(__dirname,'..','rules','core.txt'),'utf8'),'core').data]);
const en=E.CAT_IDS;
const benign=`Women are underrepresented in STEM fields.
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
for(const s of [1,2,3]){let hits=benign.map(t=>[t,E.scan(C,t,{minSev:E.SEV_FOR_DIAL[s],enabled:en})]).filter(x=>x[1].length);console.log('dial',s,'FP',hits.length);hits.forEach(([t,r])=>console.log('   ',t,'→',r.map(x=>x.text+' '+x.rule).join(';')));}

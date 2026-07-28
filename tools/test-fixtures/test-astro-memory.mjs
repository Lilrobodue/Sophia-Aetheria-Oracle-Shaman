import { parseBirthDate, parseBirthTime, parseBirthPlace, extractBirthData,
         chartToMemory, resonantMemories, findStoredChart }
  from '../astro-memory.js';
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  '+x:''));};

// Dates — including the exact format Sophia already auto-saves at index.html:6063
ok('auto-saved format "User\'s birthday: July 4, 1985"',
   parseBirthDate("User's birthday: July 4, 1985")?.date==='1985-07-04');
ok('ISO', parseBirthDate('born 1985-07-04')?.date==='1985-07-04');
ok('day-first "4 July 1985"', parseBirthDate('born 4 July 1985')?.date==='1985-07-04');
ok('ordinal "4th of July 1985"', parseBirthDate('born on the 4th of July 1985')?.date==='1985-07-04');
ok('abbrev "Jul 4, 1985"', parseBirthDate('Jul 4, 1985')?.date==='1985-07-04');
const amb = parseBirthDate('born 03/04/1990');
ok('numeric ambiguity FLAGGED not guessed', amb.ambiguous===true && /could be/.test(amb.note), amb.note);
ok('numeric disambiguated when day>12', parseBirthDate('born 25/12/1990')?.date==='1990-12-25');
ok('numeric disambiguated when first>12', parseBirthDate('born 25/12/1990')?.ambiguous===false);
const noYear = parseBirthDate('my birthday is July 4');
ok('missing year reported, no date', noYear.date===null && /no birth year/.test(noYear.note));
ok('rejects implausible year', parseBirthDate('born 1785-07-04')===null || parseBirthDate('born 1785-07-04').date===null);

// Times
ok('12h pm', parseBirthTime('born at 2:30 PM')==='14:30');
ok('12h am', parseBirthTime('born at 2:30 am')==='02:30');
ok('bare hour pm', parseBirthTime('born at 2 pm')==='14:00');
ok('24h', parseBirthTime('born 14:30')==='14:30');
ok('midnight 12am -> 00:00', parseBirthTime('born 12:05 am')==='00:05');
ok('noon 12pm -> 12:00', parseBirthTime('born 12:05 pm')==='12:05');

// Places
ok('born in City, State', parseBirthPlace('I was born in Boise, Idaho')==='Boise, Idaho');
ok('coordinates', parseBirthPlace('born at 43.6135, -116.2034')==='43.6135,-116.2034');
ok('rejects "Born On A Tuesday"', parseBirthPlace('Born On A Tuesday')===null);

// Extraction across a realistic memory set, with a later correction winning
const mems = [
  { content:"User's name is Joseph", tags:['name'], timestamp:1 },
  { content:"User's birthday: July 4, 1985", tags:['birthday','astrology'], timestamp:2 },
  { content:"User mentioned he was born in Boise, Idaho at 2:30 PM", tags:['birthday'], timestamp:3 },
  { content:"We spoke at 09:15 about breathwork", tags:['session'], timestamp:4 },
];
const bd = extractBirthData(mems);
ok('extract date', bd.date==='1985-07-04', bd.date);
ok('extract time', bd.time==='14:30', bd.time);
ok('extract place', bd.place==='Boise, Idaho', bd.place);
ok('complete', bd.complete===true);
ok('non-birth timestamp NOT taken as birth time', bd.time!=='09:15');

const corrected = extractBirthData([...mems,
  { content:"Correction: user was actually born at 3:45 PM, not 2:30", tags:['birthday'], timestamp:9 }]);
ok('later correction wins', corrected.time==='15:45', corrected.time);

const partial = extractBirthData([{ content:"User's birthday: July 4, 1985", tags:['birthday'], timestamp:1 }]);
ok('partial reports what is missing', partial.complete===false && partial.missing.includes('birth time'), partial.missing.join('/'));

// Chart -> memory
const chart = {
  sun:{sign:'Cancer'}, moon:{sign:'Aquarius'}, ascendant:{sign:'Scorpio'},
  planets:[
    {name:'Sun', sign:'Cancer', signDegree:"12°30'", house:9, retrograde:false},
    {name:'Saturn', sign:'Scorpio', signDegree:"3°10'", house:1, retrograde:true},
  ],
  elements:{summary:'Water-heavy, little Fire'},
  signatures:['Saturn rising in Scorpio','Sun-Moon square'],
  birth:{date:'1985-07-04', time:'14:30', placeName:'Boise, Idaho'},
};
const mem = chartToMemory(chart);
ok('memory tagged for recall', mem.tags.includes('natal-chart') && mem.type==='personal');
ok('memory leads with the big three', /Sun Cancer, Moon Aquarius, Ascendant Scorpio/.test(mem.content));
ok('memory records retrograde', /Saturn .* R/.test(mem.content), mem.content.slice(0,140));
ok('memory stays compact', mem.content.length<600, mem.content.length+' chars');
ok('findStoredChart locates it', !!findStoredChart([{tags:['natal-chart'],content:'x'}]));

// Resonance
const hist = [
  { content:'User struggles with fear around work deadlines and responsibility', tags:['observation'], timestamp:5 },
  { content:'User loves ambient music', tags:['observation'], timestamp:6 },
  { content:"User's natal chart — Sun Cancer", tags:['natal-chart'], timestamp:7 },
];
const res = resonantMemories(hist, chart);
ok('finds Saturn/fear/work resonance', res.some(r=>/Saturn/.test(r.echoes.join(' ')) && /fear|work|responsibility/.test(r.memory.content)));
ok('does not echo the chart at itself', !res.some(r=>(r.memory.tags||[]).includes('natal-chart')));
ok('returns pairing not assertion', res.every(r=>Array.isArray(r.echoes)&&r.memory));

console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);

import { astrologyTool } from '../astrology.js';
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  '+x:''));};

// Fake memory store standing in for Sophia's IndexedDB, wired exactly like ctx.memory
function store(initial=[]) {
  const rows=[...initial]; 
  return { rows, all:async()=>rows, search:async q=>rows.filter(r=>r.content.includes(q)),
           save:async m=>{rows.push({...m,id:rows.length+1,timestamp:Date.now()});return rows.length;} };
}

// 1. Nothing in memory, nothing passed -> must ASK, not invent
{
  const m=store();
  const r=await astrologyTool.execute({},{memory:m});
  ok('empty memory asks instead of inventing', /don't have enough/i.test(r) && /birth date/.test(r));
  ok('explains why each field matters', /sets every planet/.test(r) && /sets the Ascendant/.test(r));
  ok('nothing written to memory on failure', m.rows.length===0);
}

// 2. Birth data recalled from memory ALONE — the core requirement
{
  const m=store([
    {content:"User's name is Joseph",tags:['name'],timestamp:1},
    {content:"User's birthday: July 4, 1985",tags:['birthday','astrology'],timestamp:2},
    {content:"User said he was born in Boise, Idaho at 2:30 PM",tags:['birthday'],timestamp:3},
    {content:"User struggles with fear around work and responsibility",tags:['observation'],timestamp:4},
  ]);
  const r=await astrologyTool.execute({},{memory:m});
  ok('casts chart from memory with no args', /NATAL CHART/.test(r) && /Boise/.test(r));
  ok('says it used memory', /recalled from memory/i.test(r));
  ok('has ascendant + houses', /Ascendant/.test(r) && /placidus/.test(r));
  ok('has placements + aspects', /PLACEMENTS/.test(r) && /ASPECTS/.test(r));
  ok('surfaces resonant earlier memory', /EARLIER MEMORIES/.test(r) && /fear around work/.test(r));
  ok('resonance is a pairing, not a claim', /draw the connection yourself/.test(r));
  ok('chart written back to memory', m.rows.some(x=>(x.tags||[]).includes('natal-chart')));
  ok('saved chart is compact', m.rows.filter(x=>(x.tags||[]).includes('natal-chart'))[0].content.length<600);

  const r2=await astrologyTool.execute({},{memory:m});
  ok('second call does NOT duplicate the chart memory',
     m.rows.filter(x=>(x.tags||[]).includes('natal-chart')).length===1);
}

// 3. Explicit args override memory
{
  const m=store([{content:"User's birthday: July 4, 1985",tags:['birthday'],timestamp:1},
                 {content:"born in Boise, Idaho at 2:30 PM",tags:['birthday'],timestamp:2}]);
  const r=await astrologyTool.execute({birth_date:'1990-03-15',birth_time:'08:00',birth_place:'London'},{memory:m});
  ok('explicit args win over memory', /1990-03-15/.test(r) && /London/.test(r));
}

// 4. Unknown birth time degrades honestly
{
  const m=store();
  const r=await astrologyTool.execute({birth_date:'1985-07-04',birth_time:'unknown',birth_place:'Boise, Idaho'},{memory:m});
  ok('unknown time still casts', /NATAL CHART/.test(r) && /PLACEMENTS/.test(r));
  ok('unknown time omits ascendant', !/^Ascendant/m.test(r));
  ok('unknown time explains omission', /omitted rather than guessed/i.test(r));
}

// 5. DST edge case surfaces in the reading
{
  const m=store();
  const r=await astrologyTool.execute({birth_date:'2024-11-03',birth_time:'01:30',birth_place:'New York'},{memory:m});
  ok('DST overlap warned in TIME NOTES', /TIME NOTES/.test(r) && /occurred TWICE/i.test(r));
}

// 6. Polar birth degrades honestly rather than emitting nonsense
{
  const m=store();
  const r=await astrologyTool.execute({birth_date:'1969-07-20',birth_time:'20:17',birth_place:'Tromso, Norway'},{memory:m});
  ok('polar birth (Tromso 69.6N) still produces a chart', /NATAL CHART/.test(r));
  ok('polar birth (Tromso 69.6N) explains house fallback', /undefined above latitude 66/i.test(r));
  ok('no NaN anywhere in output', !/NaN/.test(r));
}

// 7. Bad input is handled, not thrown
{
  const m=store();
  const r=await astrologyTool.execute({birth_date:'not-a-date',birth_place:'Boise'},{memory:m});
  ok('bad date returns a message, no throw', typeof r==='string' && r.length>0);
  const r2=await astrologyTool.execute({birth_date:'1985-07-04',birth_time:'14:30',birth_place:'Xyzzyland'},{memory:m});
  ok('unresolvable place returns a message', /couldn't place|could not resolve/i.test(r2));
}

// 8. Works with no memory adapter at all (remote path / degraded ctx)
{
  const r=await astrologyTool.execute({birth_date:'1985-07-04',birth_time:'14:30',birth_place:'Boise, Idaho'},{});
  ok('no memory adapter still works', /NATAL CHART/.test(r));
}

// 9. Schema sanity for the native tool-calling path
ok('has JSON-schema parameters', astrologyTool.parameters.type==='object' && !!astrologyTool.parameters.properties.birth_date);
ok('no required args (memory-first)', (astrologyTool.parameters.required||[]).length===0);

console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);

/* test-birth-fields.mjs — the Manual Cast birth boxes must feed astrology_report
 * exactly what it expects. A blank box has to send undefined, not '' — an empty
 * string would override a remembered birth date with nothing.
 * Run:  node tools/test-fixtures/test-birth-fields.mjs
 */
import { readFileSync } from 'fs';
import vm from 'vm';
import { astrologyTool } from '../astrology.js';

const html = readFileSync(new URL('../../index.html', import.meta.url),'utf8');
const i0 = html.indexOf('<script>', html.indexOf('<body>'));
const js = html.slice(html.indexOf('>', i0)+1, html.indexOf('</script>', i0));
function grab(n){const i=js.indexOf('function '+n+'(');if(i<0)throw new Error('missing '+n);let d=0,st=false;
 for(let k=i;k<js.length;k++){if(js[k]==='{'){d++;st=true}else if(js[k]==='}'){d--;if(st&&d===0)return js.slice(i,k+1)}}}

let fail=0; const ok=(c,m)=>{console.log((c?'  ok   ':'  FAIL ')+m); if(!c)fail++;};

function paramsWith(fields){
  const els={};
  for (const [k,v] of Object.entries(fields)) els[k] = (k==='manualBirthTimeUnknown')?{checked:v}:{value:v};
  const ctx={console,Object,document:{getElementById:id=>els[id]||null},window:{divinationMode:'entropy'},out:{}};
  ctx.global=ctx; vm.createContext(ctx);
  vm.runInContext(grab('manualCastParams')+'\nout.p=manualCastParams("astrology");',ctx);
  return ctx.out.p;
}

// 1. all fields filled -> all four sent
let p = paramsWith({manualBirthDate:'1985-04-12',manualBirthTime:'07:30',
                    manualBirthPlace:'Boise, Idaho',manualHouseSystem:'whole',manualBirthTimeUnknown:false});
console.log('       ' + JSON.stringify(p));
ok(p.birth_date==='1985-04-12'&&p.birth_time==='07:30'&&p.birth_place==='Boise, Idaho'&&p.house_system==='whole',
   'all four fields reach the tool');

// 2. blank -> nothing but house_system, so memory fallback still works
p = paramsWith({manualBirthDate:'',manualBirthTime:'',manualBirthPlace:'',manualHouseSystem:'placidus',manualBirthTimeUnknown:false});
console.log('       ' + JSON.stringify(p));
ok(!('birth_date' in p)&&!('birth_time' in p)&&!('birth_place' in p),
   'blank boxes send nothing — an empty string would override memory with nothing');

// 3. time unknown -> the literal the tool expects
p = paramsWith({manualBirthDate:'1985-04-12',manualBirthTime:'07:30',
                manualBirthPlace:'Boise, Idaho',manualHouseSystem:'placidus',manualBirthTimeUnknown:true});
ok(p.birth_time==='unknown','ticking "I don\'t know the time" sends "unknown", overriding the time box');

// 4. the tool actually accepts what the panel builds
const memory={all:async()=>[],save:async()=>{}};
const full = await astrologyTool.execute(paramsWith({manualBirthDate:'1985-04-12',manualBirthTime:'07:30',
  manualBirthPlace:'Boise, Idaho',manualHouseSystem:'whole',manualBirthTimeUnknown:false}), {memory});
ok(/^NATAL CHART/m.test(full),'panel params produce a real chart');
ok(/Houses: whole/.test(full),'the chosen house system is honoured: ' + (full.match(/Houses: \w+/)||[])[0]);

const noTime = await astrologyTool.execute(paramsWith({manualBirthDate:'1985-04-12',manualBirthTime:'07:30',
  manualBirthPlace:'Boise, Idaho',manualHouseSystem:'placidus',manualBirthTimeUnknown:true}), {memory});
ok(/^NATAL CHART/m.test(noTime),'time-unknown still charts');
// The word appears in the caveat explaining the omission — what must be absent
// is a computed Ascendant POSITION line and the houses header.
ok(!/^Ascendant\s/m.test(noTime),'no Ascendant position line');
ok(!/^Houses:/m.test(noTime),'no houses header');
ok(/omitted rather than guessed/.test(noTime),'and it says why, rather than going quiet');

// 5. partial -> the tool asks, rather than inventing
const partial = await astrologyTool.execute(paramsWith({manualBirthDate:'1985-04-12',manualBirthTime:'',
  manualBirthPlace:'',manualHouseSystem:'placidus',manualBirthTimeUnknown:false}), {memory:{all:async()=>[]}});
ok(!/^NATAL CHART/m.test(partial),'missing place -> a question, not a chart');
console.log('       asks: ' + String(partial).slice(0,80).replace(/\n/g,' ')+'…');

console.log(fail?`\n${fail} FAILED`:'\nbirth fields OK');
process.exit(fail?1:0);

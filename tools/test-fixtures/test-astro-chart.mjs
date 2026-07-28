import { buildChart, houseCusps, houseOf, findAspects, dignityOf, formatReport, signOf }
  from '../astro-chart.js';
import { ascendantMC, eclipticPointAltitude, norm360 } from '../astro-ephemeris.js';
let p=0,f=0; const ok=(n,c,x='')=>{c?p++:f++;console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  '+x:''));};

// Placidus cusps must be independently correct: each intermediate cusp's hour
// angle should equal the required fraction of ITS OWN semi-arc. Verify via the
// horizon geometry rather than by trusting the solver.
const JD=2446251.35417, LAT=43.6135, LON=-116.2023;
const ang = ascendantMC(JD, LAT, LON);
const h = houseCusps({system:'placidus', ascendant:ang.ascendant, mc:ang.mc,
                      ramc:ang.ramc, obliquity:ang.obliquity, latitude:LAT});
ok('placidus returned 12 cusps', h.cusps.length===12 && h.cusps.every(Number.isFinite));
ok('cusp 1 == ascendant', Math.abs(norm360(h.cusps[0]-ang.ascendant))<1e-6);
ok('cusp 10 == MC', Math.abs(norm360(h.cusps[9]-ang.mc))<1e-6);
ok('cusp 7 opposite cusp 1', Math.abs(norm360(h.cusps[6]-h.cusps[0])-180)<1e-6);
ok('cusp 4 opposite cusp 10', Math.abs(norm360(h.cusps[3]-h.cusps[9])-180)<1e-6);
const ordered = h.cusps.every((c,i)=>{
  const nxt=h.cusps[(i+1)%12]; const span=norm360(nxt-c); return span>0 && span<180; });
ok('cusps strictly increase around the circle', ordered);

// Independent check of the Placidus DEFINITION for cusp 11 and 12.
function haFrac(lon){
  const e=eclipticPointAltitude(lon,0,JD,LAT,LON);
  let ha=e.hourAngle; if(ha>180)ha-=360;
  const dec=e.dec;
  const SD=Math.acos(-Math.tan(LAT*Math.PI/180)*Math.tan(dec*Math.PI/180))*180/Math.PI;
  return ha/SD;
}
ok('cusp 11 sits at -1/3 of its own semi-arc', Math.abs(haFrac(h.cusps[10])+1/3)<0.002, haFrac(h.cusps[10]).toFixed(4));
ok('cusp 12 sits at -2/3 of its own semi-arc', Math.abs(haFrac(h.cusps[11])+2/3)<0.002, haFrac(h.cusps[11]).toFixed(4));

// Polar latitudes must degrade honestly, never NaN
const polar = houseCusps({system:'placidus', ascendant:100, mc:10, ramc:10, obliquity:23.44, latitude:69.6});
ok('polar Placidus falls back, no NaN', polar.cusps.every(Number.isFinite) && /whole sign/i.test(polar.system));
ok('polar fallback warns why', polar.warnings.some(w=>/undefined above latitude 66/i.test(w)));

// houseOf must survive the 0/360 wrap
const wrapCusps=[350,20,50,80,110,140,170,200,230,260,290,320];
ok('houseOf at 355 (house 1 straddling 0 Aries)', houseOf(355,wrapCusps)===1);
ok('houseOf at 5   (house 1, past 0 Aries)',      houseOf(5,wrapCusps)===1);
ok('houseOf at 25', houseOf(25,wrapCusps)===2);
ok('houseOf at 349', houseOf(349,wrapCusps)===12);
ok('every degree lands in exactly one house',
   Array.from({length:360},(_,d)=>houseOf(d,wrapCusps)).every(v=>v>=1&&v<=12));

// Whole sign
const ws = houseCusps({system:'whole', ascendant:187.5, mc:100, ramc:100, obliquity:23.44, latitude:40});
ok('whole sign cusp 1 = 0 deg of rising sign', ws.cusps[0]===180 && signOf(ws.cusps[0])==='Libra');

// Aspects
const asp = findAspects([
  {name:'Sun',lon:10,speedPerDay:1},{name:'Moon',lon:190,speedPerDay:13},
  {name:'Mars',lon:100,speedPerDay:0.5},{name:'Venus',lon:70,speedPerDay:1.2}]);
ok('detects opposition Sun-Moon', asp.some(a=>a.aspect==='Opposition'&&a.a==='Sun'&&a.b==='Moon'));
ok('detects square Sun-Mars', asp.some(a=>a.aspect==='Square'&&((a.a==='Sun'&&a.b==='Mars'))));
ok('detects sextile Sun-Venus', asp.some(a=>a.aspect==='Sextile'));
ok('each pair appears at most once', new Set(asp.map(a=>[a.a,a.b].sort().join('-'))).size===asp.length);

// Dignities
ok('Mars rules Aries', dignityOf('Mars','Aries').includes('rulership'));
ok('Sun exalted in Aries', dignityOf('Sun','Aries').includes('exaltation'));
ok('Saturn in Cancer = detriment', dignityOf('Saturn','Cancer').includes('detriment'));
ok('Sun in Libra = fall', dignityOf('Sun','Libra').includes('fall'));

// Full chart
const chart = buildChart({jdUT:JD, latitude:LAT, longitude:LON, houseSystem:'placidus'});
ok('11 bodies incl. node', chart.planets.length===11);
ok('every planet got a house', chart.planets.every(x=>x.house>=1&&x.house<=12));
ok('has ascendant + MC', !!chart.ascendant && !!chart.midheaven);
ok('signatures non-empty', chart.signatures.length>0);

const noTime = buildChart({jdUT:JD, latitude:LAT, longitude:LON, timeKnown:false});
ok('unknown time omits ascendant', noTime.ascendant===null && noTime.houses===null);
ok('unknown time still has planets', noTime.planets.every(x=>x.sign));
ok('unknown time explains omission', noTime.warnings.some(w=>/omitted rather than guessed/i.test(w)));

console.log('\n--- sample report ---');
console.log(formatReport(chart,{placeName:'Boise, Idaho',date:'1985-07-04',time:'14:30',
  utcISO:'1985-07-04T20:30:00Z',latitude:LAT,longitude:LON}));
console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);

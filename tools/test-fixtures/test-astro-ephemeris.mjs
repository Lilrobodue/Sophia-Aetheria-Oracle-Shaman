import { JPL_GROUND_TRUTH } from './jpl-ground-truth.js';
import { centuriesTT, sunPosition, moonPosition, planetPosition, angleDiff,
         ascendantMC, eclipticPointAltitude, allBodies } from '../astro-ephemeris.js';

const arcmin = d => Math.abs(d) * 60;
let worst = { err: 0 }; const rows = [];

for (const ep of JPL_GROUND_TRUTH) {
  const T = centuriesTT(ep.jd_ut);
  for (const [body, ref] of Object.entries(ep.bodies)) {
    let p;
    if (body === 'Sun') p = sunPosition(T);
    else if (body === 'Moon') p = moonPosition(T);
    else p = planetPosition(body, T);
    const err = arcmin(angleDiff(p.lon, ref.lon));
    rows.push({ epoch: ep.utc.slice(0,10), body, mine: p.lon, ref: ref.lon, err });
    if (err > worst.err) worst = { err, body, epoch: ep.utc.slice(0,10) };
  }
}

console.log('LONGITUDE ERROR vs JPL HORIZONS (arcminutes)\n');
const byBody = {};
for (const r of rows) (byBody[r.body] ||= []).push(r.err);
console.log('body        max      mean');
for (const [b, errs] of Object.entries(byBody)) {
  const mx = Math.max(...errs), mn = errs.reduce((a,c)=>a+c,0)/errs.length;
  console.log(b.padEnd(10), mx.toFixed(2).padStart(7), mn.toFixed(2).padStart(9), mx > 15 ? '  <-- BAD' : mx > 5 ? '  <- check' : '');
}
console.log('\nworst overall:', worst.err.toFixed(2), "arcmin  ("+worst.body, worst.epoch+")");

// Ascendant self-check: needs no reference software. A correct ascendant lies
// ON the horizon (altitude 0) and on the EASTERN side (azimuth 0-180).
console.log('\nASCENDANT SELF-CHECK (altitude must be ~0, azimuth eastern)');
let ascOk = true;
for (const [jd, lat, lon, label] of [
  [2446251.35417, 43.6135, -116.2023, 'Boise 1985'],
  [2451545.0,     51.5074,   -0.1278, 'London 2000'],
  [2460409.26181,-33.8688,  151.2093, 'Sydney 2024'],
  [2440423.34514, 64.1466,  -21.9426, 'Reykjavik 1969'],
]) {
  const { ascendant, mc } = ascendantMC(jd, lat, lon);
  const a = eclipticPointAltitude(ascendant, 0, jd, lat, lon);
  const m = eclipticPointAltitude(mc, 0, jd, lat, lon);
  const east = a.azimuth > 0 && a.azimuth < 180;
  const mcMeridian = Math.min(Math.abs(m.hourAngle), Math.abs(m.hourAngle-360)) < 0.01;
  const good = Math.abs(a.altitude) < 0.01 && east && mcMeridian;
  if (!good) ascOk = false;
  console.log(' ', label.padEnd(16), 'ASC', ascendant.toFixed(2).padStart(7),
    'alt', a.altitude.toFixed(4).padStart(8), 'az', a.azimuth.toFixed(1).padStart(6),
    '| MC', mc.toFixed(2).padStart(7), 'HA', m.hourAngle.toFixed(4).padStart(8), good ? 'OK' : 'FAIL');
}
console.log(ascOk ? '  all ascendants on the horizon, rising in the east' : '  ASCENDANT LOGIC BROKEN');

// Retrograde sanity: Mercury retrograde ~18% of the time, Sun/Moon never.
const sample = [];
for (let i=0;i<400;i++) sample.push(allBodies(2451545.0 + i*7));
const frac = n => sample.filter(s=>s.find(b=>b.name===n).retrograde).length/sample.length;
console.log('\nRETROGRADE FRACTION over ~7.7 years (expected in parens)');
for (const [n,lo,hi] of [['Sun',0,0],['Moon',0,0],['Mercury',0.13,0.24],['Venus',0.04,0.10],
                          ['Mars',0.07,0.13],['Jupiter',0.28,0.36],['Saturn',0.32,0.40],
                          ['Uranus',0.37,0.45],['Neptune',0.38,0.46],['Pluto',0.38,0.46]]) {
  const f = frac(n);
  console.log(' ', n.padEnd(9), (f*100).toFixed(1).padStart(5)+'%',
    `(${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%)`, (f>=lo-0.02&&f<=hi+0.02)?'OK':'<-- OFF');
}

import { localToUTC, julianDayUTC, resolvePlace, resolveBirthMoment }
  from '../astro-place.js';
let p=0,f=0; const ok=(n,c,extra='')=>{c?p++:f++;console.log((c?'  PASS  ':'  FAIL  ')+n+(extra?'  '+extra:''));};

ok('JD J2000 = 2451545.0', julianDayUTC(2000,1,1,12,0,0)===2451545.0);
ok('JD 1969-07-20 20:17 UT', Math.abs(julianDayUTC(1969,7,20,20,17,0)-2440423.34514)<1e-5);
ok('JD 1582-10-15 Gregorian reform', julianDayUTC(1582,10,15,0,0,0)===2299160.5);
ok('JD 1582-10-04 last Julian day', julianDayUTC(1582,10,4,0,0,0)===2299159.5);

const mdt = localToUTC('1985-07-04','14:30','America/Boise');
ok('summer MDT offset -360', mdt.offsetMinutes===-360, 'got '+mdt.offsetMinutes);
ok('summer MDT -> 20:30 UTC', mdt.utcISO.startsWith('1985-07-04T20:30'), mdt.utcISO);
ok('winter MST offset -420', localToUTC('1985-01-04','14:30','America/Boise').offsetMinutes===-420);
ok('British Standard Time 1968 = +60', localToUTC('1968-06-15','09:00','Europe/London').offsetMinutes===60);
ok('US WWII War Time = -240', localToUTC('1942-08-20','11:00','America/New_York').offsetMinutes===-240);
ok('half-hour zone +330', localToUTC('1990-03-10','12:00','Asia/Kolkata').offsetMinutes===330);
ok('normal time produces no DST warning', localToUTC('1985-07-04','14:30','America/Boise').warnings.length===0);

const gap = localToUTC('2024-03-10','02:30','America/New_York');
ok('spring-forward gap warns', gap.warnings.some(w=>/did not exist/i.test(w)), JSON.stringify(gap.warnings));
const amb = localToUTC('2024-11-03','01:30','America/New_York');
ok('fall-back overlap warns', amb.warnings.some(w=>/occurred TWICE/i.test(w)), JSON.stringify(amb.warnings));
ok('overlap picks first (EDT, -240)', amb.offsetMinutes===-240, 'got '+amb.offsetMinutes);

const noTime = localToUTC('1985-07-04', null, 'America/Boise');
ok('unknown time -> timeKnown false', noTime.timeKnown===false);
ok('unknown time -> noon local', noTime.utcISO.startsWith('1985-07-04T18:00'), noTime.utcISO);
ok('unknown time warns about houses', noTime.warnings.some(w=>/Houses, Ascendant/i.test(w)));

const bad = fn => { try { fn(); return false; } catch { return true; } };
ok('rejects malformed date', bad(()=>localToUTC('4 July 1985','14:30','UTC')));
ok('rejects malformed time', bad(()=>localToUTC('1985-07-04','2:30pm','UTC')));
ok('rejects hour 25', bad(()=>localToUTC('1985-07-04','25:00','UTC')));
ok('rejects unknown timezone', bad(()=>localToUTC('1985-07-04','14:30','Mars/Olympus')));

const off = await resolvePlace('Boise, Idaho, USA');
ok('offline table hit with qualifiers', off.source==='offline' && Math.abs(off.latitude-43.615)<0.01, off.name);
const coords = await resolvePlace('43.6135, -116.20345');
ok('explicit coordinates', coords.source==='coordinates' && coords.longitude<-116);
ok('rejects out-of-range coords', await resolvePlace('91, 0').then(()=>false,()=>true));
const accent = await resolvePlace('Sao Paulo');
ok('offline accent-folded match', accent.latitude<-23 && accent.timezone==='America/Sao_Paulo', accent.name);
const online = await resolvePlace('Twin Falls, Idaho');
ok('online geocode fallback', online && online.source==='open-meteo' && Math.abs(online.latitude-42.56)<0.3, (online&&online.name)+' '+(online&&online.latitude));

const bm = await resolveBirthMoment({ date:'1985-07-04', time:'14:30', place:'Boise, Idaho' });
ok('end-to-end jdUT', Math.abs(bm.time.jdUT-2446251.35417)<1e-5, 'jd='+bm.time.jdUT);

console.log('\n'+p+' passed, '+f+' failed');
process.exit(f?1:0);

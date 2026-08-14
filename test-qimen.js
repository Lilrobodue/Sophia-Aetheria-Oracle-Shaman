/* test-qimen.js — the chart is deterministic, so everything about it is testable.
 * Plain node:  node test-qimen.js
 *
 * What this pins down, in order of how badly a mistake would hurt:
 *   1. the ju table against the classical 三元歌 verses (a wrong ju = a wrong chart)
 *   2. solar terms against published 2026 dates (the ju depends on the term)
 *   3. the day pillar against known ganzhi days (the yuan depends on the day)
 *   4. structural invariants of the plates (nothing lost, nothing duplicated)
 */
const { QiMen, QIMEN_TOOLS } = require('./qimen-core.js');

let fail = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { console.log('  FAIL: ' + m); fail++; } };
const section = s => console.log('--- ' + s + ' ---');

/* ═══ 1. The ju table, read straight off the classical verses ═══════════════ */
section('Ju table vs the 三元歌');
// 陽遁「冬至驚蟄一七四，小寒二八五，大寒春分三九六，雨水九六三，立春八五二，
//      清明立夏四一七，穀雨小滿五二八，芒種六三九」
const YANG_VERSE = {
  '冬至':[1,7,4], '驚蟄':[1,7,4], '小寒':[2,8,5], '大寒':[3,9,6], '春分':[3,9,6],
  '雨水':[9,6,3], '立春':[8,5,2], '清明':[4,1,7], '立夏':[4,1,7],
  '穀雨':[5,2,8], '小滿':[5,2,8], '芒種':[6,3,9],
};
// 陰遁「夏至白露九三六，小暑八二五，大暑秋分七一四，立秋二五八，處暑一四七，
//      寒露立冬六九三，霜降小雪五八二，大雪四七一」
const YIN_VERSE = {
  '夏至':[9,3,6], '白露':[9,3,6], '小暑':[8,2,5], '大暑':[7,1,4], '秋分':[7,1,4],
  '立秋':[2,5,8], '處暑':[1,4,7], '寒露':[6,9,3], '立冬':[6,9,3],
  '霜降':[5,8,2], '小雪':[5,8,2], '大雪':[4,7,1],
};
for (const [term, want] of Object.entries(YANG_VERSE)) {
  ok(JSON.stringify(QiMen.JU[term]) === JSON.stringify(want), `陽遁 ${term} = ${want}`);
  ok(QiMen.YANG_TERMS.has(term), `${term} is yang dun`);
}
for (const [term, want] of Object.entries(YIN_VERSE)) {
  ok(JSON.stringify(QiMen.JU[term]) === JSON.stringify(want), `陰遁 ${term} = ${want}`);
  ok(!QiMen.YANG_TERMS.has(term), `${term} is yin dun`);
}
ok(Object.keys(QiMen.JU).length === 24, 'all 24 terms have a ju triple');
ok(QiMen.YANG_TERMS.size === 12, 'exactly 12 yang terms');
// 立秋 must be 2-5-8, not 1-4-7 — otherwise 2-5-8 appears nowhere in yin dun.
const yinNumbers = new Set(Object.entries(QiMen.JU)
  .filter(([t]) => !QiMen.YANG_TERMS.has(t)).map(([, v]) => v.join('')));
ok(yinNumbers.has('258'), '2-5-8 exists in yin dun (立秋 is not a duplicate of 處暑)');
ok(new Set(Object.values(QiMen.JU).map(v => v.join(''))).size === 16,
   '16 distinct ju patterns across the 24 terms');

/* ═══ 2. Solar terms vs published 2026 dates ════════════════════════════════ */
section('Solar terms vs published dates (UTC dates, ±1 day tolerance)');
// Published jieqi instants for 2026 (China Standard Time, UTC+8), converted to UTC date.
const TERM_2026 = [
  ['2026-01-05', '小寒'], ['2026-01-20', '大寒'], ['2026-02-04', '立春'],
  ['2026-02-18', '雨水'], ['2026-03-05', '驚蟄'], ['2026-03-20', '春分'],
  ['2026-04-05', '清明'], ['2026-04-20', '穀雨'], ['2026-05-05', '立夏'],
  ['2026-05-21', '小滿'], ['2026-06-05', '芒種'], ['2026-06-21', '夏至'],
  ['2026-07-07', '小暑'], ['2026-07-23', '大暑'], ['2026-08-07', '立秋'],
  ['2026-08-23', '處暑'], ['2026-09-07', '白露'], ['2026-09-23', '秋分'],
  ['2026-10-08', '寒露'], ['2026-10-23', '霜降'], ['2026-11-07', '立冬'],
  ['2026-11-22', '小雪'], ['2026-12-07', '大雪'], ['2026-12-21', '冬至'],
];
for (const [iso, want] of TERM_2026) {
  const [y, m, d] = iso.split('-').map(Number);
  // Sample noon UTC on the day AFTER the boundary — safely inside the new term.
  const jd = QiMen.julianDayUTC(y, m, d + 1, 12, 0);
  const got = QiMen.solarTermAt(jd).name;
  ok(got === want, `${iso} +1d is in ${want} (got ${got})`);
}

/* ═══ 3. Day pillar ════════════════════════════════════════════════════════ */
section('Day pillar');
const jdn = (y, m, d) => Math.floor(QiMen.julianDayUTC(y, m, d, 12, 0) + 0.5);
ok(QiMen.ganzhi(QiMen.dayPillarIndex(jdn(2000, 1, 1))) === '戊午', '2000-01-01 is 戊午');
// The cycle must be exactly 60 days long and advance by one each day.
const base = QiMen.dayPillarIndex(jdn(2026, 8, 14));
ok(QiMen.dayPillarIndex(jdn(2026, 8, 15)) === (base + 1) % 60, 'advances one per day');
ok(QiMen.dayPillarIndex(jdn(2026, 8, 14 + 60)) === base, 'repeats after 60 days');
// Every index must pair stem and branch consistently.
let pairOk = true;
for (let i = 0; i < 60; i++) if (QiMen.ganzhi(i)[0] !== QiMen.STEMS[i % 10]) pairOk = false;
ok(pairOk, 'stem/branch pairing holds across the whole cycle');

/* ═══ 4. The yuan, from the twelve 符頭 ═════════════════════════════════════ */
section('Yuan from the fu tou');
const FU_TOU = {
  '甲子':'上元','己卯':'上元','甲午':'上元','己酉':'上元',
  '己巳':'中元','甲申':'中元','己亥':'中元','甲寅':'中元',
  '甲戌':'下元','己丑':'下元','甲辰':'下元','己未':'下元',
};
for (const [gz, want] of Object.entries(FU_TOU)) {
  let idx = -1;
  for (let i = 0; i < 60; i++) if (QiMen.ganzhi(i) === gz) idx = i;
  ok(idx >= 0, `${gz} exists in the cycle`);
  ok(QiMen.yuanFor(idx).name === want, `${gz} leads ${want}`);
  // Every day in that fu tou's five-day block shares its yuan.
  let block = true;
  for (let k = 0; k < 5; k++) if (QiMen.yuanFor(idx + k).name !== want) block = false;
  ok(block, `all five days under ${gz} are ${want}`);
}

/* ═══ 5. Earth plate ═══════════════════════════════════════════════════════ */
section('Earth plate');
for (const yang of [true, false]) {
  for (let ju = 1; ju <= 9; ju++) {
    const plate = QiMen.earthPlate(ju, yang);
    const cells = Object.keys(plate);
    ok(cells.length === 9, `${yang?'yang':'yin'} ju ${ju}: all nine palaces filled`);
    ok(new Set(Object.values(plate)).size === 9, `${yang?'yang':'yin'} ju ${ju}: no stem repeats`);
    ok(plate[ju] === '戊', `${yang?'yang':'yin'} ju ${ju}: 戊 sits in palace ${ju}`);
  }
}
// Direction of travel: yang ascends palace numbers, yin descends.
ok(QiMen.earthPlate(1, true)[2] === '己', 'yang ju 1: 己 follows 戊 into palace 2');
ok(QiMen.earthPlate(9, false)[8] === '己', 'yin ju 9: 己 follows 戊 into palace 8');

/* ═══ 6. A whole chart ═════════════════════════════════════════════════════ */
section('Full chart invariants');
const samples = ['2026-01-15T09:30:00', '2026-06-25T14:00:00', '2026-08-14T23:30:00',
                 '2026-11-02T03:15:00', '2026-12-22T00:10:00'];
for (const iso of samples) {
  const c = QiMen.castQimen({ date: iso, question: 'test' });
  ok(!c.error, `${iso}: casts without error`);
  ok(c.palaces.length === 9, `${iso}: nine palaces`);
  ok(c.ju >= 1 && c.ju <= 9, `${iso}: ju in 1..9 (${c.juLabel})`);

  const gates = c.palaces.map(p => p.gate).filter(Boolean);
  ok(gates.length === 8, `${iso}: eight gates placed`);
  ok(new Set(gates).size === 8, `${iso}: no gate repeats`);

  const stars = c.palaces.map(p => p.star).filter(Boolean);
  ok(stars.length === 9, `${iso}: nine stars placed (incl. 天禽)`);
  ok(new Set(stars).size === 9, `${iso}: no star repeats`);

  const spirits = c.palaces.map(p => p.spirit).filter(Boolean);
  ok(spirits.length === 8, `${iso}: eight spirits placed`);
  ok(new Set(spirits).size === 8, `${iso}: no spirit repeats`);

  const earth = c.palaces.map(p => p.earthStem).filter(Boolean);
  ok(new Set(earth).size === 9, `${iso}: nine distinct earth stems`);
  const heaven = c.palaces.map(p => p.heavenStem).filter(Boolean);
  ok(new Set(heaven).size === 9, `${iso}: nine distinct heaven stems`);

  ok(c.palaces.filter(p => p.isChief).length === 1, `${iso}: exactly one Chief palace`);
  ok(c.palaces.filter(p => p.isEnvoy).length === 1, `${iso}: exactly one Envoy palace`);
  ok(c.provenance.mode === 'time-chart', `${iso}: declares itself a time chart`);
}

/* ═══ 7. Determinism — the whole point of a time chart ═════════════════════ */
section('Determinism');
const a = QiMen.castQimen({ date: '2026-08-14T10:00:00' });
const b = QiMen.castQimen({ date: '2026-08-14T10:00:00' });
const strip = c => { const x = JSON.parse(JSON.stringify(c)); delete x.provenance.timestamp; return x; };
ok(JSON.stringify(strip(a)) === JSON.stringify(strip(b)), 'same minute gives an identical chart');
const later = QiMen.castQimen({ date: '2026-08-14T12:00:00' });
ok(JSON.stringify(strip(a)) !== JSON.stringify(strip(later)), 'a different hour gives a different chart');
// 23:00 must roll the day pillar forward (晚子時).
const before23 = QiMen.castQimen({ date: '2026-08-14T22:30:00' });
const after23  = QiMen.castQimen({ date: '2026-08-14T23:30:00' });
ok(!before23.pillars.rolledToNextDay && after23.pillars.rolledToNextDay,
   'the day pillar rolls at 23:00, not midnight');
ok(before23.pillars.day !== after23.pillars.day, 'and the day pillar actually differs across it');

/* ═══ 8. Tool registration ═════════════════════════════════════════════════ */
section('Tool');
const t = QIMEN_TOOLS.qimen_chart;
ok(t && t.name === 'qimen_chart', 'tool is exported');
ok(t.enabled === false, 'ships opt-in, like the other specialist traditions');
const res = t.code({ question: 'what now?' });
ok(res.success === true && res.chart && res.chart.palaces.length === 9, 'tool returns a chart');
ok(/NOT a random draw|not a draw/i.test(t.description + res.chart.provenance.note),
   'the result says out loud that it is not a draw');

console.log('');
console.log(fail ? `${fail} of ${count} FAILED` : `ALL ${count} QI MEN TESTS PASSED`);
process.exit(fail ? 1 : 0);

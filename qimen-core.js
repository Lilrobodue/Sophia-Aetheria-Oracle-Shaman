/* ============================================================================
 * qimen-core.js — 奇門遁甲 Qi Men Dun Jia for Sophia Aetheria Oracle Shaman
 * Sidecar module. Load BEFORE the main inline script in index.html:
 *   <script src="./qimen-core.js"></script>
 *
 * Exposes: window.QiMen (pure functions, no DOM, no network)
 *          window.QIMEN_TOOLS (spread into DIVINATION_TOOLS)
 *
 * WHAT THIS IS
 *   Every other oracle in this app is a LOT — something is drawn. Qi Men Dun Jia
 *   is not. It is a CHART OF A MOMENT: given an instant, the arrangement is
 *   fully determined. Cast the same minute twice and you get the same chart.
 *   Nothing here is random, and the provenance says so.
 *
 *   It sits on the Lo Shu nine palaces — the same square the Aetheria walks and
 *   the 27-cell cube are built from. That is why it belongs beside the others.
 *
 * SCHOOL — READ THIS BEFORE "FIXING" ANYTHING
 *   QMDJ has schools that disagree, and a chart from one is simply wrong in
 *   another. Ours is stated in the output rather than implied:
 *     · 轉盤奇門 (rotating plate), not 飛盤 (flying plate)
 *     · 拆補法 (chai bu) for the yuan — day-pillar direct, no intercalation
 *     · 中五寄坤二 — the centre palace lodges in palace 2
 *     · day boundary at 23:00 (晚子時 takes the next day's pillar)
 *   A chart that disagrees with another calculator is not automatically a bug;
 *   check which of these four it assumes first.
 *
 * SOURCES for the numbers that cannot be derived
 *   Ju table: the classical 三元歌 verses —
 *     陽遁「冬至驚蟄一七四，小寒二八五，大寒春分三九六，雨水九六三，立春八五二，
 *          清明立夏四一七，穀雨小滿五二八，芒種六三九」
 *     陰遁「夏至白露九三六，小暑八二五，大暑秋分七一四，立秋二五八，處暑一四七，
 *          寒露立冬六九三，霜降小雪五八二，大雪四七一」
 *   Yuan from the 符頭 (fu tou), the Jia/Ji day leading each five-day yuan:
 *     上元 甲子·己卯·甲午·己酉   中元 己巳·甲申·己亥·甲寅   下元 甲戌·己丑·甲辰·己未
 *   Scholarly reference for the tradition: J. Nollé is for the Greek oracles —
 *   for this, the tables above are standard across every published source we
 *   checked, and the module's own test file asserts them.
 * ========================================================================= */
(function (global) {
'use strict';

/* ------------------------------------------------------------ stems/branches */
const STEMS  = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const STEMS_PY = ['Jia','Yi','Bing','Ding','Wu','Ji','Geng','Xin','Ren','Gui'];
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
const BRANCHES_PY = ['Zi','Chou','Yin','Mao','Chen','Si','Wu','Wei','Shen','You','Xu','Hai'];

const ganzhi = i => STEMS[((i % 60) + 60) % 60 % 10] + BRANCHES[((i % 60) + 60) % 60 % 12];
const ganzhiPy = i => STEMS_PY[((i % 60) + 60) % 60 % 10] + '-' + BRANCHES_PY[((i % 60) + 60) % 60 % 12];

/* ---------------------------------------------------------- the nine palaces */
/* Lo Shu, drawn the Chinese way — 9 south at the top, 1 north at the bottom:
 *      4  9  2        SE  S  SW
 *      3  5  7   =    E   C  W
 *      8  1  6        NE  N  NW                                              */
const PALACES = {
  1: { num:1, trigram:'坎', trigramPy:'Kan',  dir:'N',  element:'Water', star:'天蓬', gate:'休門' },
  2: { num:2, trigram:'坤', trigramPy:'Kun',  dir:'SW', element:'Earth', star:'天芮', gate:'死門' },
  3: { num:3, trigram:'震', trigramPy:'Zhen', dir:'E',  element:'Wood',  star:'天冲', gate:'傷門' },
  4: { num:4, trigram:'巽', trigramPy:'Xun',  dir:'SE', element:'Wood',  star:'天輔', gate:'杜門' },
  5: { num:5, trigram:'中', trigramPy:'Zhong',dir:'C',  element:'Earth', star:'天禽', gate:null   },
  6: { num:6, trigram:'乾', trigramPy:'Qian', dir:'NW', element:'Metal', star:'天心', gate:'開門' },
  7: { num:7, trigram:'兌', trigramPy:'Dui',  dir:'W',  element:'Metal', star:'天柱', gate:'驚門' },
  8: { num:8, trigram:'艮', trigramPy:'Gen',  dir:'NE', element:'Earth', star:'天任', gate:'生門' },
  9: { num:9, trigram:'離', trigramPy:'Li',   dir:'S',  element:'Fire',  star:'天英', gate:'景門' },
};

/* The eight outer palaces in geographic clockwise order, starting north. The
 * centre is not on this ring — stars, gates and spirits travel it, and whatever
 * the centre would hold is lodged in palace 2 (中五寄坤二). */
const RING = [1, 8, 3, 4, 9, 2, 7, 6];
const ringIndex = p => RING.indexOf(p === 5 ? 2 : p);
const ringStep = (p, n) => RING[((ringIndex(p) + n) % 8 + 8) % 8];

const STARS  = ['天蓬','天任','天冲','天輔','天英','天芮','天柱','天心'];   // ring order
const STARS_EN = { '天蓬':'Peng','天任':'Ren','天冲':'Chong','天輔':'Fu','天英':'Ying',
                   '天芮':'Rui','天柱':'Zhu','天心':'Xin','天禽':'Qin' };
const GATES  = ['休門','生門','傷門','杜門','景門','死門','驚門','開門'];   // ring order
const GATES_EN = { '休門':'Rest','生門':'Life','傷門':'Harm','杜門':'Delusion',
                   '景門':'Scenery','死門':'Death','驚門':'Fear','開門':'Open' };
const GATE_OMEN = { '開門':'auspicious','休門':'auspicious','生門':'auspicious',
                    '杜門':'neutral','景門':'neutral',
                    '傷門':'inauspicious','死門':'inauspicious','驚門':'inauspicious' };
const SPIRITS = ['值符','螣蛇','太陰','六合','白虎','玄武','九地','九天'];
const SPIRITS_EN = { '值符':'Chief','螣蛇':'Serpent','太陰':'Moon','六合':'Harmony',
                     '白虎':'White Tiger','玄武':'Dark Warrior','九地':'Nine Earth','九天':'Nine Heaven' };

/* 三奇六儀 — the order they are laid into the palaces. Six Instruments first
 * (戊己庚辛壬癸), then the Three Wonders in reverse (丁丙乙). */
const QI_YI = ['戊','己','庚','辛','壬','癸','丁','丙','乙'];
const QI_YI_NOTE = { '乙':'Yi — the Sun wonder','丙':'Bing — the Moon wonder','丁':'Ding — the Star wonder' };

/* 旬首 — which Instrument stands in for 甲 in each of the six ten-day periods */
const XUN_YI = ['戊','己','庚','辛','壬','癸'];       // 甲子,甲戌,甲申,甲午,甲辰,甲寅
const XUN_NAME = ['甲子','甲戌','甲申','甲午','甲辰','甲寅'];

/* ------------------------------------------------------------- solar terms */
/* 24 terms at 15° steps of the Sun's apparent longitude, indexed from 立春=315°. */
const TERMS = [
  ['立春','Start of Spring'], ['雨水','Rain Water'],      ['驚蟄','Awakening of Insects'],
  ['春分','Spring Equinox'],  ['清明','Pure Brightness'],  ['穀雨','Grain Rain'],
  ['立夏','Start of Summer'], ['小滿','Grain Full'],       ['芒種','Grain in Ear'],
  ['夏至','Summer Solstice'], ['小暑','Minor Heat'],       ['大暑','Major Heat'],
  ['立秋','Start of Autumn'], ['處暑','End of Heat'],      ['白露','White Dew'],
  ['秋分','Autumn Equinox'],  ['寒露','Cold Dew'],         ['霜降','Frost Descent'],
  ['立冬','Start of Winter'], ['小雪','Minor Snow'],       ['大雪','Major Snow'],
  ['冬至','Winter Solstice'], ['小寒','Minor Cold'],       ['大寒','Major Cold'],
];

/* Ju numbers per term, upper/middle/lower yuan. Yang from 冬至 to 芒種,
 * yin from 夏至 to 大雪 — the two halves the solstices cut the year into. */
const JU = {
  // 陽遁
  '冬至':[1,7,4], '小寒':[2,8,5], '大寒':[3,9,6], '立春':[8,5,2], '雨水':[9,6,3], '驚蟄':[1,7,4],
  '春分':[3,9,6], '清明':[4,1,7], '穀雨':[5,2,8], '立夏':[4,1,7], '小滿':[5,2,8], '芒種':[6,3,9],
  // 陰遁
  '夏至':[9,3,6], '小暑':[8,2,5], '大暑':[7,1,4], '立秋':[2,5,8], '處暑':[1,4,7], '白露':[9,3,6],
  '秋分':[7,1,4], '寒露':[6,9,3], '霜降':[5,8,2], '立冬':[6,9,3], '小雪':[5,8,2], '大雪':[4,7,1],
};
const YANG_TERMS = new Set(['冬至','小寒','大寒','立春','雨水','驚蟄','春分','清明','穀雨','立夏','小滿','芒種']);

/* ----------------------------------------------------- sun's apparent longitude
 * Same truncated series as tools/astro-ephemeris.js sunPosition(), copied rather
 * than imported because this file is a classic script and that one is an ES
 * module. Keep them in step if either is ever corrected.
 * Accuracy ≈0.01°, which is ≈15 minutes of time at the Sun's mean motion — so a
 * chart cast within a quarter hour of a solar-term boundary may take the term on
 * the wrong side of it. Reported in provenance rather than hidden.            */
const D2R = Math.PI / 180;
const sin = d => Math.sin(d * D2R), cos = d => Math.cos(d * D2R);
const norm360 = d => ((d % 360) + 360) % 360;

function centuriesTT(jdUT) {
  const year = 2000 + (jdUT - 2451545.0) / 365.25;
  // Espenak/Meeus polynomial, adequate for the modern era
  const t = year - 2000;
  const dT = 62.92 + 0.32217 * t + 0.005589 * t * t;
  return (jdUT + dT / 86400 - 2451545.0) / 36525;
}

function sunApparentLongitude(jdUT) {
  const T = centuriesTT(jdUT);
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M  = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e  = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C  = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
           + (0.019993 - 0.000101 * T) * sin(2 * M)
           + 0.000289 * sin(3 * M);
  const trueLon = L0 + C;
  const v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));
  // nutation in longitude (leading term) + aberration
  const om = norm360(125.04452 - 1934.136261 * T);
  const dPsi = (-17.20 * sin(om)) / 3600;
  const aberr = -20.4898 / 3600 / R;
  return norm360(trueLon + dPsi + aberr);
}

function julianDayUTC(y, m, d, hh, mm) {
  let Y = y, M = m;
  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const dayFrac = d + (hh + mm / 60) / 24;
  return Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + dayFrac + B - 1524.5;
}

/* Which of the 24 terms an instant falls in: 0 = 立春 (315°) … 23 = 大寒 (300°) */
function solarTermAt(jdUT) {
  const lon = sunApparentLongitude(jdUT);
  const idx = Math.floor(norm360(lon - 315) / 15) % 24;
  return { index: idx, name: TERMS[idx][0], english: TERMS[idx][1],
           sunLongitude: +lon.toFixed(4) };
}

/* -------------------------------------------------------------- the pillars */
/* Day ganzhi from the Julian Day Number. Anchor: JDN 2451545 (2000-01-01) is
 * 戊午, index 54 — (JDN - 11) mod 60. The test file pins this. */
function dayPillarIndex(jdnNoon) { return (((jdnNoon - 11) % 60) + 60) % 60; }

function pillarsFor(dateLocal) {
  const y = dateLocal.getFullYear(), mo = dateLocal.getMonth() + 1, d = dateLocal.getDate();
  const hh = dateLocal.getHours(), mi = dateLocal.getMinutes();

  // 子時 opens at 23:00 and belongs to the NEXT day (晚子時).
  const rolled = hh >= 23;
  const jdnNoon = Math.floor(julianDayUTC(y, mo, d, 12, 0) + 0.5) + (rolled ? 1 : 0);
  const dayIdx = dayPillarIndex(jdnNoon);

  const branchIdx = Math.floor(((hh + 1) % 24) / 2);          // 23:00–00:59 → 子
  const dayStem = dayIdx % 10;
  const hourStem = ((dayStem % 5) * 2 + branchIdx) % 10;       // 五鼠遁
  // hour ganzhi index in the 60 cycle
  let hourIdx = 0;
  for (let i = 0; i < 60; i++) { if (i % 10 === hourStem && i % 12 === branchIdx) { hourIdx = i; break; } }

  return { dayIndex: dayIdx, hourIndex: hourIdx, hourBranch: branchIdx, rolledToNextDay: rolled };
}

/* ------------------------------------------------------------------ the yuan
 * 拆補法: the yuan comes from the 符頭 — the most recent Jia or Ji day, which is
 * always the day at (index - index mod 5). Its branch names the yuan.          */
const UPPER = new Set([0, 3, 6, 9]);     // 子 卯 午 酉
const MIDDLE = new Set([2, 5, 8, 11]);   // 寅 巳 申 亥
function yuanFor(dayIdx) {
  const fuTou = dayIdx - (dayIdx % 5);
  const b = fuTou % 12;
  const which = UPPER.has(b) ? 0 : MIDDLE.has(b) ? 1 : 2;
  return { yuan: which, name: ['上元','中元','下元'][which],
           english: ['upper','middle','lower'][which], fuTou: ganzhi(fuTou) };
}

/* ---------------------------------------------------------------- the plates */
/* 地盤 — the Six Instruments then the Three Wonders, laid from the ju palace,
 * ascending palace numbers in yang dun and descending in yin. */
function earthPlate(ju, yang) {
  const plate = {};
  for (let i = 0; i < 9; i++) {
    const p = (((ju - 1 + (yang ? i : -i)) % 9) + 9) % 9 + 1;
    plate[p] = QI_YI[i];
  }
  return plate;
}

function castQimen(opts) {
  const o = Object.assign({ date: null, question: null }, opts || {});
  const when = o.date ? new Date(o.date) : new Date();
  if (isNaN(when)) return { error: 'Invalid date' };

  const jdUT = julianDayUTC(when.getFullYear(), when.getMonth() + 1, when.getDate(),
                            when.getHours() - when.getTimezoneOffset() / 60, when.getMinutes());
  const term = solarTermAt(jdUT);
  const yang = YANG_TERMS.has(term.name);
  const P = pillarsFor(when);
  const Y = yuanFor(P.dayIndex);
  const ju = JU[term.name][Y.yuan];

  const earth = earthPlate(ju, yang);

  // 值符 follows the hour STEM; 值使 follows the hour BRANCH. Both start from the
  // palace holding this ten-day period's Instrument-standing-in-for-甲.
  const xun = Math.floor(P.hourIndex / 10);
  const xunYi = XUN_YI[xun];
  const stepsIntoXun = P.hourIndex % 10;
  let xunPalace = 5;
  for (const p of Object.keys(earth)) if (earth[p] === xunYi) xunPalace = +p;

  const zhiFuStar = PALACES[xunPalace].star;
  const zhiShiGate = PALACES[xunPalace === 5 ? 2 : xunPalace].gate;

  // The hour stem's palace on the earth plate is where 值符 is carried to. 甲
  // never appears on a plate — when the hour stem is 甲 it rides its Instrument.
  const hourStemChar = STEMS[P.hourIndex % 10];
  const carried = hourStemChar === '甲' ? xunYi : hourStemChar;
  let hourStemPalace = xunPalace;
  for (const p of Object.keys(earth)) if (earth[p] === carried) hourStemPalace = +p;

  // 天盤 — stars always travel the ring clockwise, in both dun (天盤永遠順排).
  const heaven = {}, stars = {};
  const shift = ringIndex(hourStemPalace) - ringIndex(xunPalace);
  for (let i = 0; i < 8; i++) {
    const from = RING[i];
    const to = ringStep(from, shift);
    stars[to] = PALACES[from].star;
    heaven[to] = earth[from];
  }
  stars[5] = '天禽';                 // the centre star lodges with palace 2's
  heaven[5] = earth[5];

  // 八門 — the Envoy gate steps out of its home palace by the hour's position in
  // the ten-day period, forward in yang dun and backward in yin. The rest follow.
  const gates = {};
  const zhiShiHome = xunPalace === 5 ? 2 : xunPalace;
  const zhiShiPalace = ringStep(zhiShiHome, yang ? stepsIntoXun : -stepsIntoXun);
  const gateStart = GATES.indexOf(zhiShiGate);
  for (let i = 0; i < 8; i++) {
    gates[ringStep(zhiShiPalace, yang ? i : -i)] = GATES[(gateStart + i) % 8];
  }

  // 八神 — led by 值符 from wherever the Chief star landed.
  const spirits = {};
  for (let i = 0; i < 8; i++) {
    spirits[ringStep(hourStemPalace, yang ? i : -i)] = SPIRITS[i];
  }

  const palaces = [1,2,3,4,5,6,7,8,9].map(n => {
    const base = PALACES[n];
    return {
      palace: n, trigram: base.trigram, trigramPy: base.trigramPy,
      direction: base.dir, element: base.element,
      earthStem: earth[n] || null,
      heavenStem: heaven[n] || null,
      star: stars[n] || null, starEn: STARS_EN[stars[n]] || null,
      gate: gates[n] || null, gateEn: GATES_EN[gates[n]] || null,
      gateOmen: gates[n] ? GATE_OMEN[gates[n]] : null,
      spirit: spirits[n] || null, spiritEn: SPIRITS_EN[spirits[n]] || null,
      wonder: QI_YI_NOTE[heaven[n]] || null,
      isChief: stars[n] === zhiFuStar,
      isEnvoy: gates[n] === zhiShiGate,
    };
  });

  return {
    question: o.question,
    moment: when.toISOString(),
    localTime: when.toLocaleString(),
    solarTerm: { name: term.name, english: term.english, sunLongitude: term.sunLongitude },
    dun: yang ? '陽遁' : '陰遁',
    dunEnglish: yang ? 'yang dun (ascending)' : 'yin dun (descending)',
    ju,
    juLabel: (yang ? '陽遁' : '陰遁') + ju + '局',
    yuan: { name: Y.name, english: Y.english, fuTou: Y.fuTou },
    pillars: {
      day: ganzhi(P.dayIndex), dayPy: ganzhiPy(P.dayIndex),
      hour: ganzhi(P.hourIndex), hourPy: ganzhiPy(P.hourIndex),
      xun: XUN_NAME[xun] + '旬', xunYi,
      rolledToNextDay: P.rolledToNextDay,
    },
    chief: { star: zhiFuStar, starEn: STARS_EN[zhiFuStar], palace: hourStemPalace },
    envoy: { gate: zhiShiGate, gateEn: GATES_EN[zhiShiGate], palace: zhiShiPalace },
    palaces,
    provenance: {
      mode: 'time-chart',
      school: '轉盤奇門 · 拆補法 · 中五寄坤二 · day boundary 23:00',
      note: 'Not a draw. This chart is fully determined by the instant it was cast — ' +
            'the same minute always gives the same chart. Schools disagree; this one is named above.',
      solarTermPrecision: '±15 min (truncated solar series) — a cast within a quarter ' +
                          'hour of a term change may take the term on the wrong side',
      timestamp: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------- tool export */
const QIMEN_TOOLS = {
  qimen_chart: {
    name: 'qimen_chart',
    description: 'Cast a Qi Men Dun Jia (奇門遁甲) chart for the present moment: the nine Lo Shu ' +
      'palaces with their Heaven and Earth stems, the Eight Gates, Nine Stars and Eight Spirits, ' +
      'plus the solar term, yuan, and the ju number they determine. This is a chart of a moment, ' +
      'NOT a random draw — the same minute always yields the same chart.',
    params: { question: { type:'string', description:'The matter being asked about' } },
    code: function (p) {
      try { return Object.assign({ success: true }, { chart: castQimen({ question: (p||{}).question }) }); }
      catch (e) { return { success: false, error: e.message }; }
    },
    enabled: false, default: true    // opt-in: a large result, specialist tradition
  }
};

const QiMen = {
  PALACES, RING, STARS, GATES, SPIRITS, QI_YI, TERMS, JU, YANG_TERMS,
  STEMS, BRANCHES, ganzhi, ganzhiPy, sunApparentLongitude, julianDayUTC,
  solarTermAt, dayPillarIndex, pillarsFor, yuanFor, earthPlate, castQimen,
  ringStep, ringIndex, GATES_EN, STARS_EN, SPIRITS_EN, GATE_OMEN,
};

global.QiMen = QiMen;
global.QIMEN_TOOLS = QIMEN_TOOLS;
if (typeof module !== 'undefined' && module.exports) module.exports = { QiMen, QIMEN_TOOLS };

})(typeof window !== 'undefined' ? window : globalThis);

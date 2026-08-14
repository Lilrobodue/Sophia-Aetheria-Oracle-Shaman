/* ============================================================================
 * divination-core.js — Sophia Aetheria Oracle Shaman
 * Sidecar module. Load BEFORE the main inline script in index.html:
 *   <script src="./divination-core.js"></script>
 *
 * Exposes: window.Divination  (pure functions, no DOM, no network)
 *          window.DIVINATION_TOOLS  (spread into defaultTools)
 *
 * DESIGN CONTRACT
 *   1. Two casting modes, never blended, never mislabeled:
 *        'state'   — deterministic readout of neural state. NOT random.
 *        'entropy' — EEG bits XOR crypto.getRandomValues. Never worse than CSPRNG.
 *   2. Every reading carries a `provenance` object. No silent fallbacks.
 *   3. No translated judgment/commentary text in this file (copyright). Names and
 *      structure only — Sophia already knows the I Ching and speaks it herself.
 *   4. Nothing here makes a health claim. Frequencies are suggestions to listen to.
 * ========================================================================= */
(function (global) {
'use strict';

/* ---------------------------------------------------------------- trigrams */
/* Bit strings are BOTTOM-TO-TOP. bits[0] = line 1 (bottom). 1 = yang. */
const TRIGRAMS = {
  '111': { id:'qian', name:'Qián', en:'Heaven',   glyph:'☰' },
  '110': { id:'dui',  name:'Duì',  en:'Lake',     glyph:'☱' },
  '101': { id:'li',   name:'Lí',   en:'Fire',     glyph:'☲' },
  '100': { id:'zhen', name:'Zhèn', en:'Thunder',  glyph:'☳' },
  '011': { id:'xun',  name:'Xùn',  en:'Wind',     glyph:'☴' },
  '010': { id:'kan',  name:'Kǎn',  en:'Water',    glyph:'☵' },
  '001': { id:'gen',  name:'Gèn',  en:'Mountain', glyph:'☶' },
  '000': { id:'kun',  name:'Kūn',  en:'Earth',    glyph:'☷' }
};

/* ------------------------------------------------- 64 hexagrams, King Wen */
/* [number, bits(bottom->top), pinyin, english] */
const HEX_RAW = [
  [1,'111111','Qián','The Creative'],            [2,'000000','Kūn','The Receptive'],
  [3,'100010','Zhūn','Difficulty at the Beginning'],[4,'010001','Méng','Youthful Folly'],
  [5,'111010','Xū','Waiting'],                   [6,'010111','Sòng','Conflict'],
  [7,'010000','Shī','The Army'],                 [8,'000010','Bǐ','Holding Together'],
  [9,'111011','Xiǎo Xù','The Taming Power of the Small'],[10,'110111','Lǚ','Treading'],
  [11,'111000','Tài','Peace'],                   [12,'000111','Pǐ','Standstill'],
  [13,'101111','Tóng Rén','Fellowship'],         [14,'111101','Dà Yǒu','Possession in Great Measure'],
  [15,'001000','Qiān','Modesty'],                [16,'000100','Yù','Enthusiasm'],
  [17,'100110','Suí','Following'],               [18,'011001','Gǔ','Work on What Has Been Spoiled'],
  [19,'110000','Lín','Approach'],                [20,'000011','Guān','Contemplation'],
  [21,'100101','Shì Hé','Biting Through'],       [22,'101001','Bì','Grace'],
  [23,'000001','Bō','Splitting Apart'],          [24,'100000','Fù','Return'],
  [25,'100111','Wú Wàng','Innocence'],           [26,'111001','Dà Xù','The Taming Power of the Great'],
  [27,'100001','Yí','Nourishment'],              [28,'011110','Dà Guò','Preponderance of the Great'],
  [29,'010010','Kǎn','The Abysmal'],             [30,'101101','Lí','Radiance'],
  [31,'001110','Xián','Influence'],              [32,'011100','Héng','Duration'],
  [33,'001111','Dùn','Retreat'],                 [34,'111100','Dà Zhuàng','The Power of the Great'],
  [35,'000101','Jìn','Progress'],                [36,'101000','Míng Yí','Darkening of the Light'],
  [37,'101011','Jiā Rén','The Family'],          [38,'110101','Kuí','Opposition'],
  [39,'001010','Jiǎn','Obstruction'],            [40,'010100','Xiè','Deliverance'],
  [41,'110001','Sǔn','Decrease'],                [42,'100011','Yì','Increase'],
  [43,'111110','Guài','Breakthrough'],           [44,'011111','Gòu','Coming to Meet'],
  [45,'000110','Cuì','Gathering Together'],      [46,'011000','Shēng','Pushing Upward'],
  [47,'010110','Kùn','Oppression'],              [48,'011010','Jǐng','The Well'],
  [49,'101110','Gé','Revolution'],               [50,'011101','Dǐng','The Caldron'],
  [51,'100100','Zhèn','The Arousing'],           [52,'001001','Gèn','Keeping Still'],
  [53,'001011','Jiàn','Development'],            [54,'110100','Guī Mèi','The Marrying Maiden'],
  [55,'101100','Fēng','Abundance'],              [56,'001101','Lǚ','The Wanderer'],
  [57,'011011','Xùn','The Gentle'],              [58,'110110','Duì','The Joyous'],
  [59,'010011','Huàn','Dispersion'],             [60,'110010','Jié','Limitation'],
  [61,'110011','Zhōng Fú','Inner Truth'],        [62,'001100','Xiǎo Guò','Preponderance of the Small'],
  [63,'101010','Jì Jì','After Completion'],      [64,'010101','Wèi Jì','Before Completion']
];

const HEXAGRAMS = HEX_RAW.map(([num, bits, pinyin, english]) => ({
  num, bits, pinyin, english,
  lower: TRIGRAMS[bits.slice(0, 3)],
  upper: TRIGRAMS[bits.slice(3, 6)],
  yangCount: bits.split('').filter(b => b === '1').length,
  glyphPair: TRIGRAMS[bits.slice(3, 6)].glyph + TRIGRAMS[bits.slice(0, 3)].glyph
}));

const BY_BITS = {};
HEXAGRAMS.forEach(h => { BY_BITS[h.bits] = h; });
const byNum  = n => HEXAGRAMS[n - 1];
const byBits = b => BY_BITS[b] || null;

/* -------------------------------------------------- structural operations */
const invert    = bits => bits.split('').reverse().join('');          // turn upside down
const complement= bits => bits.split('').map(b => b === '1' ? '0' : '1').join('');
/* Nuclear (hù) hexagram: lower = lines 2,3,4 ; upper = lines 3,4,5 */
const nuclear   = bits => bits.slice(1, 4) + bits.slice(2, 5);
const hamming   = (a, b) => { let d = 0; for (let i = 0; i < 6; i++) if (a[i] !== b[i]) d++; return d; };

/* ------------------------------------------- Aetheria frequency bridging */
/* The 27 Aetheria positions each carry a hexagram. The other 37 hexagrams get
 * bridged by minimum Hamming distance on the six lines — i.e. "how many single
 * line-changes away is the nearest mapped hexagram." This is OUR convention,
 * not tradition, but it uses the I Ching's own operation (line change) as the
 * metric rather than an arbitrary modulo. Ties are all returned. */
function aetheriaForHexagram(hexNum, freqTable) {
  const table = freqTable || global.AETHERIA_FREQUENCIES || [];
  const direct = table.find(f => f.hex === hexNum);
  if (direct) return { match: 'direct', distance: 0, positions: [direct] };

  const bits = byNum(hexNum).bits;
  let best = 7, hits = [];
  table.forEach(f => {
    const target = byNum(f.hex);
    if (!target) return;
    const d = hamming(bits, target.bits);
    if (d < best) { best = d; hits = [f]; }
    else if (d === best) hits.push(f);
  });
  return { match: 'bridged', distance: best, positions: hits };
}

/* ============================================================== ENTROPY ==
 * EEG windows arrive as an array of frames:
 *   { t, bandpowers:{delta,theta,alpha,beta,gamma}, metrics:{focus,meditation},
 *     quality: 0..1 }
 * Caller supplies these from the existing ring buffer (see BRIEF §4).
 * ======================================================================= */

/* THE MOMENT OF THE CAST.
 * Be clear about what this is and is not. XOR-ing a clock into a CSPRNG does not
 * make the draw more random — a CSPRNG is already indistinguishable from random,
 * and nothing mixed in can improve that. It is the same claim we make about the
 * EEG bits: provenance, not better randomness. A lot cast at this second is bound
 * to this second, and two casts in the same millisecond still differ because the
 * counter advances. That is the whole of the claim.
 *
 * It does earn its keep on the fallback path: when crypto.getRandomValues is
 * missing we drop to Math.random(), and in that case the clock and the counter
 * are real added variation rather than ceremony.                              */
let _castCounter = 0;

function castMoment() {
  const ms = Date.now();
  const hi = (typeof global.performance !== 'undefined' && global.performance.now)
    ? Math.floor(global.performance.now() * 1000) : 0;
  return { ms, hi, seq: ++_castCounter, iso: new Date(ms).toISOString() };
}

/* 64-bit-ish avalanche so neighbouring milliseconds do not produce neighbouring
 * salt bytes — a raw timestamp changes one low bit per cast and would leave most
 * of the salt constant across a session. */
function saltBytes(n, moment) {
  const out = new Uint8Array(n);
  let a = (moment.ms >>> 0) ^ 0x9e3779b9;
  let b = (Math.floor(moment.ms / 4294967296) ^ moment.hi) >>> 0;
  let c = (moment.seq * 0x85ebca6b) >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = (a ^ (a >>> 15)) >>> 0;
    t = Math.imul(t, (1 | b)) >>> 0;
    t = (t + Math.imul(t ^ (t >>> 7), (61 | c))) >>> 0;
    t = (t ^ (t >>> 14)) >>> 0;
    b = (b ^ t) >>> 0;
    c = (c + 0x27d4eb2f) >>> 0;
    out[i] = t & 0xff;
  }
  return out;
}

function cspBytes(n, moment) {
  const out = new Uint8Array(n);
  if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  // XOR is safe in both directions: uniform ^ anything independent stays uniform,
  // so the salt can never make the CSPRNG path worse than it already was.
  const salt = saltBytes(n, moment || castMoment());
  for (let i = 0; i < n; i++) out[i] ^= salt[i];
  return out;
}

/* Arousal index per frame: high beta/gamma = yang-leaning, high alpha/theta = yin */
function arousal(frame) {
  const b = frame.bandpowers || {};
  const hi = (b.beta || 0) + (b.gamma || 0);
  const lo = (b.alpha || 0) + (b.theta || 0) + (b.delta || 0);
  const tot = hi + lo;
  return tot > 0 ? hi / tot : 0.5;
}

function stats(arr) {
  const n = arr.length || 1;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const varr = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(varr), cv: mean > 0 ? Math.sqrt(varr) / mean : 0 };
}

/* Von Neumann debias a bit array: 10->1, 01->0, 00/11 discarded */
function debias(bits) {
  const out = [];
  for (let i = 0; i + 1 < bits.length; i += 2) {
    if (bits[i] !== bits[i + 1]) out.push(bits[i]);
  }
  return out;
}

/* ---- STATE MODE: deterministic readout. Distribution is NOT traditional. --
 * CRITICAL: there is no absolute pivot. Real EEG band power is 1/f-dominated, so
 * the beta+gamma share sits near 0.15, not 0.5 — a fixed 0.5 threshold returns
 * six yin lines every single time (verified: 88% hexagram 2, forever).
 * The pivot must be PERSONAL. Pass baseline/baselineCV from the user's rolling
 * history; on cold start we fall back to within-cast medians and say so.       */
const median = arr => { const s = [...arr].sort((x, y) => x - y); const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const quantile = (arr, q) => { const s = [...arr].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

/* CV PIVOT — read this before changing it.
 * `cvPivot` is an ABSOLUTE threshold on window variability, supplied by the host
 * from the user's own history (baseline-core hands over the 0.75 quantile of every
 * past window CV). Prefer it.
 *
 * `baselineCV * cvMultiplier` is the legacy path and it is treated as deprecated:
 * a multiple of a median lands at whatever percentile the spread of that
 * distribution happens to put it — measured at the 79th on one synthetic signal,
 * which is benign, but on a tighter distribution it sits above the 95th and
 * changing lines all but vanish, taking the relating hexagram with them. A
 * quantile sits at a fixed rank by construction. Do not reintroduce a multiplier
 * as the primary route.
 *
 * With no personal CV history at all we fall back to the within-cast 0.75
 * quantile. Note what that means: for six windows it is the 5th smallest, so
 * exactly ONE window is above it, and every cold-start cast has exactly one
 * changing line. Deterministic, not random — the honest cold-start behaviour is
 * "the most variable sixth of your window is the moving line", and it is reported
 * as within-cast-median in provenance. */
function linesFromState(frames, opts) {
  const o = Object.assign({ baseline: null, baselineCV: null, cvPivot: null,
                            cvMultiplier: 1.5 }, opts || {});
  const per = Math.max(1, Math.floor(frames.length / 6));
  const windows = [];
  for (let i = 0; i < 6; i++) {
    const a = frames.slice(i * per, (i + 1) * per).map(arousal);
    windows.push(stats(a));
  }
  const usedPersonalBaseline = o.baseline != null;
  const pivot = usedPersonalBaseline ? o.baseline : median(windows.map(w => w.mean));

  let cvPivot, cvSource;
  if (o.cvPivot != null) {
    cvPivot = o.cvPivot;               cvSource = 'personal-quantile';
  } else if (o.baselineCV != null) {
    cvPivot = o.baselineCV * o.cvMultiplier; cvSource = 'baseline-multiplier';
  } else {
    cvPivot = quantile(windows.map(w => w.cv), 0.75); cvSource = 'within-cast-quantile';
  }

  const lines = [], detail = [];
  windows.forEach((s, i) => {
    const yang = s.mean > pivot;
    const changing = s.cv > cvPivot;
    lines.push(yang ? (changing ? 9 : 7) : (changing ? 6 : 8));
    detail.push({ line: i + 1, arousal: +s.mean.toFixed(4), cv: +s.cv.toFixed(4), yang, changing });
  });
  return { lines, detail,
    pivots: { arousal: +pivot.toFixed(4), cv: +cvPivot.toFixed(4), cvSource: cvSource,
              source: usedPersonalBaseline ? 'personal-history' : 'within-cast-median' } };
}

/* ---- ENTROPY MODE: EEG bits XOR CSPRNG, mapped to yarrow or coin odds ---- */
function linesFromEntropy(frames, opts) {
  const o = Object.assign({ method: 'yarrow', moment: null }, opts || {});
  // Harvest raw bits from low-order digits of band powers
  let raw = [];
  frames.forEach(f => {
    const b = f.bandpowers || {};
    ['delta','theta','alpha','beta','gamma'].forEach(k => {
      const v = b[k];
      if (typeof v === 'number') raw.push(Math.floor(v * 10000) & 1);
    });
  });
  const eegBits = debias(raw);

  const need = 6 * 4;                      // 4 bits per line -> 0..15
  const csp = cspBytes(need, o.moment);
  const draws = [];
  for (let i = 0; i < 6; i++) {
    let v = csp[i * 4] & 0x0f;             // CSPRNG floor
    for (let k = 0; k < 4; k++) {          // XOR in EEG bits when available
      const bit = eegBits[i * 4 + k];
      if (bit === 0 || bit === 1) v ^= (bit << k);
    }
    draws.push(v & 0x0f);
  }

  const lines = draws.map(v => {
    if (o.method === 'coin') {             // 6:1/8  7:3/8  8:3/8  9:1/8
      if (v < 2) return 6;
      if (v < 8) return 7;
      if (v < 14) return 8;
      return 9;
    }                                      // yarrow: 6:1/16 7:5/16 8:7/16 9:3/16
    if (v < 1) return 6;
    if (v < 6) return 7;
    if (v < 13) return 8;
    return 9;
  });
  return { lines, detail: draws.map((v, i) => ({ line: i + 1, draw: v })),
           eegBitsUsed: Math.min(eegBits.length, need) };
}

/* ---------------------------------------------------------------- the cast */
function castIChing(opts) {
  const o = Object.assign({
    mode: 'entropy',            // 'state' | 'entropy'
    method: 'yarrow',           // entropy mode only
    frames: [],
    minQuality: 0.5,
    question: null,
    freqTable: null,
    baseline: null,             // personal rolling median arousal (state mode)
    baselineCV: null            // personal rolling median CV (state mode)
  }, opts || {});

  const usable = (o.frames || []).filter(f => (f.quality == null ? 1 : f.quality) >= o.minQuality);
  const haveEEG = usable.length >= 12;
  const moment = castMoment();
  let result, mode = o.mode, fallback = false;

  if (mode === 'state' && !haveEEG) { mode = 'entropy'; fallback = true; }
  result = (mode === 'state')
    ? linesFromState(usable, o)
    : linesFromEntropy(haveEEG ? usable : [], Object.assign({ moment }, o));

  const primaryBits  = result.lines.map(v => (v === 7 || v === 9) ? '1' : '0').join('');
  const changing     = result.lines.map((v, i) => (v === 6 || v === 9) ? i + 1 : 0).filter(Boolean);
  const relatingBits = result.lines
    .map(v => (v === 9 ? '0' : v === 6 ? '1' : (v === 7 ? '1' : '0'))).join('');

  const primary  = byBits(primaryBits);
  const relating = changing.length ? byBits(relatingBits) : null;
  const nuc      = byBits(nuclear(primaryBits));

  return {
    question: o.question,
    lines: result.lines,                     // bottom -> top, values 6/7/8/9
    changingLines: changing,
    primary:  hexSummary(primary,  o.freqTable),
    relating: relating ? hexSummary(relating, o.freqTable) : null,
    nuclear:  hexSummary(nuc, o.freqTable),
    opposite: hexSummary(byBits(complement(primaryBits)), o.freqTable),
    inverse:  hexSummary(byBits(invert(primaryBits)), o.freqTable),
    lineDetail: result.detail,
    provenance: {
      mode,
      requestedMode: o.mode,
      fallbackToCSPRNG: fallback || !haveEEG,
      method: mode === 'entropy' ? o.method : 'neural-state-readout',
      framesOffered: (o.frames || []).length,
      framesUsedAfterQualityGate: usable.length,
      minQuality: o.minQuality,
      eegBitsUsed: result.eegBitsUsed || 0,
      pivots: result.pivots || null,
      note: mode === 'state'
        ? 'Deterministic readout of EEG state. This is NOT a random draw and its line distribution will not match yarrow or coin odds.'
        : 'EEG-derived bits XOR CSPRNG XOR the moment of the cast. Statistically no worse than crypto.getRandomValues; the EEG and the clock contribute provenance, not quality.',
      castMoment: moment.iso,
      castSeq: moment.seq,
      timestamp: new Date().toISOString()
    }
  };
}

function hexSummary(h, freqTable) {
  if (!h) return null;
  return {
    num: h.num, bits: h.bits, pinyin: h.pinyin, english: h.english,
    glyphs: h.glyphPair, yangCount: h.yangCount,
    lower: h.lower.en, upper: h.upper.en,
    image: h.upper.en + ' over ' + h.lower.en,
    aetheria: aetheriaForHexagram(h.num, freqTable)
  };
}

/* ============================================================= GEOMANCY ==
 * Shield chart. 4 Mothers -> 4 Daughters -> 4 Nieces -> 2 Witnesses -> Judge.
 * Figure rows are Fire, Air, Water, Earth (top -> bottom). 1 = single dot.
 * Name<->row assignments reviewed against the classical table, and every
 * structural relation it implies holds here: Laetitia/Tristitia, Rubeus/Albus,
 * Fortuna Major/Minor, Puer/Puella and Caput/Cauda Draconis are reversal pairs;
 * Via/Populus, Carcer/Coniunctio and Acquisitio/Amissio are complements.
 * Still worth one pass against Greer or Agrippa in print (BRIEF §7) — a wrong
 * name would only move a label, the shield arithmetic is source-independent.
 * ======================================================================= */
const GEOMANTIC_FIGURES = [ /* [name, fire, air, water, earth]  1 = single dot */
  ['Via',            1,1,1,1], ['Populus',        0,0,0,0],
  ['Carcer',         1,0,0,1], ['Coniunctio',     0,1,1,0],
  ['Fortuna Major',  0,0,1,1], ['Fortuna Minor',  1,1,0,0],
  ['Acquisitio',     0,1,0,1], ['Amissio',        1,0,1,0],
  ['Laetitia',       1,0,0,0], ['Tristitia',      0,0,0,1],
  ['Rubeus',         0,1,0,0], ['Albus',          0,0,1,0],
  ['Puer',           1,1,0,1], ['Puella',         1,0,1,1],
  ['Cauda Draconis', 1,1,1,0], ['Caput Draconis', 0,1,1,1]
];
/* Build a lookup keyed by the four rows so name resolution is O(1) and unique. */
const GEO_BY_KEY = {};
GEOMANTIC_FIGURES.forEach(f => { GEO_BY_KEY[f.slice(1).join('')] = f[0]; });

const geoName = rows => GEO_BY_KEY[rows.join('')] || 'UNRESOLVED';
const geoAdd  = (a, b) => a.map((v, i) => (v + b[i]) % 2);
const geoPoints = rows => rows.reduce((s, v) => s + (v ? 1 : 2), 0);

function castGeomancy(opts) {
  const o = Object.assign({ frames: [], mode: 'entropy', minQuality: 0.5, question: null }, opts || {});
  const usable = (o.frames || []).filter(f => (f.quality == null ? 1 : f.quality) >= o.minQuality);
  const haveEEG = usable.length >= 8;

  // 16 rows of dots -> parity bits
  let bits = [];
  if (haveEEG) {
    const a = usable.map(arousal);
    for (let i = 0; i < 16; i++) {
      const v = a[Math.floor(i * a.length / 16)] || 0.5;
      bits.push(Math.floor(v * 1000) & 1);
    }
  }
  const moment = castMoment();
  const csp = cspBytes(16, moment);
  for (let i = 0; i < 16; i++) bits[i] = ((csp[i] & 1) ^ (bits[i] || 0));

  const mothers = [0,1,2,3].map(m => bits.slice(m * 4, m * 4 + 4));
  const daughters = [0,1,2,3].map(r => mothers.map(m => m[r]));
  const nieces = [
    geoAdd(mothers[0], mothers[1]), geoAdd(mothers[2], mothers[3]),
    geoAdd(daughters[0], daughters[1]), geoAdd(daughters[2], daughters[3])
  ];
  const rightWitness = geoAdd(nieces[0], nieces[1]);
  const leftWitness  = geoAdd(nieces[2], nieces[3]);
  const judge        = geoAdd(rightWitness, leftWitness);
  const reconciler   = geoAdd(judge, mothers[0]);

  const wrap = rows => ({ rows, name: geoName(rows), points: geoPoints(rows) });

  return {
    question: o.question,
    mothers: mothers.map(wrap), daughters: daughters.map(wrap), nieces: nieces.map(wrap),
    witnesses: { right: wrap(rightWitness), left: wrap(leftWitness) },
    judge: wrap(judge), reconciler: wrap(reconciler),
    valid: geoPoints(judge) % 2 === 0,     // classical validity check
    provenance: {
      mode: haveEEG ? 'eeg-xor-csprng' : 'csprng',
      framesUsed: usable.length,
      note: 'Judge must carry an even number of points to be a valid chart.',
      castMoment: moment.iso, castSeq: moment.seq,
      timestamp: new Date().toISOString()
    }
  };
}

/* ================================================================ TAROT ==*/
const MAJORS = ['The Fool','The Magician','The High Priestess','The Empress','The Emperor',
  'The Hierophant','The Lovers','The Chariot','Strength','The Hermit','Wheel of Fortune',
  'Justice','The Hanged Man','Death','Temperance','The Devil','The Tower','The Star',
  'The Moon','The Sun','Judgement','The World'];
const SUITS = [
  { name:'Wands',     element:'Fire'  }, { name:'Cups',   element:'Water' },
  { name:'Swords',    element:'Air'   }, { name:'Pentacles', element:'Earth' }
];
const RANKS = ['Ace','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
               'Page','Knight','Queen','King'];

function buildDeck() {
  const deck = MAJORS.map((n, i) => ({ id:'maj'+i, name:n, arcana:'major', number:i, element:null }));
  SUITS.forEach(s => RANKS.forEach((r, i) => deck.push({
    id: s.name.toLowerCase() + (i + 1),
    name: r + ' of ' + s.name, arcana:'minor', suit:s.name, element:s.element,
    rank:r, number:i + 1, court: i >= 10
  })));
  return deck;   // 78
}

const SPREADS = {
  single:      ['Signal'],
  three:       ['Past','Present','Emerging'],
  regime:      ['GUT — body','HEART — feeling','HEAD — knowing'],
  horseshoe:   ['Past','Present','Hidden influence','Obstacle','Environment','Advice','Outcome'],
  celticCross: ['Situation','Crossing','Root','Recent past','Crown','Near future',
                'Self','Environment','Hopes & fears','Outcome']
};

function drawTarot(opts) {
  const o = Object.assign({ spread:'three', frames:[], allowReversals:true, minQuality:0.5,
                            question:null }, opts || {});
  const positions = SPREADS[o.spread] || SPREADS.three;
  const deck = buildDeck();
  const usable = (o.frames || []).filter(f => (f.quality == null ? 1 : f.quality) >= o.minQuality);
  const haveEEG = usable.length >= 4;

  // Fisher-Yates with CSPRNG, EEG XOR'd into the index stream
  const moment = castMoment();
  const csp = cspBytes(deck.length * 2, moment);
  const a = usable.map(arousal);
  for (let i = deck.length - 1; i > 0; i--) {
    let r = (csp[i * 2] << 8 | csp[i * 2 + 1]);
    if (haveEEG) r ^= Math.floor((a[i % a.length] || 0.5) * 65535);
    const j = r % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const cards = positions.map((pos, i) => {
    const c = Object.assign({}, deck[i]);
    c.position = pos;
    c.reversed = o.allowReversals ? ((csp[(i + 40) % csp.length] & 1) === 1) : false;
    return c;
  });

  return {
    question: o.question, spread: o.spread, cards,
    majorCount: cards.filter(c => c.arcana === 'major').length,
    reversedCount: cards.filter(c => c.reversed).length,
    elementTally: cards.reduce((t, c) => { if (c.element) t[c.element] = (t[c.element]||0)+1; return t; }, {}),
    provenance: {
      mode: haveEEG ? 'eeg-xor-csprng' : 'csprng',
      framesUsed: usable.length, deckSize: deck.length, drawnWithoutReplacement: true,
      castMoment: moment.iso, castSeq: moment.seq,
      timestamp: new Date().toISOString()
    }
  };
}

/* ================================================================= RUNES ==*/
/* reversible:false = symmetric glyph, has no merkstave.
 * SETTLED (2026-07-29). The brief flagged Jera and Eihwaz as contested; checked
 * against published rune-reading sources and the consensus is exactly these
 * eight — Gebo, Hagalaz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz. Sources that
 * say "nine" are counting the blank, which we also treat as non-reversible. The
 * criterion is the glyph's own symmetry: an upside-down draw is the same mark, so
 * there is no reversed form to read rather than a reversed meaning we decline to
 * give. Do not "fix" this list back to a reversible Jera or Eihwaz. */
const ELDER_FUTHARK_FULL = [
  ['Fehu','ᚠ','Cattle, movable wealth',true],       ['Uruz','ᚢ','Aurochs, raw vitality',true],
  ['Thurisaz','ᚦ','Thorn, defensive force',true],   ['Ansuz','ᚨ','Breath, signal, speech',true],
  ['Raidho','ᚱ','Riding, ordered journey',true],    ['Kenaz','ᚲ','Torch, controlled fire',true],
  ['Gebo','ᚷ','Gift, exchange',false],              ['Wunjo','ᚹ','Joy, harmony',true],
  ['Hagalaz','ᚺ','Hail, sudden disruption',false],  ['Naudhiz','ᚾ','Need, constraint',true],
  ['Isa','ᛁ','Ice, stillness',false],               ['Jera','ᛃ','Year, harvest cycle',false],
  ['Eihwaz','ᛇ','Yew, axis, endurance',false],      ['Perthro','ᛈ','Lot cup, chance',true],
  ['Algiz','ᛉ','Elk, protection',true],             ['Sowilo','ᛋ','Sun, will',false],
  ['Tiwaz','ᛏ','Tyr, just sacrifice',true],         ['Berkano','ᛒ','Birch, growth',true],
  ['Ehwaz','ᛖ','Horse, partnership',true],          ['Mannaz','ᛗ','Human, the self',true],
  ['Laguz','ᛚ','Water, flow, intuition',true],      ['Ingwaz','ᛝ','Seed, gestation',false],
  ['Dagaz','ᛞ','Day, breakthrough',false],          ['Othala','ᛟ','Inheritance, homeland',true]
];
const RUNE_SPREADS = {
  single: ['Signal'],
  norn:   ['Urd — what is laid down','Verdandi — what is turning','Skuld — what is owed'],
  cross:  ['Overview','Challenge','Past','Future','Foundation'],
  regime: ['GUT','HEART','HEAD']
};

function castRunes(opts) {
  const o = Object.assign({ spread:'norn', frames:[], includeWyrd:true, minQuality:0.5,
                            question:null }, opts || {});
  const positions = RUNE_SPREADS[o.spread] || RUNE_SPREADS.norn;
  const bag = ELDER_FUTHARK_FULL.map(([name, glyph, meaning, reversible]) =>
    ({ name, glyph, meaning, reversible }));
  if (o.includeWyrd) bag.push({ name:'Wyrd', glyph:'□', meaning:'The blank — what is not yours to know yet', reversible:false });

  const usable = (o.frames || []).filter(f => (f.quality == null ? 1 : f.quality) >= o.minQuality);
  const haveEEG = usable.length >= 4;
  const moment = castMoment();
  const csp = cspBytes(bag.length * 2, moment);
  const a = usable.map(arousal);
  for (let i = bag.length - 1; i > 0; i--) {
    let r = (csp[i * 2] << 8 | csp[i * 2 + 1]);
    if (haveEEG) r ^= Math.floor((a[i % a.length] || 0.5) * 65535);
    const j = r % (i + 1);
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const runes = positions.map((pos, i) => {
    const r = Object.assign({}, bag[i]);
    r.position = pos;
    r.merkstave = r.reversible ? ((csp[(i + 30) % csp.length] & 1) === 1) : false;
    return r;
  });
  return { question:o.question, spread:o.spread, runes,
    provenance: { mode: haveEEG ? 'eeg-xor-csprng' : 'csprng', framesUsed: usable.length,
                  bagSize: bag.length, castMoment: moment.iso, castSeq: moment.seq,
                  timestamp: new Date().toISOString() } };
}

/* ============================================================ BIORHYTHM ==*/
const BIO_CYCLES = { physical:23, emotional:28, intellectual:33,
                     intuitive:38, aesthetic:43, spiritual:53 };

function biorhythm(birthISO, targetISO) {
  const b = new Date(birthISO), t = new Date(targetISO || Date.now());
  if (isNaN(b)) return { error:'Invalid birth date' };
  const days = Math.floor((t - b) / 86400000);
  const out = { daysAlive: days, date: t.toISOString().slice(0, 10), cycles: {} };
  Object.entries(BIO_CYCLES).forEach(([k, period]) => {
    const v = Math.sin(2 * Math.PI * days / period);
    out.cycles[k] = {
      value: +v.toFixed(4), percent: Math.round(v * 100),
      phase: Math.abs(v) < 0.15 ? 'critical' : (v > 0 ? 'high' : 'low'),
      dayInCycle: days % period, period
    };
  });
  out.note = 'Biorhythm is a fixed sine model with no established predictive validity. ' +
             'Offered as a reflective frame, not a forecast.';
  return out;
}

/* =================================================== AETHERIA CUBE ORACLE =
 * The 27 positions as a 3x3x3: layer 0 = GUT, 1 = HEART, 2 = HEAD.
 * Position 14 (2178 Hz) is the geometric centre; all four space diagonals
 * pass through it. A walk is an EEG-steered path of edge-adjacent cells.
 * ======================================================================= */
const cubeCoord = pos => { const i = pos - 1; return { layer: Math.floor(i / 9), row: Math.floor((i % 9) / 3), col: i % 3 }; };
const cubePos   = (l, r, c) => l * 9 + r * 3 + c + 1;

function cubeWalk(opts) {
  const o = Object.assign({ frames:[], steps:3, entry:null, freqTable:null, minQuality:0.5 }, opts || {});
  const table = o.freqTable || global.AETHERIA_FREQUENCIES || [];
  const usable = (o.frames || []).filter(f => (f.quality == null ? 1 : f.quality) >= o.minQuality);
  const haveEEG = usable.length >= 3;
  const a = usable.map(arousal);
  const moment = castMoment();
  const csp = cspBytes(o.steps + 2, moment);

  let pos = o.entry;
  if (!pos) {
    // Entry layer chosen by mean arousal: low -> GUT, mid -> HEART, high -> HEAD
    const m = a.length ? stats(a).mean : 0.5;
    const layer = m < 0.38 ? 0 : (m < 0.62 ? 1 : 2);
    pos = cubePos(layer, csp[0] % 3, csp[1] % 3);
  }
  const path = [pos];
  for (let s = 0; s < o.steps; s++) {
    const { layer, row, col } = cubeCoord(path[path.length - 1]);
    let axis = csp[s + 2] % 3;
    if (haveEEG) axis = (axis ^ Math.floor((a[s % a.length] || 0.5) * 3)) % 3;
    const dir = (csp[s + 2] & 2) ? 1 : -1;
    // Reflect at the boundary rather than clamp — clamping turns face cells into
    // absorbing states and biases the walk toward the cube's outer shell.
    const step = v => { const n = v + dir; return (n < 0 || n > 2) ? v - dir : n; };
    let l = layer, r = row, c = col;
    if (axis === 0) l = step(l);
    if (axis === 1) r = step(r);
    if (axis === 2) c = step(c);
    path.push(cubePos(l, r, c));
  }
  const cells = path.map(p => {
    const f = table.find(x => x.pos === p) || { pos:p };
    return { pos:p, coord: cubeCoord(p), freq: f.freq, regime: f.regime,
             keyword: f.keyword, geo: f.geo, hex: f.hex, hexName: f.hexName };
  });
  return {
    path, cells,
    passedCentre: path.includes(14),
    regimesTouched: [...new Set(cells.map(c => c.regime).filter(Boolean))],
    destination: cells[cells.length - 1],
    provenance: { mode: haveEEG ? 'eeg-steered' : 'csprng', framesUsed: usable.length,
      note: 'Cube geometry is our own construction (Lo Shu layering of the 27). ' +
            'The walk is a contemplative device, not a measurement.',
      castMoment: moment.iso, castSeq: moment.seq,
      timestamp: new Date().toISOString() }
  };
}

/* ============================================================ BIBLIOMANCY =
 * Sortilege over the user's own uploaded knowledge base. Caller passes the
 * chunk array from the existing RAG store. Returns a passage, not a claim.
 * ======================================================================= */
function bibliomancy(opts) {
  const o = Object.assign({ chunks: [], frames: [], question: null }, opts || {});
  if (!o.chunks.length) return { error: 'No knowledge-base chunks supplied.' };
  const moment = castMoment();
  const csp = cspBytes(4, moment);
  const a = (o.frames || []).map(arousal);
  let r = (csp[0] << 16 | csp[1] << 8 | csp[2]);
  if (a.length) r ^= Math.floor(stats(a).mean * 16777215);
  const idx = r % o.chunks.length;
  const chunk = o.chunks[idx];
  return {
    question: o.question, index: idx, total: o.chunks.length,
    source: chunk.source || chunk.title || 'unknown',
    passage: (chunk.text || chunk.content || '').slice(0, 900),
    provenance: { mode: a.length ? 'eeg-xor-csprng' : 'csprng',
      note: 'A passage drawn by lot from your own documents. Meaning is yours to make.',
      castMoment: moment.iso, castSeq: moment.seq,
      timestamp: new Date().toISOString() }
  };
}

/* ------------------------------------------------------- provenance line --
 * One small grey line to render under a reading. Never hides a fallback:
 *   'state readout · 118 frames · personal baseline'
 *   'yarrow draw · CSPRNG only, headband not connected'
 * Accepts any of the provenance shapes this module emits.                    */
function provenanceLine(p) {
  if (!p) return '';
  const parts = [];
  if (p.mode === 'state')                 parts.push('state readout');
  else if (p.mode === 'entropy')          parts.push((p.method || 'yarrow') + ' draw');
  else if (p.mode === 'eeg-xor-csprng')   parts.push('EEG-seeded draw');
  else if (p.mode === 'eeg-steered')      parts.push('EEG-steered walk');
  else                                    parts.push('CSPRNG draw');

  const n = (p.framesUsedAfterQualityGate != null) ? p.framesUsedAfterQualityGate : p.framesUsed;
  const offered = p.framesOffered;
  const noEEG = p.fallbackToCSPRNG || p.mode === 'csprng';
  if (noEEG) {
    // Three different failures, said three different ways: nothing streaming,
    // frames arriving but all dirty, or too few clean ones to cast from.
    if (!offered)   parts.push('CSPRNG only, headband not connected');
    else if (!n)    parts.push('CSPRNG only, all ' + offered + ' frames below the quality gate');
    else            parts.push('CSPRNG only, just ' + n + ' of ' + offered + ' frames passed the quality gate');
  } else if (n != null) {
    parts.push(n + (n === 1 ? ' frame' : ' frames'));
  }
  // Name both pivots when they come from different places — "personal baseline"
  // alone would overstate a cast whose polarity is personal but whose changing
  // lines still come from the within-cast spread.
  if (p.pivots) {
    if (p.pivots.source !== 'personal-history')            parts.push('within-cast median');
    else if (p.pivots.cvSource === 'within-cast-quantile') parts.push('personal arousal pivot · within-cast CV');
    else                                                   parts.push('personal baseline');
  }
  return parts.join(' · ');
}

/* ============================================================ TOOL EXPORT =
 * Shape matches Sophia's existing `tools` registry:
 *   { name, description, params: <JSON-schema-ish>, code: (params)=>result,
 *     enabled, default:true }
 * Frames are pulled from window.eegFrameBuffer if the caller omits them.
 *
 * ON THE `enabled` DEFAULTS: every enabled tool's description is pasted into the
 * prompt on EVERY turn, and a 1B local model degrades well before it runs out of
 * context — it starts calling the wrong tool. So the four traditions Sophia is
 * asked for daily ship on (I Ching + its lookup, tarot, runes) and the four
 * specialist ones ship off (geomancy, biorhythm, cube walk, bibliomancy). Turning
 * one on costs nothing but a click; leaving eight on costs accuracy on every
 * unrelated question.
 * ======================================================================= */
function frames(params) {
  if (params && Array.isArray(params.frames)) return params.frames;
  return (global.eegFrameBuffer && global.eegFrameBuffer.slice) ? global.eegFrameBuffer.slice(-360) : [];
}

/* State mode needs a PERSONAL pivot (see the note on linesFromState). The host
 * app supplies one through global.getDivinationBaseline(); returning null there
 * is the honest cold-start answer and we fall back to within-cast medians.
 * The seam is SYNCHRONOUS by contract — the host keeps a refreshed snapshot of
 * whatever async store it uses, because a tool's code() cannot await. */
function baselineFor(params) {
  const pick = src => ({
    baseline: (src && src.baseline != null) ? src.baseline : null,
    /* cvPivot preferred; baselineCV only forwarded when no quantile is offered,
     * and never both — see the CV PIVOT note above. */
    cvPivot:    (src && src.cvPivot != null) ? src.cvPivot : null,
    baselineCV: (src && src.cvPivot == null && src.baselineCV != null) ? src.baselineCV : null
  });
  if (params && (params.baseline != null || params.baselineCV != null || params.cvPivot != null)) {
    return pick(params);
  }
  let g = null;
  if (typeof global.getDivinationBaseline === 'function') {
    try { g = global.getDivinationBaseline(); } catch (e) { g = null; }
  }
  return pick(g);
}

/* The sidebar toggle ("Read my state" / "Cast the lots") parks the user's
 * choice on global.divinationMode; an explicit tool param still wins. */
function modeFor(params) {
  const m = (params && params.mode) || global.divinationMode;
  return (m === 'state' || m === 'entropy') ? m : 'entropy';
}

/* Bibliomancy reads whatever chunk store the host exposes. Sophia's knowledge
 * base is a list of files each holding string chunks, so the host installs
 * global.getBibliomancyChunks(); global.ragStore is the older shape. */
function bibliomancyChunks() {
  if (typeof global.getBibliomancyChunks === 'function') {
    try { const c = global.getBibliomancyChunks(); if (Array.isArray(c)) return c; } catch (e) { /* fall through */ }
  }
  return (global.ragStore && global.ragStore.chunks) || [];
}
const ok = fn => params => { try { return Object.assign({ success:true }, fn(params || {})); }
                             catch (e) { return { success:false, error:e.message }; } };

const DIVINATION_TOOLS = {
  neural_iching: {
    name: 'neural_iching',
    description: 'Cast an I Ching hexagram from live EEG. mode "state" reads the six lines ' +
      'deterministically from neural arousal and its variability (NOT random — distribution ' +
      'will not match yarrow odds). mode "entropy" uses EEG bits XOR CSPRNG with traditional ' +
      'yarrow or coin probabilities. Returns primary, relating, nuclear, inverse and opposite ' +
      'hexagrams, changing lines, Aetheria frequency bridge, and full provenance.',
    params: {
      mode:     { type:'string', enum:['state','entropy'], description:'state = neural readout, entropy = randomised draw' },
      method:   { type:'string', enum:['yarrow','coin'],   description:'entropy mode only' },
      question: { type:'string', description:'The question put to the oracle' }
    },
    code: ok(p => ({ reading: castIChing(Object.assign({
        mode: modeFor(p), method: p.method || 'yarrow',
        question: p.question, frames: frames(p)
      }, baselineFor(p))) })),
    enabled: true, default: true
  },
  hexagram_lookup: {
    name: 'hexagram_lookup',
    description: 'Look up any of the 64 hexagrams by number or by six-line binary (bottom to top, ' +
      '1=yang). Returns trigrams, image, nuclear/inverse/opposite relations and the Aetheria bridge.',
    params: { number: { type:'number', description:'1-64' }, bits: { type:'string', description:'e.g. 101010' } },
    code: ok(p => {
      const h = p.bits ? byBits(p.bits) : byNum(Number(p.number));
      if (!h) return { error:'Hexagram not found' };
      return { hexagram: hexSummary(h), nuclear: hexSummary(byBits(nuclear(h.bits))),
               inverse: hexSummary(byBits(invert(h.bits))), opposite: hexSummary(byBits(complement(h.bits))) };
    }),
    enabled: true, default: true
  },
  geomancy_cast: {
    name: 'geomancy_cast',
    description: 'Cast a full geomantic shield chart: four Mothers from EEG-derived dots, then ' +
      'Daughters, Nieces, two Witnesses, Judge and Reconciler, with the classical even-points ' +
      'validity check.',
    params: { question: { type:'string', description:'The question' } },
    code: ok(p => ({ chart: castGeomancy({ question:p.question, frames: frames(p) }) })),
    enabled: false, default: true   // opt-in: specialist tradition, rarely asked for
  },
  tarot_draw: {
    name: 'tarot_draw',
    description: 'Draw from a full 78-card deck without replacement. Spreads: single, three, ' +
      'regime (GUT/HEART/HEAD), horseshoe, celticCross. Returns cards with positions, reversals, ' +
      'major-arcana count and elemental tally.',
    params: {
      spread: { type:'string', enum:['single','three','regime','horseshoe','celticCross'] },
      allowReversals: { type:'boolean' },
      question: { type:'string' }
    },
    code: ok(p => ({ reading: drawTarot({ spread:p.spread || 'three', question:p.question,
      allowReversals: p.allowReversals !== false, frames: frames(p) }) })),
    enabled: true, default: true
  },
  rune_cast: {
    name: 'rune_cast',
    description: 'Cast Elder Futhark runes (24 plus Wyrd). Spreads: single, norn, cross, regime. ' +
      'Merkstave is only applied to runes whose glyphs are asymmetric.',
    params: { spread: { type:'string', enum:['single','norn','cross','regime'] },
              includeWyrd: { type:'boolean' }, question: { type:'string' } },
    code: ok(p => ({ reading: castRunes({ spread:p.spread || 'norn', includeWyrd: p.includeWyrd !== false,
      question:p.question, frames: frames(p) }) })),
    enabled: true, default: true
  },
  biorhythm_calc: {
    name: 'biorhythm_calc',
    description: 'Six-cycle biorhythm for a birth date. Includes an explicit note that the model ' +
      'has no established predictive validity.',
    params: { birthDate: { type:'string', description:'YYYY-MM-DD' },
              targetDate:{ type:'string', description:'YYYY-MM-DD, defaults to today' } },
    code: ok(p => ({ biorhythm: biorhythm(p.birthDate, p.targetDate) })),
    enabled: false, default: true   // opt-in: no predictive validity, needs a birth date
  },
  cube_walk: {
    name: 'cube_walk',
    description: 'Walk the Aetheria 27-cell cube. Entry layer is chosen by mean EEG arousal ' +
      '(GUT / HEART / HEAD), then steps move along cube edges. Reports whether the path crossed ' +
      'position 14 (2178 Hz, the geometric centre).',
    params: { steps: { type:'number', description:'default 3' },
              entry: { type:'number', description:'1-27, optional forced entry' } },
    code: ok(p => ({ walk: cubeWalk({ steps: p.steps || 3, entry: p.entry, frames: frames(p) }) })),
    enabled: false, default: true   // opt-in: our own construction, contemplative device
  },
  bibliomancy_draw: {
    name: 'bibliomancy_draw',
    description: 'Draw a passage by lot from the user\'s own uploaded knowledge base.',
    params: { question: { type:'string' } },
    code: ok(p => ({ draw: bibliomancy({ question:p.question, frames: frames(p),
      chunks: bibliomancyChunks() }) })),
    enabled: false, default: true   // opt-in: only useful once a knowledge base exists
  }
};

/* --------------------------------------------------------------- exports */
const Divination = {
  TRIGRAMS, HEXAGRAMS, byNum, byBits, invert, complement, nuclear, hamming,
  aetheriaForHexagram, hexSummary, castIChing, linesFromState, linesFromEntropy,
  GEOMANTIC_FIGURES, castGeomancy, buildDeck, SPREADS, drawTarot,
  ELDER_FUTHARK_FULL, RUNE_SPREADS, castRunes, BIO_CYCLES, biorhythm,
  cubeCoord, cubePos, cubeWalk, bibliomancy, arousal, debias, median, quantile,
  stats, provenanceLine
};

global.Divination = Divination;
global.DIVINATION_TOOLS = DIVINATION_TOOLS;
if (typeof module !== 'undefined' && module.exports) module.exports = { Divination, DIVINATION_TOOLS };

})(typeof window !== 'undefined' ? window : globalThis);

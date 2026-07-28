// tools/astro-chart.js — houses, aspects, dignities, patterns, and the report.
//
// Everything here is geometry and lookup on top of tools/astro-ephemeris.js.
// Interpretation is kept to KEYWORDS rather than paragraphs of prose: Sophia
// writes the reading in her own voice, and canned paragraphs would both fight
// her tone and pad a tool result that has to fit a small local model's context.

import {
  norm360, angleDiff, centuriesTT, nutation, allBodies,
  ascendantMC, greenwichSiderealTime,
} from './astro-ephemeris.js';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const sin = x => Math.sin(x * D2R), cos = x => Math.cos(x * D2R), tan = x => Math.tan(x * D2R);

export const SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo',
                      'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
export const SIGN_GLYPH = ['♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓'];
const ELEMENT  = ['Fire','Earth','Air','Water'];
const MODALITY = ['Cardinal','Fixed','Mutable'];

export const signIndex = lon => Math.floor(norm360(lon) / 30);
export const signOf = lon => SIGNS[signIndex(lon)];
export const elementOf = lon => ELEMENT[signIndex(lon) % 4];
export const modalityOf = lon => MODALITY[signIndex(lon) % 3];

/** "12°34' Cancer" — the way astrologers actually write a position. */
export function formatPosition(lon) {
  const l = norm360(lon);
  const deg = l % 30;
  const d = Math.floor(deg);
  const m = Math.round((deg - d) * 60);
  const carry = m === 60;
  return { degree: d + (carry ? 1 : 0), minute: carry ? 0 : m,
           sign: SIGNS[signIndex(l)],
           text: `${d + (carry ? 1 : 0)}°${String(carry ? 0 : m).padStart(2, '0')}' ${SIGNS[signIndex(l)]}` };
}

// ── Houses ──────────────────────────────────────────────────────────────────

/** Declination and right ascension of an ecliptic point on the ecliptic itself. */
function eclToEq(lon, eps) {
  return {
    dec: Math.asin(sin(eps) * sin(lon)) * R2D,
    ra: norm360(Math.atan2(cos(eps) * sin(lon), cos(lon)) * R2D),
  };
}

/**
 * Semi-diurnal arc in degrees: how far a point travels from rising to
 * culmination. Returns null when the point never rises or never sets, which is
 * exactly the condition that makes Placidus undefined.
 */
function semiDiurnalArc(dec, lat) {
  const x = -tan(lat) * tan(dec);
  if (x <= -1 || x >= 1) return null;         // circumpolar or never-rising
  return Math.acos(x) * R2D;
}

/**
 * Placidus by root-finding rather than the traditional fixed-point iteration.
 *
 * Placidus divides each point's own semi-arc into thirds, so a cusp is the
 * ecliptic longitude whose hour angle is the required fraction of ITS OWN
 * semi-arc. Written as f(λ)=0 and solved by bisection, that is robust and
 * self-checking; the classical iteration silently fails to converge at high
 * latitude instead of telling you it has.
 *
 * targetFrac: hour angle, as a signed multiple of the relevant semi-arc.
 *   cusp 11 = -1/3 SD,  cusp 12 = -2/3 SD  (above horizon, east of meridian)
 *   cusp 2  = -SD - 1/3 SN,  cusp 3 = -SD - 2/3 SN  (below horizon)
 */
function placidusCusp(which, ramc, eps, lat, ascendant, mc) {
  // Hour angle measured continuously BACKWARD from the meridian, so it runs
  // 0 → -360 once around the ecliptic with no wrap discontinuity to trip over.
  // MC sits at 0, the Ascendant at -SD, the IC at -180.
  const f = (lon) => {
    const { dec, ra } = eclToEq(lon, eps);
    const SD = semiDiurnalArc(dec, lat);
    if (SD === null) return null;
    const SN = 180 - SD;
    const ha = -norm360(ra - ramc);
    const target = which === 11 ? -SD / 3
                 : which === 12 ? -2 * SD / 3
                 : which === 2  ? -SD - SN / 3
                 : /* 3 */        -SD - 2 * SN / 3;
    return ha - target;
  };

  // Bracket instead of scanning the whole circle. Cusps 11 and 12 always lie on
  // the arc from MC forward to the Ascendant; cusps 2 and 3 on the arc from the
  // Ascendant forward to the IC. Inside its own bracket each cusp has exactly
  // one root and f changes sign at the ends, so bisection cannot pick up a
  // neighbouring root — which is what a blind scan does.
  const ic = norm360(mc + 180);
  const [from, to] = (which === 11 || which === 12)
    ? [mc, mc + norm360(ascendant - mc)]
    : [ascendant, ascendant + norm360(ic - ascendant)];

  let lo = from, hi = to;
  const flo = f(lo), fhi = f(hi);
  if (flo === null || fhi === null) return null;
  if (flo === 0) return norm360(lo);
  if (flo > 0 === fhi > 0) return null;          // no sign change: undefined here

  let sLo = flo > 0;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === null) return null;
    if ((fm > 0) === sLo) { lo = mid; } else { hi = mid; }
  }
  return norm360((lo + hi) / 2);
}

/**
 * houseCusps — 12 cusps for the requested system.
 *
 * Placidus and Koch are undefined inside the polar circles: a point that never
 * rises has no semi-arc to divide. Rather than emit NaN or a silently wrong
 * cusp, we fall back to Whole Sign and say so in `warnings` — a user born in
 * Reykjavik or Tromsø should get an honest chart, not a broken one.
 */
export function houseCusps({ system = 'placidus', ascendant, mc, ramc, obliquity, latitude }) {
  const warnings = [];
  const sys = String(system).toLowerCase();

  const wholeSign = () => Array.from({ length: 12 }, (_, i) => norm360(signIndex(ascendant) * 30 + i * 30));
  const equal = () => Array.from({ length: 12 }, (_, i) => norm360(ascendant + i * 30));

  const porphyry = () => {
    // Trisect each quadrant between the four angles.
    const ic = norm360(mc + 180), dsc = norm360(ascendant + 180);
    const q1 = norm360(mc - ascendant);        // ASC → MC going backwards through 12,11
    const c = new Array(12);
    c[0] = ascendant; c[9] = mc; c[6] = dsc; c[3] = ic;
    const arcAscIc = norm360(ic - ascendant);
    c[1] = norm360(ascendant + arcAscIc / 3);
    c[2] = norm360(ascendant + 2 * arcAscIc / 3);
    const arcIcDsc = norm360(dsc - ic);
    c[4] = norm360(ic + arcIcDsc / 3);
    c[5] = norm360(ic + 2 * arcIcDsc / 3);
    c[7] = norm360(c[1] + 180); c[8] = norm360(c[2] + 180);
    c[10] = norm360(c[4] + 180); c[11] = norm360(c[5] + 180);
    return c;
  };

  if (sys === 'whole' || sys === 'wholesign' || sys === 'whole-sign') {
    return { system: 'whole sign', cusps: wholeSign(), warnings };
  }
  if (sys === 'equal') return { system: 'equal', cusps: equal(), warnings };
  if (sys === 'porphyry') return { system: 'porphyry', cusps: porphyry(), warnings };

  if (sys === 'placidus') {
    if (Math.abs(latitude) >= 66.0) {
      warnings.push(`Placidus houses are undefined above latitude 66° (${latitude.toFixed(1)}° here) — inside the polar circles a point can fail to rise at all, so there is no semi-arc to divide. Using Whole Sign houses instead.`);
      return { system: 'whole sign (Placidus undefined at this latitude)', cusps: wholeSign(), warnings };
    }
    const c11 = placidusCusp(11, ramc, obliquity, latitude, ascendant, mc);
    const c12 = placidusCusp(12, ramc, obliquity, latitude, ascendant, mc);
    const c2  = placidusCusp(2,  ramc, obliquity, latitude, ascendant, mc);
    const c3  = placidusCusp(3,  ramc, obliquity, latitude, ascendant, mc);
    if ([c11, c12, c2, c3].some(v => v === null || !Number.isFinite(v))) {
      warnings.push('Placidus cusps did not converge at this latitude — falling back to Whole Sign houses.');
      return { system: 'whole sign (Placidus failed to converge)', cusps: wholeSign(), warnings };
    }
    const cusps = new Array(12);
    cusps[0] = ascendant; cusps[1] = c2; cusps[2] = c3;
    cusps[3] = norm360(mc + 180); cusps[4] = norm360(c11 + 180); cusps[5] = norm360(c12 + 180);
    cusps[6] = norm360(ascendant + 180); cusps[7] = norm360(c2 + 180); cusps[8] = norm360(c3 + 180);
    cusps[9] = mc; cusps[10] = c11; cusps[11] = c12;
    return { system: 'placidus', cusps, warnings };
  }

  warnings.push(`Unknown house system "${system}" — using Whole Sign.`);
  return { system: 'whole sign', cusps: wholeSign(), warnings };
}

/**
 * houseOf — which house a longitude falls in, 1-12.
 * Walks forward from each cusp so the 0°/360° wrap can't put a planet in the
 * wrong house, which a naive `lon >= cusp[i] && lon < cusp[i+1]` comparison does
 * for whichever house happens to straddle 0° Aries.
 */
export function houseOf(lon, cusps) {
  const l = norm360(lon);
  for (let i = 0; i < 12; i++) {
    const start = cusps[i];
    const span = norm360(cusps[(i + 1) % 12] - start);
    if (norm360(l - start) < span) return i + 1;
  }
  return 1;
}

// ── Aspects ─────────────────────────────────────────────────────────────────

const ASPECTS = [
  { name: 'Conjunction',    angle: 0,   orb: 8, major: true,  glyph: '☌' },
  { name: 'Opposition',     angle: 180, orb: 8, major: true,  glyph: '☍' },
  { name: 'Trine',          angle: 120, orb: 7, major: true,  glyph: '△' },
  { name: 'Square',         angle: 90,  orb: 7, major: true,  glyph: '□' },
  { name: 'Sextile',        angle: 60,  orb: 5, major: true,  glyph: '⚹' },
  { name: 'Quincunx',       angle: 150, orb: 3, major: false, glyph: '⚻' },
  { name: 'Semisextile',    angle: 30,  orb: 2, major: false, glyph: '⚺' },
  { name: 'Semisquare',     angle: 45,  orb: 2, major: false, glyph: '∠' },
  { name: 'Sesquiquadrate', angle: 135, orb: 2, major: false, glyph: '⚼' },
];

const LUMINARIES = new Set(['Sun', 'Moon']);

/**
 * findAspects — every aspect between the given bodies.
 * Orbs are widened for the luminaries, which is standard practice: the Sun and
 * Moon are held to carry an aspect further than the outer planets do.
 */
export function findAspects(bodies, { includeMinor = true } = {}) {
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const sep = Math.abs(angleDiff(a.lon, b.lon));
      for (const asp of ASPECTS) {
        if (!asp.major && !includeMinor) continue;
        let orb = asp.orb;
        if (LUMINARIES.has(a.name) || LUMINARIES.has(b.name)) orb += asp.major ? 2 : 1;
        if (a.name === 'TrueNode' || b.name === 'TrueNode') orb = Math.min(orb, 3);
        const diff = Math.abs(sep - asp.angle);
        if (diff <= orb) {
          out.push({
            a: a.name, b: b.name, aspect: asp.name, glyph: asp.glyph,
            exactAngle: asp.angle, orb: +diff.toFixed(2), major: asp.major,
            applying: isApplying(a, b, asp.angle),
            text: `${a.name} ${asp.glyph} ${b.name} (${asp.name}, orb ${diff.toFixed(1)}°)`,
          });
          break;                                // closest aspect only
        }
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}

/** Applying (tightening) vs separating — a tighter future orb means applying. */
function isApplying(a, b, exact) {
  const now = Math.abs(Math.abs(angleDiff(a.lon, b.lon)) - exact);
  const soon = Math.abs(Math.abs(angleDiff(
    a.lon + (a.speedPerDay || 0) * 0.01,
    b.lon + (b.speedPerDay || 0) * 0.01)) - exact);
  return soon < now;
}

// ── Dignities ───────────────────────────────────────────────────────────────

const RULERS = {
  Aries: 'Mars', Taurus: 'Venus', Gemini: 'Mercury', Cancer: 'Moon',
  Leo: 'Sun', Virgo: 'Mercury', Libra: 'Venus', Scorpio: 'Mars',
  Sagittarius: 'Jupiter', Capricorn: 'Saturn', Aquarius: 'Saturn', Pisces: 'Jupiter',
};
const MODERN_RULERS = { ...RULERS, Scorpio: 'Pluto', Aquarius: 'Uranus', Pisces: 'Neptune' };
const EXALTATION = { Sun: 'Aries', Moon: 'Taurus', Mercury: 'Virgo', Venus: 'Pisces',
                     Mars: 'Capricorn', Jupiter: 'Cancer', Saturn: 'Libra' };
const OPPOSITE = s => SIGNS[(SIGNS.indexOf(s) + 6) % 12];

export function dignityOf(planet, sign) {
  const out = [];
  if (RULERS[sign] === planet) out.push('rulership');
  if (MODERN_RULERS[sign] === planet && RULERS[sign] !== planet) out.push('modern rulership');
  if (EXALTATION[planet] === sign) out.push('exaltation');
  for (const [s, r] of Object.entries(RULERS)) if (r === planet && OPPOSITE(s) === sign) out.push('detriment');
  if (EXALTATION[planet] && OPPOSITE(EXALTATION[planet]) === sign) out.push('fall');
  return [...new Set(out)];
}

// ── Patterns ────────────────────────────────────────────────────────────────

/** Stelliums, grand trines, T-squares, grand crosses — read off the aspect list. */
export function findPatterns(bodies, aspects) {
  const patterns = [];

  const bySign = {};
  for (const b of bodies) {
    if (b.name === 'TrueNode') continue;
    (bySign[signOf(b.lon)] ||= []).push(b.name);
  }
  for (const [sign, names] of Object.entries(bySign)) {
    if (names.length >= 3) patterns.push({ type: 'Stellium', where: sign, bodies: names,
      text: `Stellium in ${sign}: ${names.join(', ')}` });
  }

  const has = (x, y, name) => aspects.find(a =>
    a.aspect === name && ((a.a === x && a.b === y) || (a.a === y && a.b === x)));

  const names = bodies.filter(b => b.name !== 'TrueNode').map(b => b.name);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let k = j + 1; k < names.length; k++) {
        const [x, y, z] = [names[i], names[j], names[k]];
        if (has(x, y, 'Trine') && has(y, z, 'Trine') && has(x, z, 'Trine'))
          patterns.push({ type: 'Grand Trine', bodies: [x, y, z], text: `Grand Trine: ${x}, ${y}, ${z}` });
        if (has(x, y, 'Opposition') && has(x, z, 'Square') && has(y, z, 'Square'))
          patterns.push({ type: 'T-Square', bodies: [x, y, z], apex: z, text: `T-Square: ${x} opposite ${y}, both square ${z} (apex)` });
        if (has(x, y, 'Quincunx') && has(x, z, 'Quincunx') && has(y, z, 'Sextile'))
          patterns.push({ type: 'Yod', bodies: [x, y, z], apex: x, text: `Yod: ${y} and ${z} sextile, both quincunx ${x} (apex)` });
      }

  // One configuration often satisfies a pattern several ways (three Yods sharing
  // a sextile, say). Keep the tightest couple of each type so the report and the
  // stored memory stay readable instead of repeating a near-identical figure.
  const capped = [];
  const seen = {};
  for (const p of patterns) {
    seen[p.type] = (seen[p.type] || 0) + 1;
    if (seen[p.type] <= 2) capped.push(p);
  }
  for (const [type, n] of Object.entries(seen)) {
    if (n > 2) capped.push({ type, text: `(+${n - 2} further ${type} configuration${n - 2 === 1 ? '' : 's'})`, bodies: [] });
  }
  return capped;
}

// ── Balance ─────────────────────────────────────────────────────────────────

export function elementBalance(bodies) {
  const el = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
  const mo = { Cardinal: 0, Fixed: 0, Mutable: 0 };
  for (const b of bodies) {
    if (b.name === 'TrueNode') continue;
    el[elementOf(b.lon)]++; mo[modalityOf(b.lon)]++;
  }
  const total = Object.values(el).reduce((a, c) => a + c, 0) || 1;
  const strongest = Object.entries(el).sort((a, b) => b[1] - a[1])[0];
  const absent = Object.entries(el).filter(([, n]) => n === 0).map(([k]) => k);
  const domMode = Object.entries(mo).sort((a, b) => b[1] - a[1])[0];
  return {
    elements: el, modalities: mo,
    summary: `${strongest[0]}-leaning (${strongest[1]}/${total})`
      + (absent.length ? `, no ${absent.join(' or ')}` : '')
      + `, mostly ${domMode[0]}`,
    lacking: absent,
  };
}

// ── Chart assembly ──────────────────────────────────────────────────────────

/**
 * buildChart — the whole natal chart from a Julian Day and a place.
 * `timeKnown: false` suppresses everything that depends on the rotation of the
 * Earth (houses, Ascendant, MC), because with an unknown birth time those are
 * not approximate — they are meaningless.
 */
export function buildChart({ jdUT, latitude, longitude, houseSystem = 'placidus', timeKnown = true }) {
  const bodies = allBodies(jdUT);
  const warnings = [];

  let angles = null, houses = null;
  if (timeKnown) {
    angles = ascendantMC(jdUT, latitude, longitude);
    houses = houseCusps({
      system: houseSystem, ascendant: angles.ascendant, mc: angles.mc,
      ramc: angles.ramc, obliquity: angles.obliquity, latitude,
    });
    warnings.push(...houses.warnings);
  } else {
    warnings.push('Birth time unknown — Ascendant, Midheaven and houses are omitted rather than guessed. Sun, Moon and planetary signs remain valid (the Moon may be off by up to ~6°).');
  }

  const planets = bodies.map(b => {
    const f = formatPosition(b.lon);
    return {
      name: b.name, lon: b.lon, lat: b.lat,
      sign: f.sign, signDegree: `${f.degree}°${String(f.minute).padStart(2, '0')}'`,
      position: f.text,
      retrograde: b.retrograde,
      house: houses ? houseOf(b.lon, houses.cusps) : null,
      dignity: b.name === 'TrueNode' ? [] : dignityOf(b.name, f.sign),
      element: elementOf(b.lon), modality: modalityOf(b.lon),
    };
  });

  const aspects = findAspects(bodies);
  const patterns = findPatterns(bodies, aspects);
  const balance = elementBalance(bodies);

  const sun = planets.find(p => p.name === 'Sun');
  const moon = planets.find(p => p.name === 'Moon');
  const ascFmt = angles ? formatPosition(angles.ascendant) : null;
  const mcFmt = angles ? formatPosition(angles.mc) : null;

  const signatures = [];
  if (angles) signatures.push(`${ascFmt.sign} rising`);
  signatures.push(`Sun in ${sun.sign}`, `Moon in ${moon.sign}`);
  for (const p of patterns.slice(0, 3)) signatures.push(p.text);
  for (const a of aspects.filter(a => a.major && a.orb < 2).slice(0, 4)) signatures.push(a.text);
  for (const p of planets) if (p.dignity.includes('rulership') || p.dignity.includes('exaltation'))
    signatures.push(`${p.name} in ${p.dignity[0]} (${p.sign})`);

  return {
    planets, aspects, patterns, elements: balance, warnings,
    sun: { sign: sun.sign, position: sun.position, house: sun.house },
    moon: { sign: moon.sign, position: moon.position, house: moon.house },
    ascendant: ascFmt ? { sign: ascFmt.sign, position: ascFmt.text, longitude: angles.ascendant } : null,
    midheaven: mcFmt ? { sign: mcFmt.sign, position: mcFmt.text, longitude: angles.mc } : null,
    houses: houses ? { system: houses.system, cusps: houses.cusps.map(c => formatPosition(c).text) } : null,
    signatures,
  };
}

/** Compact plain-text report — this is what the model actually reads. */
export function formatReport(chart, birth) {
  const L = [];
  L.push(`NATAL CHART — ${birth.placeName}, ${birth.date}${birth.time ? ' ' + birth.time : ' (time unknown)'}`);
  if (birth.utcISO) L.push(`UTC ${birth.utcISO.replace('T', ' ').slice(0, 16)} · ${birth.latitude.toFixed(3)}, ${birth.longitude.toFixed(3)}`);
  L.push('');

  if (chart.ascendant) {
    L.push(`Ascendant ${chart.ascendant.position}   Midheaven ${chart.midheaven.position}`);
    L.push(`Houses: ${chart.houses.system}`);
    L.push('');
  }

  L.push('PLACEMENTS');
  for (const p of chart.planets) {
    L.push(`  ${p.name.padEnd(10)} ${p.position.padEnd(20)}`
      + (p.house ? `house ${String(p.house).padStart(2)}  ` : '')
      + (p.retrograde && p.name !== 'TrueNode' ? 'R  ' : '   ')
      + (p.dignity.length ? p.dignity.join('/') : ''));
  }

  L.push('', `BALANCE  ${chart.elements.summary}`);

  const major = chart.aspects.filter(a => a.major);
  L.push('', `ASPECTS (${major.length} major)`);
  for (const a of major.slice(0, 18)) {
    L.push(`  ${a.a.padEnd(9)} ${a.aspect.padEnd(12)} ${a.b.padEnd(9)} orb ${a.orb.toFixed(1)}°${a.applying ? ' applying' : ''}`);
  }

  if (chart.patterns.length) {
    L.push('', 'PATTERNS');
    for (const p of chart.patterns) L.push(`  ${p.text}`);
  }

  if (chart.warnings.length) {
    L.push('', 'NOTES');
    for (const w of chart.warnings) L.push(`  - ${w}`);
  }
  return L.join('\n');
}

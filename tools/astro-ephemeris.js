// tools/astro-ephemeris.js — offline positional astronomy for natal charts.
//
// Dependency-free, no ephemeris files, no network. Produces the quantity
// astrology actually uses: GEOCENTRIC APPARENT ECLIPTIC LONGITUDE OF DATE.
//
// That phrase carries four separate corrections, and skipping any one of them
// is a silent multi-degree error:
//   • geocentric  — seen from Earth, not the Sun
//   • apparent    — light-time + annual aberration + nutation applied
//   • ecliptic    — not equatorial
//   • of date     — precessed from J2000 to the birth date (~1.4°/century,
//                   so ~0.35° for a chart from 2025; a whole aspect orb)
//
// Planets use Keplerian elements with secular rates (JPL SSD "Approximate
// Positions of the Planets", 1800-2050). The Moon uses the truncated ELP-2000
// series from Meeus, Astronomical Algorithms 2nd ed. ch. 47.
//
// Accuracy is measured, not asserted: tools/test-fixtures/jpl-ground-truth.js
// holds 40 positions pulled straight from NASA JPL Horizons, and
// test-astro-ephemeris.mjs reports the real arcminute error against them.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const sin = x => Math.sin(x * D2R);
const cos = x => Math.cos(x * D2R);
const tan = x => Math.tan(x * D2R);

/** Fold any angle into [0, 360). */
export function norm360(d) {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed difference a-b folded into (-180, 180]. */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ── Time ────────────────────────────────────────────────────────────────────

/**
 * deltaTSeconds — TT minus UT.
 *
 * Earth's rotation is irregular, so civil time (UT) drifts from the uniform
 * time scale the orbital theories are written in (TT). ~69 s today. That is
 * only ~0.0008 days, negligible for planets, but the Moon moves 0.5°/hour so
 * it matters there, and sidereal time (hence the Ascendant) is computed from
 * UT deliberately.
 *
 * Polynomials from Espenak & Meeus (NASA five-millennium canon), 1900-2150.
 */
export function deltaTSeconds(year) {
  let t;
  if (year >= 2005 && year < 2050) { t = year - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  if (year >= 1986 && year < 2005) {
    t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
         + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year >= 1961 && year < 1986) { t = year - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (year >= 1941 && year < 1961) { t = year - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (year >= 1920 && year < 1941) { t = year - 1920; return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3; }
  if (year >= 1900 && year < 1920) { t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year >= 2050 && year <= 2150) { return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year); }
  const u = (year - 1820) / 100;                  // long-range fallback
  return -20 + 32 * u * u;
}

/** Approximate calendar year from a Julian Day — only used to pick a ΔT polynomial. */
function jdToYear(jd) { return 2000 + (jd - 2451545.0) / 365.25; }

/** Julian centuries of TT since J2000, from a Julian Day in UT. */
export function centuriesTT(jdUT) {
  const jdTT = jdUT + deltaTSeconds(jdToYear(jdUT)) / 86400;
  return (jdTT - 2451545.0) / 36525;
}

// ── Nutation & obliquity (Meeus ch. 22) ─────────────────────────────────────

/**
 * Nutation in longitude (Δψ) and obliquity (Δε), in DEGREES, plus true
 * obliquity. Δψ reaches ~17" — small, but it is a systematic offset applied to
 * every body at once, so leaving it out biases the whole chart the same way.
 */
export function nutation(T) {
  const D  = 297.85036 + 445267.111480 * T - 0.0019142 * T * T + T ** 3 / 189474;
  const M  = 357.52772 + 35999.050340 * T - 0.0001603 * T * T - T ** 3 / 300000;
  const Mp = 134.96298 + 477198.867398 * T + 0.0086972 * T * T + T ** 3 / 56250;
  const F  = 93.27191 + 483202.017538 * T - 0.0036825 * T * T + T ** 3 / 327270;
  const Om = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + T ** 3 / 450000;

  // Leading terms of the IAU 1980 series (arcseconds).
  const dPsi = (
    (-171996 - 174.2 * T) * sin(Om)
    + (-13187 - 1.6 * T) * sin(-2 * D + 2 * F + 2 * Om)
    + (-2274 - 0.2 * T) * sin(2 * F + 2 * Om)
    + (2062 + 0.2 * T) * sin(2 * Om)
    + (1426 - 3.4 * T) * sin(M)
    + (712 + 0.1 * T) * sin(Mp)
    + (-517 + 1.2 * T) * sin(-2 * D + M + 2 * F + 2 * Om)
    + (-386 - 0.4 * T) * sin(2 * F + Om)
    - 301 * sin(Mp + 2 * F + 2 * Om)
    + (217 - 0.5 * T) * sin(-2 * D - M + 2 * F + 2 * Om)
    - 158 * sin(-2 * D + Mp)
    + (129 + 0.1 * T) * sin(-2 * D + 2 * F + Om)
    + 123 * sin(-Mp + 2 * F + 2 * Om)
    + 63 * sin(2 * D)
    + (63 + 0.1 * T) * sin(Mp + Om)
    - 59 * sin(2 * D - Mp + 2 * F + 2 * Om)
    + (-58 - 0.1 * T) * sin(-Mp + Om)
    - 51 * sin(Mp + 2 * F + Om)
    + 48 * sin(-2 * D + 2 * Mp)
    + 46 * sin(-2 * Mp + 2 * F + Om)
    - 38 * sin(2 * D + 2 * F + 2 * Om)
    - 31 * sin(2 * Mp + 2 * F + 2 * Om)
    + 29 * sin(2 * Mp)
    + 29 * sin(-2 * D + Mp + 2 * F + 2 * Om)
    + 26 * sin(2 * F)
    - 22 * sin(-2 * D + 2 * F)
    + 21 * sin(-Mp + 2 * F + Om)
  ) / 10000;

  const dEps = (
    (92025 + 8.9 * T) * cos(Om)
    + (5736 - 3.1 * T) * cos(-2 * D + 2 * F + 2 * Om)
    + (977 - 0.5 * T) * cos(2 * F + 2 * Om)
    + (-895 + 0.5 * T) * cos(2 * Om)
    + (54 - 0.1 * T) * cos(M)
    - 7 * cos(Mp)
    + (224 - 0.6 * T) * cos(-2 * D + M + 2 * F + 2 * Om)
    + 200 * cos(2 * F + Om)
    + (129 - 0.1 * T) * cos(Mp + 2 * F + 2 * Om)
    + (-95 + 0.3 * T) * cos(-2 * D - M + 2 * F + 2 * Om)
  ) / 10000;

  // Mean obliquity, Laskar's polynomial in units of 10000 Julian years.
  const U = T / 100;
  const eps0 = 23 + 26 / 60 + 21.448 / 3600
    - (4680.93 * U + 1.55 * U ** 2 - 1999.25 * U ** 3 - 51.38 * U ** 4 + 249.67 * U ** 5
      + 39.05 * U ** 6 - 7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10) / 3600;

  return {
    dPsi: dPsi / 3600,
    dEps: dEps / 3600,
    eps0,
    epsTrue: eps0 + dEps / 3600,
  };
}

// ── Precession, J2000 ecliptic → ecliptic of date (Meeus ch. 21) ────────────

/**
 * The single most-skipped step. General precession is ~50.29"/yr, so a chart
 * for 2025 sits ~0.35° away from its J2000 coordinates — enough to change which
 * degree a planet occupies and to make or break a tight aspect.
 */
export function precessFromJ2000(lonJ2000, latJ2000, T) {
  const eta = (47.0029 * T - 0.03302 * T * T + 0.000060 * T ** 3) / 3600;
  const PI  = 174.876384 - (869.8089 * T - 0.03536 * T * T) / 3600;
  const p   = (5029.0966 * T + 1.11113 * T * T - 0.000006 * T ** 3) / 3600;

  const A = cos(eta) * cos(latJ2000) * sin(PI - lonJ2000) - sin(eta) * sin(latJ2000);
  const B = cos(latJ2000) * cos(PI - lonJ2000);
  const C = cos(eta) * sin(latJ2000) + sin(eta) * cos(latJ2000) * sin(PI - lonJ2000);

  return {
    lon: norm360(p + PI - Math.atan2(A, B) * R2D),
    lat: Math.asin(Math.max(-1, Math.min(1, C))) * R2D,
  };
}

// ── Planetary elements (JPL SSD, valid 1800-2050) ───────────────────────────
// [a(au), e, I(deg), L(deg), longPeri(deg), longNode(deg)] then per-century rates.

const ELEMENTS = {
  Mercury: {
    e0: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    d:  [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  Venus: {
    e0: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    d:  [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  Earth: {
    e0: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    d:  [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  Mars: {
    e0: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    d:  [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  Jupiter: {
    e0: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    d:  [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  Saturn: {
    e0: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    d:  [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  Uranus: {
    e0: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    d:  [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  Neptune: {
    e0: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    d:  [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
  Pluto: {
    e0: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    d:  [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  },
};

/** Kepler's equation by Newton-Raphson. Converges in a few iterations for e<0.3. */
function solveKepler(M, e) {
  const Mr = M * D2R;
  let E = Mr + e * Math.sin(Mr);
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Heliocentric rectangular coordinates in the J2000 ecliptic frame, in au. */
function heliocentricJ2000(body, T) {
  const el = ELEMENTS[body];
  if (!el) throw new Error(`Unknown body "${body}"`);
  const a = el.e0[0] + el.d[0] * T;
  const e = el.e0[1] + el.d[1] * T;
  const I = el.e0[2] + el.d[2] * T;
  const L = el.e0[3] + el.d[3] * T;
  const wBar = el.e0[4] + el.d[4] * T;
  const Om = el.e0[5] + el.d[5] * T;

  const w = wBar - Om;                     // argument of perihelion
  const M = norm360(L - wBar);
  const E = solveKepler(M > 180 ? M - 360 : M, e);

  // Position in the orbital plane
  const xv = a * (Math.cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));

  // Rotate: argument of perihelion → inclination → ascending node
  const cw = cos(w), sw = sin(w);
  const cO = cos(Om), sO = sin(Om);
  const cI = cos(I), sI = sin(I);

  const xh = (cw * cO - sw * sO * cI) * xv + (-sw * cO - cw * sO * cI) * yv;
  const yh = (cw * sO + sw * cO * cI) * xv + (-sw * sO + cw * cO * cI) * yv;
  const zh = (sw * sI) * xv + (cw * sI) * yv;

  return { x: xh, y: yh, z: zh };
}

const LIGHT_DAYS_PER_AU = 0.0057755183;

/**
 * Geocentric apparent ecliptic position of a planet, in degrees.
 *
 * Steps, in the order they must happen:
 *   1. Earth and planet heliocentric at time T (J2000 frame).
 *   2. Light-time iteration — we see where the planet WAS when the light left.
 *   3. Precess J2000 → ecliptic of date.
 *   4. Nutation in longitude + annual aberration → apparent place.
 */
export function planetPosition(body, T) {
  if (body === 'Sun') return sunPosition(T);

  const earth = heliocentricJ2000('Earth', T);
  let planet = heliocentricJ2000(body, T);
  let dx = planet.x - earth.x, dy = planet.y - earth.y, dz = planet.z - earth.z;

  // Light-time: re-evaluate the planet at the retarded time until stable.
  for (let i = 0; i < 3; i++) {
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    planet = heliocentricJ2000(body, T - (dist * LIGHT_DAYS_PER_AU) / 36525);
    dx = planet.x - earth.x; dy = planet.y - earth.y; dz = planet.z - earth.z;
  }

  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const lonJ2000 = norm360(Math.atan2(dy, dx) * R2D);
  const latJ2000 = Math.asin(dz / dist) * R2D;

  const { lon, lat } = precessFromJ2000(lonJ2000, latJ2000, T);
  const nut = nutation(T);

  // Annual aberration (Meeus 23.2): Earth's motion tilts the apparent direction.
  const sunLon = sunPosition(T).lonGeometric;
  const eEarth = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const periEarth = 102.93735 + 1.71946 * T + 0.00046 * T * T;
  const kappa = 20.49552 / 3600;
  const dLonAberr = (-kappa * cos(sunLon - lon) + eEarth * kappa * cos(periEarth - lon))
                    / Math.max(cos(lat), 1e-6);

  return {
    body,
    lon: norm360(lon + nut.dPsi + dLonAberr),
    lat,
    distance: dist,
  };
}

/** Geocentric apparent longitude of the Sun (Meeus ch. 25). */
export function sunPosition(T) {
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;

  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
          + (0.019993 - 0.000101 * T) * sin(2 * M)
          + 0.000289 * sin(3 * M);

  const trueLon = L0 + C;
  const v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));

  // Apparent longitude: nutation + aberration, both already of-date.
  const nut = nutation(T);
  const aberr = -20.4898 / 3600 / R;

  return {
    body: 'Sun',
    lonGeometric: norm360(trueLon),
    lon: norm360(trueLon + nut.dPsi + aberr),
    lat: 0,
    distance: R,
  };
}

// ── Moon: truncated ELP-2000 (Meeus ch. 47) ─────────────────────────────────
// Columns: D, M, M', F, Σl coefficient (1e-6 deg), Σr coefficient (1e-3 km).

const MOON_LON = [
  [0,0,1,0,6288774,-20905355],[2,0,-1,0,1274027,-3699111],[2,0,0,0,658314,-2955968],
  [0,0,2,0,213618,-569925],[0,1,0,0,-185116,48888],[0,0,0,2,-114332,-3149],
  [2,0,-2,0,58793,246158],[2,-1,-1,0,57066,-152138],[2,0,1,0,53322,-170733],
  [2,-1,0,0,45758,-204586],[0,1,-1,0,-40923,-129620],[1,0,0,0,-34720,108743],
  [0,1,1,0,-30383,104755],[2,0,0,-2,15327,10321],[0,0,1,2,-12528,0],
  [0,0,1,-2,10980,79661],[4,0,-1,0,10675,-34782],[0,0,3,0,10034,-23210],
  [4,0,-2,0,8548,-21636],[2,1,-1,0,-7888,24208],[2,1,0,0,-6766,30824],
  [1,0,-1,0,-5163,-8379],[1,1,0,0,4987,-16675],[2,-1,1,0,4036,-12831],
  [2,0,2,0,3994,-10445],[4,0,0,0,3861,-11650],[2,0,-3,0,3665,14403],
  [0,1,-2,0,-2689,-7003],[2,0,-1,2,-2602,0],[2,-1,-2,0,2390,10056],
  [1,0,1,0,-2348,6322],[2,-2,0,0,2236,-9884],[0,1,2,0,-2120,5751],
  [0,2,0,0,-2069,0],[2,-2,-1,0,2048,-4950],[2,0,1,-2,-1773,4130],
  [2,0,0,2,-1595,0],[4,-1,-1,0,1215,-3958],[0,0,2,2,-1110,0],
  [3,0,-1,0,-892,3258],[2,1,1,0,-810,2616],[4,-1,-2,0,759,-1897],
  [0,2,-1,0,-713,-2117],[2,2,-1,0,-700,2354],[2,1,-2,0,691,0],
  [2,-1,0,-2,596,0],[4,0,1,0,549,-1423],[0,0,4,0,537,-1117],
  [4,-1,0,0,520,-1571],[1,0,-2,0,-487,-1739],[2,1,0,-2,-399,0],
  [0,0,2,-2,-381,-4421],[1,1,1,0,351,0],[3,0,-2,0,-340,0],
  [4,0,-3,0,330,0],[2,-1,2,0,327,0],[0,2,1,0,-323,1165],
  [1,1,-1,0,299,0],[2,0,3,0,294,0],[2,0,-1,-2,0,8752],
];

// Columns: D, M, M', F, Σb coefficient (1e-6 deg).
const MOON_LAT = [
  [0,0,0,1,5128122],[0,0,1,1,280602],[0,0,1,-1,277693],[2,0,0,-1,173237],
  [2,0,-1,1,55413],[2,0,-1,-1,46271],[2,0,0,1,32573],[0,0,2,1,17198],
  [2,0,1,-1,9266],[0,0,2,-1,8822],[2,-1,0,-1,8216],[2,0,-2,-1,4324],
  [2,0,1,1,4200],[2,1,0,-1,-3359],[2,-1,-1,1,2463],[2,-1,0,1,2211],
  [2,-1,-1,-1,2065],[0,1,-1,-1,-1870],[4,0,-1,-1,1828],[0,1,0,1,-1794],
  [0,0,0,3,-1749],[0,1,-1,1,-1565],[1,0,0,1,-1491],[0,1,1,1,-1475],
  [0,1,1,-1,-1410],[0,1,0,-1,-1344],[1,0,0,-1,-1335],[0,0,3,1,1107],
  [4,0,0,-1,1021],[4,0,-1,1,833],[0,0,1,-3,777],[4,0,-2,1,671],
  [2,0,0,-3,607],[2,0,2,-1,596],[2,-1,1,-1,491],[2,0,-2,1,-451],
  [0,0,3,-1,439],[2,0,2,1,422],[2,0,-3,-1,421],[2,1,-1,1,-366],
  [2,1,0,1,-351],[4,0,0,1,331],[2,-1,1,1,315],[2,-2,0,-1,302],
  [0,0,1,3,-283],[2,1,1,-1,-229],[1,1,0,-1,223],[1,1,0,1,223],
  [0,1,-2,-1,-220],[2,1,-1,-1,-220],[1,0,1,1,-185],[2,-1,-2,-1,181],
  [0,1,2,1,-177],[4,0,-2,-1,176],[4,-1,-1,-1,166],[1,0,1,-1,-164],
  [4,0,1,-1,132],[1,0,-1,-1,-119],[4,-1,0,-1,115],[2,-2,0,1,107],
];

/** Geocentric apparent ecliptic position of the Moon, and its nodes. */
export function moonPosition(T) {
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000);
  const D  = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000);
  const M  = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000);
  const F  = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000);

  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.290 * T);
  const A3 = norm360(313.45 + 481266.484 * T);

  // Eccentricity correction: terms in M are scaled because Earth's orbit
  // eccentricity itself changes with time.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0, sumB = 0;
  for (const [d, m, mp, f, cl] of MOON_LON) {
    const arg = d * D + m * M + mp * Mp + f * F;
    let e = 1;
    if (Math.abs(m) === 1) e = E;
    else if (Math.abs(m) === 2) e = E * E;
    sumL += cl * e * sin(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_LAT) {
    const arg = d * D + m * M + mp * Mp + f * F;
    let e = 1;
    if (Math.abs(m) === 1) e = E;
    else if (Math.abs(m) === 2) e = E * E;
    sumB += cb * e * sin(arg);
  }

  // Additive terms from Venus (A1), Jupiter (A2) and Earth's flattening.
  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sumB += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
        + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  const nut = nutation(T);
  // ELP is already referred to the mean equinox of date, so only nutation is
  // added here — no precession step, unlike the planets.
  const lon = norm360(Lp + sumL / 1e6 + nut.dPsi);
  const lat = sumB / 1e6;

  const meanNode = norm360(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441 - T ** 4 / 60616000);
  const trueNode = norm360(meanNode
    - 1.4979 * sin(2 * (D - F)) - 0.1500 * sin(M) - 0.1226 * sin(2 * D)
    + 0.1176 * sin(2 * F) - 0.0801 * sin(2 * (Mp - F)));

  return { body: 'Moon', lon, lat, meanNode, trueNode };
}

// ── Sidereal time, Ascendant, Midheaven ─────────────────────────────────────

/** Apparent sidereal time at Greenwich, in degrees. Uses UT, not TT, by design. */
export function greenwichSiderealTime(jdUT) {
  const T = (jdUT - 2451545.0) / 36525;
  let theta = 280.46061837 + 360.98564736629 * (jdUT - 2451545.0)
            + 0.000387933 * T * T - T ** 3 / 38710000;
  const nut = nutation(centuriesTT(jdUT));
  theta += nut.dPsi * cos(nut.epsTrue);        // equation of the equinoxes
  return norm360(theta);
}

/**
 * Ascendant and Midheaven.
 *
 * Both need atan2, not atan. With plain atan the Ascendant lands 180° out —
 * an exactly-opposite rising sign — for roughly half of all birth times. That
 * is the single most common bug in hand-rolled chart code, so both formulas
 * below are written in atan2 form and the result is checked in the test suite
 * by confirming the Ascendant sits on the horizon (altitude ≈ 0) and rising.
 */
export function ascendantMC(jdUT, latitude, longitude) {
  const T = centuriesTT(jdUT);
  const eps = nutation(T).epsTrue;
  const lst = norm360(greenwichSiderealTime(jdUT) + longitude);   // RAMC, degrees

  const mc = norm360(Math.atan2(sin(lst), cos(lst) * cos(eps)) * R2D);

  // Guard the tangent: |lat| = 90 has no ascendant at all.
  const phi = Math.max(-89.9999, Math.min(89.9999, latitude));
  const asc = norm360(Math.atan2(
    cos(lst),
    -(sin(lst) * cos(eps) + tan(phi) * sin(eps))
  ) * R2D);

  return { ascendant: asc, mc, ramc: lst, obliquity: eps };
}

/**
 * Altitude of an ecliptic point above the horizon — used by the test suite to
 * verify the Ascendant independently of any reference software. A correct
 * Ascendant has altitude ~0 and is on the eastern side.
 */
export function eclipticPointAltitude(lonEcl, latEcl, jdUT, latitude, longitude) {
  const T = centuriesTT(jdUT);
  const eps = nutation(T).epsTrue;
  const ra = Math.atan2(sin(lonEcl) * cos(eps) - tan(latEcl) * sin(eps), cos(lonEcl)) * R2D;
  const dec = Math.asin(sin(latEcl) * cos(eps) + cos(latEcl) * sin(eps) * sin(lonEcl)) * R2D;
  const H = norm360(greenwichSiderealTime(jdUT) + longitude - ra);
  const alt = Math.asin(sin(latitude) * sin(dec) + cos(latitude) * cos(dec) * cos(H)) * R2D;
  const az = norm360(Math.atan2(sin(H), cos(H) * sin(latitude) - tan(dec) * cos(latitude)) * R2D + 180);
  return { altitude: alt, azimuth: az, hourAngle: H, ra: norm360(ra), dec };
}

// ── Whole chart ─────────────────────────────────────────────────────────────

export const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];

/** Longitude of every body at a Julian Day, plus retrograde flags. */
export function allBodies(jdUT) {
  const T = centuriesTT(jdUT);
  // One hour later, for the apparent-motion sign that determines retrogradation.
  const Tnext = centuriesTT(jdUT + 1 / 24);

  const out = [];
  for (const body of BODIES) {
    let pos, next;
    if (body === 'Moon') {
      pos = moonPosition(T); next = moonPosition(Tnext);
    } else if (body === 'Sun') {
      pos = sunPosition(T); next = sunPosition(Tnext);
    } else {
      pos = planetPosition(body, T); next = planetPosition(body, Tnext);
    }
    const motion = angleDiff(next.lon, pos.lon);
    out.push({
      name: body,
      lon: pos.lon,
      lat: pos.lat,
      retrograde: motion < 0,
      speedPerDay: motion * 24,
    });
  }

  const m = moonPosition(T);
  out.push({ name: 'TrueNode', lon: m.trueNode, lat: 0, retrograde: true, speedPerDay: -0.053 });
  return out;
}

// tools/astro-place.js — birth place + birth time → UTC, for natal charts.
//
// Two jobs, both of which are where amateur chart software usually goes wrong:
//
//   1. PLACE → latitude / longitude / IANA timezone.
//   2. LOCAL WALL-CLOCK BIRTH TIME → UTC, using the timezone rules that were
//      actually in force on that date.
//
// (2) matters enormously: the Ascendant moves ~1° every 4 minutes, so a
// one-hour DST error rotates the whole house structure by roughly 15° — often
// a whole sign. Historical rules are genuinely weird (Britain stayed on
// GMT+1 through the winters of 1968-71; the US ran year-round "War Time" in
// 1942-45), so a fixed UTC offset per city is not good enough.
//
// We get correct historical rules for free: every browser ships the full IANA
// tz database behind Intl.DateTimeFormat. No bundled tzdata, no network, no
// library — which suits an offline-first PWA. Verified against the awkward
// cases above.

const GEOCODE_TIMEOUT = 7000;

// Offline courtesy fallback. Not a gazetteer — just enough that a common
// birthplace resolves with no network. Anything else needs either the online
// lookup or explicit coordinates. [lat, lon, IANA zone]
const CITIES = {
  'london': [51.5074, -0.1278, 'Europe/London'],
  'paris': [48.8566, 2.3522, 'Europe/Paris'],
  'berlin': [52.52, 13.405, 'Europe/Berlin'],
  'madrid': [40.4168, -3.7038, 'Europe/Madrid'],
  'rome': [41.9028, 12.4964, 'Europe/Rome'],
  'moscow': [55.7558, 37.6173, 'Europe/Moscow'],
  'dublin': [53.3498, -6.2603, 'Europe/Dublin'],
  'lisbon': [38.7223, -9.1393, 'Europe/Lisbon'],
  'amsterdam': [52.3676, 4.9041, 'Europe/Amsterdam'],
  'stockholm': [59.3293, 18.0686, 'Europe/Stockholm'],
  'athens': [37.9838, 23.7275, 'Europe/Athens'],
  'new york': [40.7128, -74.006, 'America/New_York'],
  'los angeles': [34.0522, -118.2437, 'America/Los_Angeles'],
  'chicago': [41.8781, -87.6298, 'America/Chicago'],
  'houston': [29.7604, -95.3698, 'America/Chicago'],
  'phoenix': [33.4484, -112.074, 'America/Phoenix'],
  'denver': [39.7392, -104.9903, 'America/Denver'],
  'boise': [43.615, -116.2023, 'America/Boise'],
  'seattle': [47.6062, -122.3321, 'America/Los_Angeles'],
  'san francisco': [37.7749, -122.4194, 'America/Los_Angeles'],
  'miami': [25.7617, -80.1918, 'America/New_York'],
  'atlanta': [33.749, -84.388, 'America/New_York'],
  'boston': [42.3601, -71.0589, 'America/New_York'],
  'toronto': [43.6532, -79.3832, 'America/Toronto'],
  'vancouver': [49.2827, -123.1207, 'America/Vancouver'],
  'mexico city': [19.4326, -99.1332, 'America/Mexico_City'],
  'sao paulo': [-23.5505, -46.6333, 'America/Sao_Paulo'],
  'buenos aires': [-34.6037, -58.3816, 'America/Argentina/Buenos_Aires'],
  'lima': [-12.0464, -77.0428, 'America/Lima'],
  'bogota': [4.711, -74.0721, 'America/Bogota'],
  'tokyo': [35.6762, 139.6503, 'Asia/Tokyo'],
  'beijing': [39.9042, 116.4074, 'Asia/Shanghai'],
  'shanghai': [31.2304, 121.4737, 'Asia/Shanghai'],
  'hong kong': [22.3193, 114.1694, 'Asia/Hong_Kong'],
  'singapore': [1.3521, 103.8198, 'Asia/Singapore'],
  'seoul': [37.5665, 126.978, 'Asia/Seoul'],
  'mumbai': [19.076, 72.8777, 'Asia/Kolkata'],
  'delhi': [28.7041, 77.1025, 'Asia/Kolkata'],
  'new delhi': [28.6139, 77.209, 'Asia/Kolkata'],
  'bangalore': [12.9716, 77.5946, 'Asia/Kolkata'],
  'bangkok': [13.7563, 100.5018, 'Asia/Bangkok'],
  'jakarta': [-6.2088, 106.8456, 'Asia/Jakarta'],
  'manila': [14.5995, 120.9842, 'Asia/Manila'],
  'dubai': [25.2048, 55.2708, 'Asia/Dubai'],
  'tehran': [35.6892, 51.389, 'Asia/Tehran'],
  'istanbul': [41.0082, 28.9784, 'Europe/Istanbul'],
  'jerusalem': [31.7683, 35.2137, 'Asia/Jerusalem'],
  'tel aviv': [32.0853, 34.7818, 'Asia/Jerusalem'],
  'cairo': [30.0444, 31.2357, 'Africa/Cairo'],
  'lagos': [6.5244, 3.3792, 'Africa/Lagos'],
  'nairobi': [-1.2921, 36.8219, 'Africa/Nairobi'],
  'johannesburg': [-26.2041, 28.0473, 'Africa/Johannesburg'],
  'cape town': [-33.9249, 18.4241, 'Africa/Johannesburg'],
  'casablanca': [33.5731, -7.5898, 'Africa/Casablanca'],
  'sydney': [-33.8688, 151.2093, 'Australia/Sydney'],
  'melbourne': [-37.8136, 144.9631, 'Australia/Melbourne'],
  'brisbane': [-27.4698, 153.0251, 'Australia/Brisbane'],
  'perth': [-31.9505, 115.8605, 'Australia/Perth'],
  'adelaide': [-34.9285, 138.6007, 'Australia/Adelaide'],
  'auckland': [-36.8485, 174.7633, 'Pacific/Auckland'],
  'honolulu': [21.3069, -157.8583, 'Pacific/Honolulu'],
  'anchorage': [61.2181, -149.9003, 'America/Anchorage'],
  'reykjavik': [64.1466, -21.9426, 'Atlantic/Reykjavik'],
};

function normalizeCity(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents: "São Paulo" → "sao paulo"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Take the part before the first comma, so "Boise, Idaho, USA" still matches.
function cityKeyCandidates(query) {
  const n = normalizeCity(query);
  const head = normalizeCity(String(query).split(',')[0]);
  return [...new Set([n, head])].filter(Boolean);
}

function lookupOffline(query) {
  for (const key of cityKeyCandidates(query)) {
    if (CITIES[key]) {
      const [latitude, longitude, timezone] = CITIES[key];
      return {
        name: key.replace(/\b\w/g, c => c.toUpperCase()),
        latitude, longitude, timezone, source: 'offline',
      };
    }
  }
  return null;
}

// Open-Meteo geocoding: free, no key, no signup, Access-Control-Allow-Origin: *,
// and it returns the IANA timezone alongside the coordinates — which is exactly
// what localToUTC needs next. Same class of API as tools/web-search.js uses.
async function lookupOnline(query, { timeout = GEOCODE_TIMEOUT } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(String(query).split(',')[0].trim())}&count=10&language=en&format=json`;
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    const hits = (data && data.results) || [];
    if (!hits.length) return null;

    // "Boise, Idaho" — bias toward a hit whose admin/country text matches the
    // qualifiers the user supplied, otherwise Open-Meteo's own ranking wins.
    const quals = String(query).split(',').slice(1).map(s => normalizeCity(s)).filter(Boolean);
    const scored = hits.map(h => {
      const hay = normalizeCity([h.admin1, h.admin2, h.country, h.country_code].filter(Boolean).join(' '));
      return { h, score: quals.filter(q => hay.includes(q) || q.includes(normalizeCity(h.country_code))).length };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0].h;

    return {
      name: [best.name, best.admin1, best.country].filter(Boolean).join(', '),
      latitude: best.latitude,
      longitude: best.longitude,
      timezone: best.timezone,
      source: 'open-meteo',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * resolvePlace — birth place → { name, latitude, longitude, timezone, source }.
 * Accepts a place name, or "lat,lon" coordinates directly.
 * Offline table is tried first (instant, works with no network); the online
 * lookup is the fallback so a cached PWA still resolves common cities.
 */
export async function resolvePlace(query, opts = {}) {
  const raw = String(query || '').trim();
  if (!raw) throw new Error('Birth place is required (city name, or "latitude,longitude").');

  // Explicit coordinates: "43.61, -116.20"
  const coord = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (coord) {
    const latitude = parseFloat(coord[1]);
    const longitude = parseFloat(coord[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new Error(`Coordinates out of range: latitude ${latitude}, longitude ${longitude}.`);
    }
    return {
      name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      latitude, longitude,
      timezone: opts.timezone || 'UTC',
      source: 'coordinates',
    };
  }

  return lookupOffline(raw)
      || await lookupOnline(raw, opts)
      || (() => {
           throw new Error(
             `Could not resolve birth place "${raw}". Give coordinates instead, as "latitude,longitude".`
           );
         })();
}

// Wall-clock reading in `zone` at a real UTC instant, as {ms, iso} where ms is
// that reading re-expressed as if it were UTC. Reads the browser's IANA tz
// database, so historical DST rules come free.
function wallClockIn(utcMs, zone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
  } catch {
    throw new Error(`Unknown timezone "${zone}". Use an IANA name like "America/Boise".`);
  }
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  // hour formats as "24" at midnight in some engines; fold it to 0.
  const ms = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return { ms, iso: new Date(ms).toISOString().slice(0, 16) };
}

// UTC offset in minutes that `zone` is using AT a real instant. Positive = east.
function offsetAtInstant(utcMs, zone) {
  return (wallClockIn(utcMs, zone).ms - utcMs) / 60000;
}

/**
 * Resolve a wall-clock reading to the real UTC instant(s) it denotes.
 *
 * A local time is not always one instant. At a spring-forward transition the
 * reading never happens; at a fall-back transition it happens twice. Probing
 * the offset a day either side gives both candidate offsets; keeping only the
 * candidates that actually read back as the requested wall clock tells us which
 * case we are in. Guessing here would silently rotate the whole house structure.
 *
 * @returns { instants[] (0, 1 or 2, ascending), offsets[] }
 */
function localReadingToInstants(isoLocal, zone) {
  const naive = Date.parse(isoLocal + 'Z');
  if (Number.isNaN(naive)) throw new Error(`Invalid date/time: "${isoLocal}"`);
  const want = isoLocal.slice(0, 16);
  const DAY = 86400000;

  const candidateOffsets = [...new Set([
    offsetAtInstant(naive - DAY, zone),
    offsetAtInstant(naive + DAY, zone),
  ])];

  const instants = [...new Set(candidateOffsets.map(o => naive - o * 60000))]
    .filter(t => wallClockIn(t, zone).iso === want)
    .sort((a, b) => a - b);

  return { instants, offsets: candidateOffsets };
}

// Julian Day from a UTC calendar moment. Handles the 1582 Gregorian reform and
// works for negative years (Meeus, Astronomical Algorithms ch. 7).
export function julianDayUTC(year, month, day, hour = 0, minute = 0, second = 0) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const gregorian = (year > 1582)
    || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  let B = 0;
  if (gregorian) { const A = Math.floor(y / 100); B = 2 - A + Math.floor(A / 4); }
  const dayFrac = day + (hour + minute / 60 + second / 3600) / 24;
  return Math.floor(365.25 * (y + 4716))
       + Math.floor(30.6001 * (m + 1))
       + dayFrac + B - 1524.5;
}

/**
 * localToUTC — wall-clock birth time in a timezone → the UTC instant + Julian Day.
 *
 * @param date      'YYYY-MM-DD'
 * @param time      'HH:MM' (24h) — or null/'' for an unknown birth time
 * @param timezone  IANA zone, e.g. 'America/Boise'
 * @returns { jdUT, utcISO, offsetMinutes, timeKnown, warnings[] }
 *
 * When the birth time is unknown we use noon local: it minimises the worst-case
 * error on the Moon and keeps the date correct in both directions. The caller
 * MUST then suppress houses and the Ascendant, which are meaningless without a
 * time — that is what `timeKnown: false` signals.
 */
export function localToUTC(date, time, timezone) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '').trim());
  if (!dm) throw new Error(`Birth date must be YYYY-MM-DD, got "${date}".`);

  const warnings = [];
  const timeKnown = !!(time && String(time).trim());
  let hh = 12, mi = 0;
  if (timeKnown) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time).trim());
    if (!tm) throw new Error(`Birth time must be HH:MM (24-hour), got "${time}".`);
    hh = +tm[1]; mi = +tm[2];
    if (hh > 23 || mi > 59) throw new Error(`Birth time out of range: "${time}".`);
  } else {
    warnings.push('Birth time unknown — using noon local. Houses, Ascendant and Midheaven cannot be calculated, and the Moon may be off by up to ~6°.');
  }

  const isoLocal = `${dm[1]}-${dm[2]}-${dm[3]}T${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
  const { instants, offsets } = localReadingToInstants(isoLocal, timezone);

  let utcMs;
  if (instants.length === 1) {
    utcMs = instants[0];
  } else if (instants.length === 2) {
    // Fall-back overlap — the reading happened twice. Convention is the first
    // (still on daylight time); an hour of doubt is ~15° of Ascendant, so say so.
    utcMs = instants[0];
    const alt = new Date(instants[1]).toISOString().slice(11, 16);
    warnings.push(`${isoLocal.slice(11, 16)} occurred TWICE in ${timezone} on ${dm[1]}-${dm[2]}-${dm[3]} (clocks went back). Using the first occurrence; the second would be ${alt} UTC and shifts the Ascendant by roughly 15°. Check whether the birth record noted daylight time.`);
  } else {
    // Spring-forward gap — the reading never existed. Use the pre-transition
    // offset so the result is at least deterministic, and flag it loudly.
    const off = Math.max(...offsets);
    utcMs = Date.parse(isoLocal + 'Z') - off * 60000;
    warnings.push(`${isoLocal.slice(11, 16)} did not exist in ${timezone} on ${dm[1]}-${dm[2]}-${dm[3]} — clocks skipped forward over it. The recorded birth time may be in the pre-change offset; treat the Ascendant as uncertain by up to an hour.`);
  }

  const offsetMinutes = offsetAtInstant(utcMs, timezone);
  const u = new Date(utcMs);
  return {
    jdUT: julianDayUTC(
      u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate(),
      u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds()
    ),
    utcISO: u.toISOString(),
    offsetMinutes,
    timeKnown,
    warnings,
  };
}

/**
 * resolveBirthMoment — the whole front end of a natal chart in one call:
 * place string + local date/time → coordinates, timezone, UTC instant, Julian Day.
 */
export async function resolveBirthMoment({ date, time, place, timezone, latitude, longitude }) {
  let loc;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    loc = {
      name: place || `${(+latitude).toFixed(4)}, ${(+longitude).toFixed(4)}`,
      latitude: +latitude, longitude: +longitude,
      timezone: timezone || 'UTC',
      source: 'explicit',
    };
  } else {
    loc = await resolvePlace(place, { timezone });
    if (timezone) loc.timezone = timezone;   // caller override wins
  }
  const t = localToUTC(date, time, loc.timezone);
  return { place: loc, time: t };
}

export const __testing = { offsetAtInstant, normalizeCity, lookupOffline, CITIES };

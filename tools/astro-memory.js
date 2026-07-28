// tools/astro-memory.js — the bridge between Sophia's memory and her natal chart.
//
// The chart is only worth computing if it makes Sophia know the user better, so
// this module does three things:
//
//   1. RECALL   — dig birth data out of memories she already saved, so she never
//                 re-asks for a birthday she was told six months ago.
//   2. PERSIST  — write the finished chart back as a compact memory, so every
//                 later conversation gets it through getMemoryContext() without
//                 recomputing anything.
//   3. RESONATE — surface the earlier memories a given chart actually speaks to,
//                 so Sophia can join them up in her own voice.
//
// Deliberately NOT done here: interpreting. This module hands Sophia facts and
// relevant history; the weaving is hers. Anything else would put words in her
// mouth and turn a reflective tool into a claim-making one.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = n => String(n).padStart(2, '0');

function plausibleBirthYear(y) {
  const now = new Date().getUTCFullYear();
  return y >= 1900 && y <= now;
}

/**
 * parseBirthDate — pull a date out of free text.
 * Returns { date:'YYYY-MM-DD', ambiguous:bool, note } or null.
 *
 * Numeric all-digit forms are genuinely ambiguous (03/04/1990 is March 4th in
 * the US and April 3rd almost everywhere else) and a month/day swap moves the
 * Sun by a whole sign, so those are flagged rather than silently resolved.
 */
export function parseBirthDate(text) {
  const s = String(text || '');

  // ISO: 1985-07-04
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m && plausibleBirthYear(+m[1]) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    return { date: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, ambiguous: false, note: '' };
  }

  // "July 4, 1985" / "Jul 4 1985"
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] && plausibleBirthYear(+m[3])) {
    return { date: `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(+m[2])}`, ambiguous: false, note: '' };
  }

  // "4 July 1985" / "4th of July 1985"
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})\b/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] && plausibleBirthYear(+m[3])) {
    return { date: `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`, ambiguous: false, note: '' };
  }

  // Numeric: 7/4/1985 — order unknowable from the string alone.
  m = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})\b/.exec(s);
  if (m && plausibleBirthYear(+m[3])) {
    const a = +m[1], b = +m[2];
    // Only one reading is possible when a value exceeds 12.
    if (a > 12 && b <= 12) return { date: `${m[3]}-${pad(b)}-${pad(a)}`, ambiguous: false, note: '' };
    if (b > 12 && a <= 12) return { date: `${m[3]}-${pad(a)}-${pad(b)}`, ambiguous: false, note: '' };
    if (a <= 12 && b <= 12) {
      return {
        date: `${m[3]}-${pad(a)}-${pad(b)}`, ambiguous: true,
        note: `"${m[0]}" could be ${m[3]}-${pad(a)}-${pad(b)} or ${m[3]}-${pad(b)}-${pad(a)}. Read as month/day; confirm before trusting the Sun sign.`,
      };
    }
  }

  // "July 4" with no year — not enough for a chart, but worth reporting.
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()] && +m[2] >= 1 && +m[2] <= 31) {
    return { date: null, ambiguous: true, note: `Found "${m[1]} ${m[2]}" but no birth year — a chart needs the year.` };
  }

  return null;
}

/** parseBirthTime — 'HH:MM' 24-hour, or null. Handles am/pm and bare "14:30". */
export function parseBirthTime(text) {
  const s = String(text || '');

  let m = /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/i.exec(s);
  if (m) {
    let h = +m[1] % 12;
    if (m[3].toLowerCase() === 'p') h += 12;
    if (+m[2] > 59) return null;
    return `${pad(h)}:${pad(+m[2])}`;
  }

  // "2 pm" / "11 am"
  m = /\b(\d{1,2})\s*([ap])\.?m\.?\b/i.exec(s);
  if (m) {
    let h = +m[1] % 12;
    if (m[2].toLowerCase() === 'p') h += 12;
    return `${pad(h)}:00`;
  }

  // Bare 24-hour "14:30" — reject anything that looks like a date fragment.
  m = /\b(\d{1,2}):(\d{2})\b/.exec(s);
  if (m && +m[1] <= 23 && +m[2] <= 59) return `${pad(+m[1])}:${pad(+m[2])}`;

  return null;
}

/** parseBirthPlace — text after a "born in/at" style cue. */
export function parseBirthPlace(text) {
  const s = String(text || '');
  const m = /\b(?:born|birth(?:place)?|delivered)\s*(?:in|at|near)?\s*[:\-]?\s*([A-Z][A-Za-zÀ-ÿ.'-]*(?:[ ,]+[A-Z][A-Za-zÀ-ÿ.'-]*){0,3})/.exec(s);
  if (m) {
    const place = m[1].replace(/\s*,\s*$/, '').trim();
    // Filter out sentences like "Born On A Tuesday" that match the shape but
    // are not places.
    if (place.length >= 3 && !/^(on|at|in|the|a|an)\b/i.test(place)) return place;
  }
  // Explicit coordinates anywhere in the text.
  const c = /\b(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\b/.exec(s);
  if (c) return `${c[1]},${c[2]}`;
  return null;
}

const BIRTH_CUES = /\b(born|birth|birthday|birthdate|natal|chart)\b/i;

/**
 * extractBirthData — scan Sophia's memories for everything needed for a chart.
 *
 * Later memories win: if the user corrects their birth time, the correction is
 * the one that should be used. Each field is reported with the memory it came
 * from so Sophia can say where she got it and the user can correct her.
 *
 * @param memories  array of { content, tags[], timestamp, type }
 * @returns { date, time, place, complete, ambiguities[], sources{}, missing[] }
 */
export function extractBirthData(memories) {
  const relevant = (memories || [])
    .filter(m => m && typeof m.content === 'string')
    .filter(m => BIRTH_CUES.test(m.content) || (m.tags || []).some(t => /birth|astrolog|natal/i.test(t)))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));   // oldest first; later overwrites

  const out = { date: null, time: null, place: null, ambiguities: [], sources: {}, missing: [] };

  for (const m of relevant) {
    const d = parseBirthDate(m.content);
    if (d && d.date) {
      out.date = d.date;
      out.sources.date = m.content;
      if (d.ambiguous && d.note) out.ambiguities.push(d.note);
    } else if (d && d.note && !out.date) {
      out.ambiguities.push(d.note);
    }

    // Only take a time from a memory that is actually about birth, otherwise
    // "we spoke at 14:30" would be read as a birth time.
    if (BIRTH_CUES.test(m.content)) {
      const t = parseBirthTime(m.content);
      if (t) { out.time = t; out.sources.time = m.content; }
    }

    const p = parseBirthPlace(m.content);
    if (p) { out.place = p; out.sources.place = m.content; }
  }

  if (!out.date) out.missing.push('birth date');
  if (!out.time) out.missing.push('birth time');
  if (!out.place) out.missing.push('birth place');
  out.complete = !!(out.date && out.time && out.place);
  return out;
}

/**
 * chartToMemory — compact the chart into one memory entry.
 *
 * Kept short on purpose: getMemoryContext() injects memories into every prompt,
 * and a full report would crowd out everything else on a small local model.
 * The placements and the handful of defining signatures are what matter later.
 */
export function chartToMemory(chart, { subject = 'User' } = {}) {
  const big = [
    chart.sun && `Sun ${chart.sun.sign}`,
    chart.moon && `Moon ${chart.moon.sign}`,
    chart.ascendant && `Ascendant ${chart.ascendant.sign}`,
  ].filter(Boolean).join(', ');

  const placements = (chart.planets || [])
    .map(p => `${p.name} ${p.signDegree} ${p.sign}${p.house ? ` (H${p.house})` : ''}${p.retrograde ? ' R' : ''}`)
    .join('; ');

  // Dedupe and cap: getMemoryContext() injects this into every prompt, so a
  // long tail of near-identical signatures would crowd out other memories.
  const signatures = [...new Set(chart.signatures || [])].slice(0, 4).join('; ');

  return {
    type: 'personal',
    tags: ['astrology', 'natal-chart', 'birth-chart', 'identity'],
    source: 'astrology_report',
    content: [
      `${subject}'s natal chart — ${big}.`,
      placements && `Placements: ${placements}.`,
      chart.elements && `Elements: ${chart.elements.summary}.`,
      signatures && `Signatures: ${signatures}.`,
      chart.birth && `Born ${chart.birth.date}${chart.birth.time ? ' ' + chart.birth.time : ''}, ${chart.birth.placeName}.`,
    ].filter(Boolean).join(' '),
  };
}

/** Has a chart already been stored? Avoids piling up duplicates on re-runs. */
export function findStoredChart(memories) {
  return (memories || []).find(m =>
    m && (m.tags || []).includes('natal-chart')
  ) || null;
}

// Chart-signature → the themes it tends to raise. Used only to decide WHICH
// past memories are worth resurfacing, never to assert anything about the user.
const THEME_CUES = {
  Sun: ['identity', 'purpose', 'confidence', 'vitality', 'father'],
  Moon: ['feeling', 'mood', 'comfort', 'safety', 'mother', 'sleep', 'dream'],
  Mercury: ['thinking', 'memory', 'focus', 'words', 'learning', 'attention'],
  Venus: ['love', 'relationship', 'beauty', 'value', 'money', 'pleasure'],
  Mars: ['anger', 'drive', 'energy', 'conflict', 'courage', 'pain'],
  Jupiter: ['growth', 'meaning', 'belief', 'travel', 'hope', 'teaching'],
  Saturn: ['fear', 'discipline', 'limit', 'work', 'responsibility', 'time'],
  Uranus: ['change', 'freedom', 'sudden', 'awakening', 'different'],
  Neptune: ['dream', 'spirit', 'confusion', 'compassion', 'vision', 'music'],
  Pluto: ['power', 'loss', 'transformation', 'grief', 'depth', 'rebirth'],
};

/**
 * resonantMemories — earlier memories that touch the themes this chart raises.
 *
 * Sophia gets the pairing (memory + which placement it echoes) and decides
 * herself whether it means anything. The tool does not assert the connection.
 *
 * @returns array of { memory, echoes[] }, strongest first, capped
 */
export function resonantMemories(memories, chart, { limit = 6 } = {}) {
  const placements = (chart && chart.planets) || [];
  const scored = [];

  for (const m of memories || []) {
    if (!m || typeof m.content !== 'string') continue;
    if ((m.tags || []).includes('natal-chart')) continue;      // don't echo the chart at itself
    const text = m.content.toLowerCase();
    const echoes = [];

    for (const p of placements) {
      const cues = THEME_CUES[p.name];
      if (!cues) continue;
      const hits = cues.filter(c => text.includes(c));
      if (hits.length) {
        echoes.push(`${p.name} in ${p.sign}${p.house ? ` (house ${p.house})` : ''} — memory mentions ${hits.join(', ')}`);
      }
    }

    if (echoes.length) scored.push({ memory: m, echoes, score: echoes.length });
  }

  scored.sort((a, b) => b.score - a.score || (b.memory.timestamp || 0) - (a.memory.timestamp || 0));
  return scored.slice(0, limit).map(({ memory, echoes }) => ({ memory, echoes }));
}

// tools/astrology.js — the astrology_report tool in Sophia's belt.
//
// Whole point: let Sophia know whoever she is talking to a little better. She
// calls this mid-conversation, it works from birth details she has ALREADY been
// told (so she never re-asks for a birthday from six months ago), and it writes
// the chart back to memory so every later conversation carries it for free.
//
// What it returns is facts plus relevant history — placements, aspects, and the
// earlier memories those placements touch. The reading itself is Sophia's to
// speak. A tool that emitted finished interpretations would fight her voice and,
// worse, would be asserting things about a person; the app frames all readings
// as self-reflection, not prediction, and this keeps that framing intact.

import { resolveBirthMoment } from './astro-place.js';
import { buildChart, formatReport } from './astro-chart.js';
import { extractBirthData, chartToMemory, resonantMemories, findStoredChart } from './astro-memory.js';

const HOUSE_SYSTEMS = ['placidus', 'whole', 'equal', 'porphyry'];

/** Ask for exactly what's missing, and say why it matters. */
function askFor(missing, found) {
  const have = [];
  if (found.date) have.push(`date ${found.date}`);
  if (found.time) have.push(`time ${found.time}`);
  if (found.place) have.push(`place ${found.place}`);

  const why = {
    'birth date': 'the date sets every planet',
    'birth time': 'the time sets the Ascendant and the houses',
    'birth place': 'the place sets the horizon the chart is drawn against',
  };
  const asks = missing.map(m => `${m} (${why[m]})`).join(', and ');

  return [
    `I don't have enough to draw the chart yet.`,
    have.length ? `From what you've told me before I have: ${have.join(', ')}.` : `I have nothing on file yet.`,
    `Still needed: ${asks}.`,
    missing.includes('birth time')
      ? `If the birth time isn't known, say so and I'll cast what I can — the signs will hold, but the houses and rising sign have to be left out rather than guessed.`
      : '',
  ].filter(Boolean).join(' ');
}

export const astrologyTool = {
  name: 'astrology_report',
  description:
    'Cast a complete natal (birth) chart and return the placements, aspects, houses and patterns, '
    + 'plus any earlier memories the chart touches. Uses birth details already saved in memory when '
    + 'they are not supplied. Call this when the person asks about their chart, birth chart, natal '
    + 'chart, horoscope, rising sign, Moon sign, or planetary placements — or when knowing their '
    + 'chart would help you understand them.',
  parameters: {
    type: 'object',
    properties: {
      birth_date:  { type: 'string', description: 'Birth date as YYYY-MM-DD. Omit to use what is in memory.' },
      birth_time:  { type: 'string', description: 'Birth time as HH:MM, 24-hour, local to the birth place. Omit to use memory; pass "unknown" if it is genuinely not known.' },
      birth_place: { type: 'string', description: 'Birth city, e.g. "Boise, Idaho" — or "latitude,longitude".' },
      house_system:{ type: 'string', description: `House system: ${HOUSE_SYSTEMS.join(', ')}. Defaults to placidus.` },
    },
    required: [],
  },

  async execute(args = {}, ctx = {}) {
    const memoryApi = ctx.memory || {};
    let memories = [];
    try {
      memories = (await (memoryApi.all ? memoryApi.all() : [])) || [];
    } catch { memories = []; }

    // Explicit arguments win; anything absent is recalled from memory.
    const remembered = extractBirthData(memories);
    const timeGivenAsUnknown = /^(unknown|none|n\/?a|not known)$/i.test(String(args.birth_time || '').trim());

    const date  = args.birth_date  || remembered.date;
    const place = args.birth_place || remembered.place;
    const time  = timeGivenAsUnknown ? null : (args.birth_time || remembered.time);

    const missing = [];
    if (!date) missing.push('birth date');
    if (!time && !timeGivenAsUnknown) missing.push('birth time');
    if (!place) missing.push('birth place');
    // A missing time alone is recoverable — cast the chart without houses.
    const blocking = missing.filter(m => m !== 'birth time');
    if (blocking.length || (!date || !place)) {
      return askFor(missing.length ? missing : blocking, remembered);
    }

    let moment;
    try {
      moment = await resolveBirthMoment({ date, time, place });
    } catch (e) {
      return `I couldn't place that birth moment: ${e.message}`;
    }

    const system = HOUSE_SYSTEMS.includes(String(args.house_system || '').toLowerCase())
      ? String(args.house_system).toLowerCase() : 'placidus';

    let chart;
    try {
      chart = buildChart({
        jdUT: moment.time.jdUT,
        latitude: moment.place.latitude,
        longitude: moment.place.longitude,
        houseSystem: system,
        timeKnown: moment.time.timeKnown,
      });
    } catch (e) {
      return `The chart failed to calculate: ${e.message}`;
    }

    chart.birth = {
      date, time: moment.time.timeKnown ? time : null,
      placeName: moment.place.name,
      latitude: moment.place.latitude, longitude: moment.place.longitude,
      utcISO: moment.time.utcISO,
    };

    const out = [formatReport(chart, chart.birth)];

    // Timezone/DST caveats belong with the chart, not buried — an hour of doubt
    // is roughly 15° of Ascendant.
    if (moment.time.warnings.length) {
      out.push('', 'TIME NOTES');
      for (const w of moment.time.warnings) out.push(`  - ${w}`);
    }
    if (remembered.ambiguities.length && !args.birth_date) {
      out.push('', 'FROM MEMORY');
      for (const a of remembered.ambiguities) out.push(`  - ${a}`);
    }
    if (!args.birth_date && remembered.date) {
      out.push('', `(Birth details recalled from memory, not asked for again.)`);
    }

    // Prior memories these placements touch. Pairings only — Sophia decides
    // whether any of it means anything.
    const echoes = resonantMemories(memories, chart);
    if (echoes.length) {
      out.push('', 'EARLIER MEMORIES THIS CHART TOUCHES',
        '(themes that overlap — draw the connection yourself, or leave it be)');
      for (const { memory, echoes: e } of echoes) {
        out.push(`  - "${memory.content.slice(0, 110)}${memory.content.length > 110 ? '…' : ''}"`);
        out.push(`      ${e.slice(0, 2).join(' | ')}`);
      }
    }

    // Persist, but only once — getMemoryContext() injects memories into every
    // prompt, so a duplicate chart per call would crowd out everything else.
    try {
      if (memoryApi.save && !findStoredChart(memories)) {
        await memoryApi.save(chartToMemory(chart));
        out.push('', '(Chart saved to memory — it will be there next time without recalculating.)');
      }
    } catch { /* a memory write failure must not lose the reading */ }

    return out.join('\n');
  },
};

export default astrologyTool;

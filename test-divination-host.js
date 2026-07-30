/* test-divination-host.js — exercises the DIVINATION glue block that lives inside
 * index.html (ring buffer, frame quality, rolling personal baseline, mode toggle,
 * provenance rendering, knowledge-base hook). The block is READ OUT OF index.html
 * and run against stubs, so this tests the shipping code rather than a copy.
 * Plain node, no dependencies:  node test-divination-host.js                    */
const fs = require('fs');
const { Divination: D, DIVINATION_TOOLS: T } = require('./divination-core.js');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

/* ---------------------------------------------- lift the block out of the HTML */
const html = fs.readFileSync('./index.html', 'utf8');
const START = '// DIVINATION (divination-core.js) — host-side wiring';
const END   = '// END DIVINATION';
const a = html.indexOf(START), b = html.indexOf(END, a);
if (a < 0 || b < 0) { console.log('FAIL: divination block not found in index.html'); process.exit(1); }
const block = html.slice(html.indexOf('\n', a) + 1, html.lastIndexOf('\n', b));
ok(block.includes('function pushDivinationFrame'), 'block contains the ring-buffer push');
ok(block.includes('function divinationSystemNote'), 'block contains the system note');

/* Also assert the block is actually wired into the live EEG stream and the
 * registry — a perfect module nobody calls is the likeliest way this breaks. */
ok(/currentEEGData = event\.detail;\s*(\/\/[^\n]*\n\s*)*pushDivinationFrame\(event\.detail\);/.test(html),
   'pushDivinationFrame is called from the EEG data handler');
ok(html.includes('Object.assign(defaultTools, window.DIVINATION_TOOLS || {});'),
   'divination tools are merged into defaultTools');
ok(html.includes('<script src="divination-core.js"></script>'), 'sidecar is loaded by index.html');
ok(html.includes('divinationProvenanceHTML(toolResult)'), 'provenance line is rendered on tool results');
ok(html.includes('divinationProvenanceFromJSON(e.result)'), 'provenance line reaches the agentic path');
// A top-level `const` in a classic script is NOT a window property, so the
// frequency table has to be published explicitly or every Aetheria bridge and
// cube cell silently comes back empty.
ok(/window\.AETHERIA_FREQUENCIES = AETHERIA_FREQUENCIES;/.test(html),
   'AETHERIA_FREQUENCIES is published on window for the sidecar');

/* ------------------------------------------------- tool budget + opt-in defaults */
console.log('--- Tool budget advice ---');
{
  // Lifted out of index.html the same way as the divination block, then run
  // against each routing case. Tool count is capped by what the MODEL can use
  // well, not by the context window, so the tiers must differ per model.
  const bStart = html.indexOf('function recommendedToolBudget()');
  const bEnd = html.indexOf('function updateToolsIndicator()', bStart);
  ok(bStart > 0 && bEnd > bStart, 'recommendedToolBudget found in index.html');
  const budgetFor = new Function('shouldUseLocal', 'LOCAL_MODELS', 'selectedLocalModel',
    html.slice(bStart, bEnd) + '\nreturn recommendedToolBudget();');

  const MODELS = {
    'tiny':       { name: 'Qwen 0.5B — Spark', family: 'qwen' },
    'agent-lite': { name: 'LFM2.5 — Agent Lite', family: 'lfm25' },
    'agent-qwen': { name: 'Qwen3.5 2B', family: 'qwen35', nativeTools: true }
  };
  const remote = budgetFor(() => false, MODELS, 'tiny');
  const tiny   = budgetFor(() => true, MODELS, 'tiny');
  const lfm    = budgetFor(() => true, MODELS, 'agent-lite');
  const native = budgetFor(() => true, MODELS, 'agent-qwen');
  console.log(`  remote=${remote.max}  tiny=${tiny.max}  lfm2.5=${lfm.max}  native-tools=${native.max}`);
  ok(remote.max === 20, 'remote models get the loosest budget');
  ok(tiny.max === 5, 'prompt-described tiny models get the tightest budget');
  ok(lfm.max === 10 && native.max === 10, 'tool-trained local models sit in between');
  ok(tiny.max < lfm.max && lfm.max < remote.max, 'budgets are ordered by model capability');
  [remote, tiny, lfm, native].forEach(b => {
    ok(typeof b.why === 'string' && b.why.length > 20, 'each budget explains itself: ' + b.why);
    ok(typeof b.model === 'string' && b.model.length > 0, 'each budget names the model');
  });
  ok(lfm.model.includes('Agent Lite'), 'local budget names the selected model, got ' + lfm.model);
  // Must not throw when called during init, before routing exists.
  const early = budgetFor(undefined, {}, undefined);
  ok(early && early.max === 20, 'called before routing exists it degrades to the remote tier');

  // The shipped default must actually sit inside the budget it advertises, or the
  // note cries wolf on a clean install. Count the app's own default-on tools out
  // of the registry source and add the module's.
  const regStart = html.indexOf('const defaultTools = {');
  const regEnd = html.indexOf('Object.assign(defaultTools, window.DIVINATION_TOOLS', regStart);
  const registry = html.slice(regStart, regEnd);
  const appPairs = registry.match(/^ {20}enabled: (true|false)/gm) || [];
  const appOn = appPairs.filter(s => s.endsWith('true')).length;
  const divOn = Object.keys(T).filter(k => T[k].enabled).length;
  console.log(`  shipped default: ${appOn} app + ${divOn} divination = ${appOn + divOn} enabled`);
  ok(divOn === 4, 'four divination tools ship on, got ' + divOn);
  ok(appOn === 5, 'five app tools ship on, got ' + appOn);
  ok(appOn + divOn <= lfm.max, `the default ${appOn + divOn} fits the tool-trained budget of ${lfm.max}`);
  ok(appOn + divOn > tiny.max, 'and honestly exceeds the tiny-model budget rather than pretending otherwise');
  ok(html.includes('id="toolBudgetNote"'), 'the sidebar note element exists');
  // Both sets of newly-opted-out tools must be released from any saved state.
  const migration = html.slice(html.indexOf("const TOOL_DEFAULTS_VERSION"), html.indexOf("// Update enabled states"));
  ok(/localStorage\.getItem\('sophiaToolDefaults'\)/.test(migration), 'the one-time defaults migration is present');
  ['calculator', 'textAnalysis', 'dataProcessor', 'imageInfo', 'audioAnalysis'].forEach(k =>
     ok(migration.includes(`'${k}'`), 'migration releases ' + k));
  ok(/Object\.keys\(window\.DIVINATION_TOOLS \|\| \{\}\)/.test(migration), 'migration releases the divination tools too');
  ok(/updateToolsIndicator\(\);\s*\/\/ local vs remote/.test(html),
     'switching inference mode re-advises');
}

/* ------------------------------------- the real 27-frequency table, from the app */
const freqStart = html.indexOf('const AETHERIA_FREQUENCIES = [');
const freqEnd = html.indexOf('window.AETHERIA_FREQUENCIES =', freqStart);
const FREQ = new Function(html.slice(freqStart, freqEnd) + '\nreturn AETHERIA_FREQUENCIES;')();
globalThis.AETHERIA_FREQUENCIES = FREQ;      // mirrors what the browser sees

console.log('--- Aetheria bridge against the real table ---');
ok(FREQ.length === 27, 'table holds 27 positions, got ' + FREQ.length);
ok(new Set(FREQ.map(f => f.hex)).size === 27, 'the 27 mapped hexagrams are distinct');
ok(FREQ.every(f => D.byNum(f.hex)), 'every mapped hexagram number is real');
// The table's own hex names must match the module's, or a reading and the
// frequency panel would name the same hexagram differently.
const nameMismatch = FREQ.filter(f => {
    const mine = D.byNum(f.hex).english.toLowerCase();
    const theirs = String(f.hexName).toLowerCase();
    return !mine.includes(theirs) && !theirs.includes(mine);
});
ok(nameMismatch.length === 0, 'hexagram names agree with the table: ' +
   nameMismatch.map(f => `pos ${f.pos} hex ${f.hex} "${f.hexName}" vs "${D.byNum(f.hex).english}"`).join('; '));
const hist = {};
for (let n = 1; n <= 64; n++) {
    const r = D.aetheriaForHexagram(n);          // reads the global table
    ok(r.positions.length > 0, 'hexagram ' + n + ' bridges to a frequency');
    hist[r.distance] = (hist[r.distance] || 0) + 1;
}
console.log('  bridge distance histogram (real table):', hist);
ok(hist[0] === 27, '27 hexagrams map directly, got ' + hist[0]);
ok(Object.keys(hist).every(d => Number(d) <= 2), 'every hexagram lands within two line-changes');

/* ------------------------------------------------------------------- stubs */
function harness() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const elements = {};
  const document = { getElementById: id => elements[id] || null };
  const statuses = [];
  const showStatus = (msg, kind) => statuses.push({ msg, kind });
  const win = { Divination: D, DIVINATION_TOOLS: T };
  const config = {};
  const uploadedFiles = [];
  const tools = {};
  Object.keys(T).forEach(k => { tools[k] = { name: k, enabled: true }; });

  const build = new Function('window', 'localStorage', 'document', 'showStatus',
    'config', 'uploadedFiles', 'tools', 'Divination',
    block + `
    return { divFrameQuality, pushDivinationFrame, accumulateArousalBaseline,
             loadDivinationBaseline, saveDivinationBaseline, resetDivinationBaseline,
             setDivinationMode, updateDivinationBaselineHint, divinationSystemNote,
             divinationProvenanceHTML, divinationProvenanceFromJSON,
             divinationRegimeChips, findDivinationProvenance,
             recordDivinationCast, recordDivinationCastFromJSON,
             baselineSamples: () => divBaseline.samples, DIV_WINDOW, DIV_BASELINE_MIN };`);

  const api = build(win, localStorage, document, showStatus, config, uploadedFiles, tools, D);
  return { api, win, store, localStorage, elements, statuses, config, uploadedFiles, tools };
}

/* ------------------------------------------------------------ frame quality */
console.log('--- Frame quality gate ---');
{
  const { api } = harness();
  const q = (d) => api.divFrameQuality(d);
  const el = (o) => ({ bandpowers: {}, headsetStatus: { electrodes: o } });
  ok(q(el({ TP9: 1, AF7: 1, AF8: 1, TP10: 1 })) === 1, 'four clean contacts = 1.0');
  ok(q(el({ TP9: 1, AF7: 1 })) === 0.5, 'two of four = 0.5 (exactly the default gate)');
  ok(q(el({ TP9: 1 })) === 0.25, 'one of four = 0.25, below the gate');
  ok(q(el({})) === 0, 'no contacts = 0');
  ok(q({ bandpowers: {}, source: 'simulation', headsetStatus: { electrodes: { TP9: 1, AF7: 1, AF8: 1, TP10: 1 } } }) === 0,
     'simulated frames score 0 however good the fake contact looks');
  ok(q({ bandpowers: {}, headsetStatus: { contactQuality: 0.8 } }) === 0.8,
     'falls back to averaged contactQuality when per-electrode is absent');
  ok(q({ bandpowers: {} }) === 1, 'no quality information at all defaults to usable');
  ok(q(null) === 0, 'null frame scores 0');
}

/* --------------------------------------------------- ring buffer + baseline */
console.log('--- Ring buffer and rolling baseline ---');
const frame = (i, bias, quality) => ({
  timestamp: 1000 + i * 100,
  source: 'muse2_bluetooth_real',
  bandpowers: { delta: 10, theta: 20 + 10 * Math.sin(i / 7), alpha: 25 + 10 * Math.cos(i / 5),
                beta: bias * 30 + 8 * Math.sin(i / 3), gamma: bias * 10 },
  metrics: { focus: 0.5, meditation: 0.5 },
  headsetStatus: { electrodes: quality === undefined
    ? { TP9: 1, AF7: 1, AF8: 1, TP10: 1 }
    : { TP9: quality, AF7: quality, AF8: quality, TP10: quality } }
});
{
  const { api, win } = harness();
  for (let i = 0; i < 700; i++) api.pushDivinationFrame(frame(i, 0.5));
  ok(win.eegFrameBuffer.length === 600, 'ring buffer caps at 600 frames (60 s), got ' + win.eegFrameBuffer.length);
  ok(win.eegFrameBuffer[0].t === 1000 + 100 * 100, 'oldest frames are dropped, not the newest');
  const f = win.eegFrameBuffer[0];
  ok(f.bandpowers && f.metrics && typeof f.quality === 'number', 'frames carry bandpowers, metrics and quality');
  ok(f.bandpowers !== undefined && Object.isFrozen(f) === false, 'frame is a plain copy');

  // 700 clean frames / 60 per window = 11 windows.
  ok(api.baselineSamples().length === 11, 'one baseline sample per 6 s window, got ' + api.baselineSamples().length);
  ok(win.getDivinationBaseline() === null, '11 windows is under the 20-window minimum — no personal pivot yet');

  for (let i = 700; i < 1400; i++) api.pushDivinationFrame(frame(i, 0.5));
  const bl = win.getDivinationBaseline();
  ok(bl && bl.samples === 23, 'baseline keeps accumulating, got ' + (bl && bl.samples));
  ok(bl.baseline > 0 && bl.baseline < 1, 'baseline arousal is a fraction, got ' + bl.baseline);
  ok(bl.windowSeconds === 6, 'window length is reported as 6 s');
  // Sanity: the pivot should sit near the arousal of the signal it was measured on.
  const direct = D.median(Array.from({ length: 600 }, (_, i) => D.arousal(frame(i, 0.5))));
  ok(Math.abs(bl.baseline - direct) < 0.05,
     'baseline tracks the signal it was measured on (' + bl.baseline.toFixed(3) + ' vs ' + direct.toFixed(3) + ')');
}

console.log('--- Baseline honesty: dirty signal must not become a baseline ---');
{
  const { api, win } = harness();
  for (let i = 0; i < 600; i++) api.pushDivinationFrame(frame(i, 0.5, 0.25));   // below gate
  ok(api.baselineSamples().length === 0, 'frames below the quality gate never enter the baseline');
  ok(win.getDivinationBaseline() === null, 'no baseline from unusable signal');

  // A single dirty frame must break the window, not be quietly stitched over.
  for (let i = 0; i < 59; i++) api.pushDivinationFrame(frame(i, 0.5));
  api.pushDivinationFrame(frame(59, 0.5, 0.25));
  for (let i = 60; i < 119; i++) api.pushDivinationFrame(frame(i, 0.5));
  ok(api.baselineSamples().length === 0, 'a dropout mid-window discards the partial window');
  for (let i = 119; i < 179; i++) api.pushDivinationFrame(frame(i, 0.5));
  ok(api.baselineSamples().length === 1, 'the next contiguous 6 s does produce a sample');
}

console.log('--- Baseline persistence ---');
{
  const h1 = harness();
  for (let i = 0; i < 1400; i++) h1.api.pushDivinationFrame(frame(i, 0.5));
  h1.api.saveDivinationBaseline(true);
  const raw = h1.store.get('sophiaDivinationBaseline');
  ok(!!raw, 'baseline is written to localStorage');
  const parsed = JSON.parse(raw);
  ok(parsed.v === 1 && Array.isArray(parsed.samples) && parsed.samples.length === 23, 'stored shape is versioned');
  ok(parsed.samples.every(s => s.length === 2), 'each sample is [meanArousal, cv]');

  // A fresh session must pick the same pivot back up.
  const h2 = harness();
  h2.store.set('sophiaDivinationBaseline', raw);
  const reloaded = h2.win.getDivinationBaseline();
  ok(reloaded && reloaded.samples === 23, 'baseline survives a reload');
  ok(reloaded.baseline === h1.win.getDivinationBaseline().baseline, 'reloaded pivot is identical');

  // Corrupt / hostile stores must not break casting. The module warns on the way
  // past, which is correct — muffle it here so it can't read as a test failure.
  const h3 = harness();
  h3.store.set('sophiaDivinationBaseline', '{not json');
  const realWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  const corrupt = h3.win.getDivinationBaseline();
  console.warn = realWarn;
  ok(corrupt === null, 'unparseable store degrades to no baseline');
  ok(warned === 1, 'and says so in the console rather than failing silently');
  const h4 = harness();
  h4.store.set('sophiaDivinationBaseline', JSON.stringify({ v: 1, samples: [[0.2, 0.1], 'junk', [NaN, 1], [0.3]] }));
  ok(h4.win.getDivinationBaseline() === null, 'malformed samples are filtered out');

  h1.api.resetDivinationBaseline();
  ok(h1.win.getDivinationBaseline() === null, 'reset clears the personal baseline');
  ok(JSON.parse(h1.store.get('sophiaDivinationBaseline')).samples.length === 0, 'reset is persisted');
}

/* ---------------------------------------------- the baseline reaches the cast */
console.log('--- Baseline reaches the cast (end to end) ---');
{
  const { api, win } = harness();
  for (let i = 0; i < 1400; i++) api.pushDivinationFrame(frame(i, 0.5));
  // The tools read globals, so mirror the browser: window IS the global object.
  globalThis.eegFrameBuffer = win.eegFrameBuffer;
  globalThis.getDivinationBaseline = win.getDivinationBaseline;
  const cast = T.neural_iching.code({ mode: 'state' }).reading;
  ok(cast.provenance.pivots.source === 'personal-history',
     'a state cast picks up the accumulated personal pivot');
  ok(Math.abs(cast.provenance.pivots.arousal - win.getDivinationBaseline().baseline) < 0.0001,
     'the cast pivots on exactly the stored baseline');
  ok(cast.provenance.framesUsedAfterQualityGate === 360, 'the cast reads the last 360 frames');
  delete globalThis.getDivinationBaseline;
  delete globalThis.eegFrameBuffer;
}

/* -------------------------------------------------------------- mode toggle */
console.log('--- Mode toggle ---');
{
  const { api, win, config, statuses, elements, store } = harness();
  elements.divModeStateBtn = { style: {} };
  elements.divModeCastBtn = { style: {} };
  elements.divModeHint = { textContent: '' };

  api.setDivinationMode('state');
  ok(win.divinationMode === 'state', 'toggle sets the global the module reads');
  ok(config.divinationMode === 'state', 'choice is persisted to config');
  ok(!!store.get('sophiaUnifiedConfig'), 'config is written to localStorage');
  ok(elements.divModeStateBtn.style.background === '#5090d4', 'state button is highlighted');
  ok(elements.divModeCastBtn.style.background === 'transparent', 'cast button is dimmed');
  ok(/NOT a draw/.test(elements.divModeHint.textContent), 'state hint says it is not a draw');
  ok(/Personal baseline still building \(0\/20/.test(elements.divModeHint.textContent),
     'hint reports baseline progress honestly: ' + elements.divModeHint.textContent);
  ok(statuses.length === 1, 'toggling announces itself once');

  api.setDivinationMode('entropy');
  ok(win.divinationMode === 'entropy' && config.divinationMode === 'entropy', 'switches back');
  ok(/yarrow/.test(elements.divModeHint.textContent), 'entropy hint names the odds');
  ok(/provenance, not better randomness/.test(elements.divModeHint.textContent),
     'entropy hint does not oversell the EEG');

  api.setDivinationMode('gibberish');
  ok(win.divinationMode === 'entropy', 'unknown mode falls back to entropy');

  const before = statuses.length;
  api.setDivinationMode('state', true);
  ok(statuses.length === before, 'silent mode does not toast');
  ok(win.divinationMode === 'state', 'silent mode still applies');

  // Once a baseline exists the hint should say so instead of "still building".
  for (let i = 0; i < 1400; i++) api.pushDivinationFrame(frame(i, 0.5));
  api.setDivinationMode('state', true);
  ok(/personal median arousal|your own median arousal/.test(elements.divModeHint.textContent),
     'hint switches to the personal pivot: ' + elements.divModeHint.textContent);
}

/* ------------------------------------------------------- provenance rendering */
console.log('--- Provenance rendering ---');
{
  const { api, win } = harness();
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;

  const result = T.neural_iching.code({ mode: 'entropy' });
  const htmlOut = api.divinationProvenanceHTML(result);
  ok(htmlOut.includes('yarrow draw'), 'rendered line names the cast: ' + htmlOut.slice(0, 120));
  ok(htmlOut.includes(result.reading.provenance.note), 'the module note is shown verbatim');
  ok(api.divinationProvenanceHTML({ success: true }) === '', 'no provenance yields no markup');
  ok(api.divinationProvenanceHTML(null) === '', 'null result is safe');
  ok(api.findDivinationProvenance({ a: { b: { c: { d: { provenance: {} } } } } }) === null,
     'the provenance search is depth-limited');

  // Regime chips use the house colours.
  const walk = T.cube_walk.code({ steps: 6 });
  const chips = api.divinationRegimeChips(walk);
  ok(chips !== '', 'cube walk yields regime chips');
  const colours = ['#d94040', '#d4a050', '#5090d4'];
  ok(colours.some(c => chips.includes(c)), 'chips use the house regime colours: ' + chips.slice(0, 160));
  ok(/\d+ Hz/.test(chips), 'chips carry the frequency');

  // Agentic path: the same line from a JSON string.
  const line = api.divinationProvenanceFromJSON(JSON.stringify(result));
  ok(line === D.provenanceLine(result.reading.provenance), 'JSON path yields the same line');
  ok(api.divinationProvenanceFromJSON('not json') === '', 'unparseable tool output is ignored');
  ok(api.divinationProvenanceFromJSON('') === '', 'empty tool output is ignored');
  ok(api.divinationProvenanceFromJSON(JSON.stringify({ ok: 1 })) === '', 'non-divination tools render nothing');
  delete globalThis.eegFrameBuffer;
}

/* --------------------------------------------------------- line-distribution log */
console.log('--- Line-distribution log ---');
{
  const { api, win, store } = harness();
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;

  ok(win.divinationLineDistribution().casts === 0, 'empty log reports zero casts');
  for (let i = 0; i < 12; i++) api.recordDivinationCast(T.neural_iching.code({ mode: 'entropy' }));
  api.recordDivinationCast(T.neural_iching.code({ mode: 'state' }));
  api.recordDivinationCastFromJSON(JSON.stringify(T.neural_iching.code({ mode: 'state' })));

  const all = win.divinationLineDistribution();
  ok(all.casts === 14, 'every hexagram cast is logged, got ' + all.casts);
  ok(all.lines === 84, 'six lines per cast, got ' + all.lines);
  ok(Object.keys(all.tally).every(k => all.tally[k] >= 0), 'tally covers 6/7/8/9');
  ok(Math.abs(Object.keys(all.percent).reduce((a, k) => a + all.percent[k], 0) - 100) < 0.5,
     'percentages sum to 100');
  ok(win.divinationLineDistribution('state').casts === 2, 'log filters by mode');
  ok(win.divinationLineDistribution('entropy').casts === 12, 'and by the other mode');
  const logged = JSON.parse(store.get('sophiaDivinationCastLog'));
  ok(logged[0].lines.length === 6 && /^[6789]{6}$/.test(logged[0].lines), 'lines stored as six digits');
  ok(logged[13].pivot === 'within-cast-median', 'pivot source is recorded per cast');

  // Non-hexagram results and junk must not pollute the log.
  api.recordDivinationCast(T.tarot_draw.code({ spread: 'three' }));
  api.recordDivinationCast(T.geomancy_cast.code({}));
  api.recordDivinationCast(null);
  api.recordDivinationCastFromJSON('not json');
  ok(win.divinationLineDistribution().casts === 14, 'only hexagram casts are logged');

  // The log is bounded.
  for (let i = 0; i < 200; i++) api.recordDivinationCast(T.neural_iching.code({ mode: 'entropy' }));
  ok(win.divinationLineDistribution().casts === 200, 'log caps at 200 casts, got ' + win.divinationLineDistribution().casts);
  delete globalThis.eegFrameBuffer;
}

/* ---------------------------------------------------------- system-prompt note */
console.log('--- System prompt note ---');
{
  const { api, win, tools } = harness();
  win.divinationMode = 'state';
  const full = api.divinationSystemNote(false);
  ok(full.includes('## Divination toolset'), 'full note has its own heading');
  ok(full.includes('mode "state"') && full.includes('NOT a draw'), 'full note enforces the state distinction');
  ok(full.includes('current casting mode is "state"'), 'full note reports the active mode');
  ok(full.includes('fallbackToCSPRNG'), 'full note explains the fallback flag');
  ok(full.includes('bridge'), 'full note flags the Aetheria bridge as a convention');
  ok(full.includes('no established predictive validity'), 'full note keeps the biorhythm caveat');
  Object.keys(T).forEach(k => ok(full.includes(k), 'full note advertises ' + k));

  const compact = api.divinationSystemNote(true);
  ok(compact.startsWith('\n\n[DIVINATION]'), 'compact note is tagged');
  ok(compact.length < full.length, 'compact note is shorter for tiny local models');
  ok(compact.includes('NOT a random draw'), 'compact note keeps the one thing that matters');

  Object.keys(tools).forEach(k => { tools[k].enabled = false; });
  ok(api.divinationSystemNote(false) === '', 'no note when every divination tool is disabled');
  ok(api.divinationSystemNote(true) === '', 'no compact note either');
  tools.tarot_draw.enabled = true;
  ok(api.divinationSystemNote(true) !== '', 'one enabled tool is enough to warrant the note');
}

/* ------------------------------------------------------------ bibliomancy hook */
console.log('--- Knowledge-base hook ---');
{
  const { api, win, uploadedFiles } = harness();
  ok(win.getBibliomancyChunks().length === 0, 'no files, no chunks');
  uploadedFiles.push({ name: 'grimoire.txt', type: 'text', chunks: ['first passage', '  ', 'second passage'] });
  uploadedFiles.push({ name: 'photo.png', type: 'image' });
  uploadedFiles.push({ name: 'empty.txt', type: 'text' });
  const chunks = win.getBibliomancyChunks();
  ok(chunks.length === 2, 'blank chunks and non-text files are skipped, got ' + chunks.length);
  ok(chunks[0].source === 'grimoire.txt · chunk 1', 'source names the file and chunk');
  ok(chunks[0].text === 'first passage', 'text is carried through');

  globalThis.getBibliomancyChunks = win.getBibliomancyChunks;
  const draw = T.bibliomancy_draw.code({ question: 'speak' });
  ok(draw.draw && !draw.draw.error, 'bibliomancy_draw reads the host knowledge base');
  ok(['first passage', 'second passage'].includes(draw.draw.passage), 'drew a real passage');
  delete globalThis.getBibliomancyChunks;
}

console.log(fail === 0 ? '\nALL HOST TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

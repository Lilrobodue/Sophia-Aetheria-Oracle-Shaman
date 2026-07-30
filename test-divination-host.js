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

/* ------------------------------------------------------- local prompt budget */
console.log('--- Local prompt budget (mobile context overflow) ---');
{
  const bStart = html.indexOf('const estTokens = s =>');
  const bEnd = html.indexOf('// Prepare messages for local model', bStart);
  ok(bStart > 0 && bEnd > bStart, 'the budget helpers were found in index.html');
  const src = html.slice(bStart, bEnd);
  const mk = (ctx, maxTokens, key) => new Function('config', 'LOCAL_MODELS', 'selectedLocalModel', 'console',
    src + '\nreturn { estTokens, localPromptBudget, assembleWithinBudget };')(
      { contextLength: ctx, maxTokens }, { [key || 'k']: {} }, key || 'k', { warn: () => {}, log: () => {} });

  const api = mk(4096, 512, 'agent-lite');
  const b = api.localPromptBudget();
  ok(b.ctx === 4096 && b.reply === 512, 'budget reads the live context and reply size');
  ok(b.forPrompt === 4096 - 512 - 192, 'prompt ceiling = context - reply - margin, got ' + b.forPrompt);
  ok(mk(4096, 99999, 'k').localPromptBudget().forPrompt >= 512, 'a silly maxTokens cannot drive the ceiling to zero');
  ok(mk(0, 0, 'k').localPromptBudget().ctx >= 1024, 'a missing context length falls back, not to zero');

  // Required parts are never dropped; optional ones go from the far end, and the
  // caller is told which — a silently shortened prompt is how this bug hid.
  const asm = api.assembleWithinBudget([
    { label: 'persona', text: 'p'.repeat(4000), required: true },
    { label: 'live sensors', text: 'l'.repeat(400) },
    { label: 'divination note', text: 'd'.repeat(4000) },
    { label: 'memories', text: 'm'.repeat(4000) }
  ], 1100);
  ok(asm.text.includes('p'.repeat(100)), 'a required part survives even over budget');
  ok(asm.text.includes('l'.repeat(100)), 'live sensors outrank the optional prose');
  ok(!asm.text.includes('m'.repeat(100)), 'memories are dropped when they do not fit');
  ok(asm.dropped.length === 2 && /memories/.test(asm.dropped.join()), 'and the drop is reported: ' + asm.dropped.join(', '));
  ok(api.assembleWithinBudget([{ label: 'a', text: '' }], 100).text === '', 'empty parts are skipped');

  // The whole point: the worst realistic case must fit the smallest window.
  const PERSONA = 'x'.repeat(1244), LIVE = 'y'.repeat(337), NOTE = 'z'.repeat(1500), MEM = 'm'.repeat(700);
  for (const [name, ctx, maxTokens] of [['tiny', 4096, 256], ['agent-lite', 4096, 512], ['lite', 8192, 512]]) {
    const a = mk(ctx, maxTokens, name);
    const bb = a.localPromptBudget();
    const sys = a.assembleWithinBudget([
      { label: 'persona', text: PERSONA, required: true },
      { label: 'live sensors', text: LIVE },
      { label: 'divination note', text: NOTE },
      { label: 'memories', text: MEM }
    ], Math.floor(bb.forPrompt * 0.6));
    let used = a.estTokens(sys.text) + a.estTokens('q'.repeat(600));   // + question and tool list
    let kept = 0;
    for (let i = 11; i >= 0; i--) {                                    // 12 prior turns of 2000 chars
      if (kept >= 7) break;
      const t = a.estTokens('h'.repeat(2000));
      if (used + t > bb.forPrompt) break;
      used += t; kept++;
    }
    console.log(`  ${name}: prompt ${used} + reply ${maxTokens} = ${used + maxTokens} / ${ctx} (${kept} turns kept)`);
    ok(used + maxTokens <= ctx, `${name} stays inside its window, got ${used + maxTokens} of ${ctx}`);
    ok(kept >= 3, `${name} still keeps some conversation, got ${kept} turns`);
  }
  // And confirm the old blind rule really did overflow — this is the bug, pinned.
  const oldPrompt = Math.ceil((PERSONA + LIVE + NOTE + MEM).length / 4) + 7 * 500 + 150;
  ok(oldPrompt + 512 > 4096, 'the previous blind 7x2000 history overflowed 4096 by ' + (oldPrompt + 512 - 4096));

  // Call sites: the question must never be dropped, and tools must be capped.
  ok(/if \(question\) trimmed\.push\(question\);/.test(html), 'the question is always sent');
  ok(/const capTokens = local \? Math\.floor\(localPromptBudget\(\)\.forPrompt \* 0\.25\)/.test(html),
     'the tool list is capped for local models');
  ok(/not advertised this turn/.test(html), 'and omitted tools are named, never silently dropped');
}

console.log('--- Generation cap (small-GPU crash guard) ---');
{
  const gStart = html.indexOf('function localGenerationCap(requested)');
  const gEnd = html.indexOf('function updateInferenceBadge', gStart);
  ok(gStart > 0 && gEnd > gStart, 'localGenerationCap found in index.html');
  const mk = (limits, model) => new Function('localInference', 'selectedLocalModel',
    html.slice(gStart, gEnd) + '\nreturn localGenerationCap;')({ gpuLimits: limits }, model);

  const phone = mk({ maxBufferSize: 268435456 }, 'agent-lite');       // 256MB — phone class
  const desktop = mk({ maxBufferSize: 2147483648 }, 'agent-lite');    // 2GB — desktop class
  ok(phone(2048).cap === 384, 'a phone-class GPU is capped to 384 tokens, got ' + phone(2048).cap);
  ok(phone(2048).smallGpu === true, 'and says why');
  ok(phone(128).cap === 128, 'a request below the cap is left alone');
  ok(desktop(2048).cap === 2048, 'a desktop GPU keeps its full budget, got ' + desktop(2048).cap);
  ok(desktop(2048).smallGpu === false, 'and is not flagged small');
  ok(mk({ maxBufferSize: 2147483648 }, 'e4b')(4096).cap === 2048, 'the E4B cap still applies');
  ok(mk(null, 'agent-lite')(1024).cap === 1024, 'unknown limits do not invent a cap');
  ok(mk({ maxBufferSize: 0 }, 'agent-lite')(1024).cap === 1024, 'a zero limit is treated as unknown');
  // The diagnostic line must carry what identifies a generation crash.
  ok(/\[Generate\]/.test(html) && /max_new_tokens/.test(html) && /prompt ≈/.test(html),
     'generation logs model, backend, prompt size and token cap');
  ok(/maxBufferSize=/.test(html), 'and the GPU limits are logged at startup');
  // No lookbehind in code I added — it is a hard parse error on iOS Safari < 16.4,
  // which would take the entire inline script down, not just the feature.
  const clipSrc = html.slice(html.indexOf('const clip = (d) =>'), html.indexOf('const capTokens'));
  ok(!/\(\?<[=!]/.test(clipSrc), 'the tool-description clip uses no lookbehind');
}

console.log('--- Remote error reporting ---');
{
  const dStart = html.indexOf('function describeRemoteError(body)');
  const dEnd = html.indexOf('// ── Remote API streaming', dStart);
  ok(dStart > 0 && dEnd > dStart, 'describeRemoteError found in index.html');
  const describe = new Function(html.slice(dStart, dEnd) + '\nreturn describeRemoteError;')();

  // The exact body LM Studio returned during testing.
  const lm = "'input' is required · invalid_union · input";
  const out = describe(lm);
  console.log('  ' + out.trim());
  ok(/embeddings API/.test(out), 'the embeddings mismatch is named: ' + out);
  ok(/\/v1\/chat\/completions/.test(out), 'and the fix is spelled out');
  ok(/model not loaded/i.test(describe('model not loaded')) || /load the model/.test(describe('model not loaded')),
     'a missing model gets its own hint');
  ok(/context/.test(describe('prompt exceeds context length')), 'a context overflow gets its own hint');
  ok(describe('') === '', 'no body, no noise');
  ok(describe('some unknown failure') === ': some unknown failure', 'unknown errors are passed through verbatim');
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
const { Baseline, BaselineStore } = require('./baseline-core.js');

/* In-memory stand-in for the IndexedDB surface baseline-core and saveMemory use. */
function mockDB() {
  const stores = { neuralBaselines: [], memories: [] };
  const next = { neuralBaselines: 1, memories: 1 };
  const wrap = v => ({ onsuccess: null, onerror: null, result: v });
  const fire = r => { setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; };
  const mk = name => ({
    add(e) { e.id = next[name]++; stores[name].push(e); return fire(wrap(e.id)); },
    getAll() { return fire(wrap([...stores[name]])); },
    count() { return fire(wrap(stores[name].length)); },
    clear() { stores[name].length = 0; return fire(wrap(undefined)); },
    delete(id) { const i = stores[name].findIndex(r => r.id === id); if (i >= 0) stores[name].splice(i, 1); return fire(wrap(undefined)); },
    index(field) { return { getAll(key) { return fire(wrap(stores[name].filter(r => r[field] === key))); } }; }
  });
  return {
    objectStoreNames: { contains: n => n in stores },
    transaction: names => ({ objectStore: n => mk(Array.isArray(names) ? n : (n || names)) }),
    _rows: stores.neuralBaselines,
    _memories: stores.memories
  };
}

function harness(opts) {
  const o = opts || {};
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
  const win = { Divination: D, DIVINATION_TOOLS: T, Baseline, BaselineStore };
  const config = {};
  const uploadedFiles = [];
  const tools = {};
  Object.keys(T).forEach(k => { tools[k] = { name: k, enabled: true }; });
  const db = o.noDB ? null : mockDB();

  // The app's own memory helpers, same call surface as index.html's.
  const saveMemory = async (m) => {
    if (!db) return null;
    const e = Object.assign({ type: 'observation', tags: [], source: 'auto' }, m,
      { timestamp: Date.now(), date: new Date().toLocaleDateString() });
    db._memories.push(Object.assign(e, { id: db._memories.length + 1 }));
    return e.id;
  };
  const getAllMemories = async () => [...db._memories];
  let confirmAnswer = o.confirm !== false;
  const confirm = () => confirmAnswer;

  // Fresh per-harness identity + config so tests can't leak into each other.
  globalThis.eegIntegration = o.eeg || { lastConnectionMethod: 'athena', channelCount: 8 };
  win.eegIntegration = globalThis.eegIntegration;
  Baseline.configure({ binScheme: 'none', minSamplesPooled: 8, minSamplesBinned: 12, windowSize: 40 });
  Baseline._cache = null;

  const build = new Function('window', 'localStorage', 'document', 'showStatus',
    'config', 'uploadedFiles', 'tools', 'Divination', 'db', 'saveMemory',
    'getAllMemories', 'confirm',
    block + `
    return { divFrameQuality, pushDivinationFrame, refreshDivinationBaseline,
             recordCastForBaseline, divWindowStatsFromBuffer, resetDivinationBaseline,
             setDivinationMode, updateDivinationBaselineHint, divinationSystemNote,
             divinationProvenanceHTML, divinationProvenanceFromJSON,
             divinationRegimeChips, findDivinationProvenance,
             recordDivinationCast, recordDivinationCastFromJSON,
             divinationMemoryLine, saveReadingMemory,
             snapshot: () => divBaselineSnapshot, DIV_MIN_QUALITY };`);

  const api = build(win, localStorage, document, showStatus, config, uploadedFiles, tools, D,
    db, saveMemory, getAllMemories, confirm);
  return { api, win, store, localStorage, elements, statuses, config, uploadedFiles, tools, db,
           setConfirm: v => { confirmAnswer = v; } };
}

const settle = () => new Promise(r => setTimeout(r, 5));   // let the mock IDB callbacks fire

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
  ok(win.eegFrameBuffer.every(x => x.quality === 1), 'clean frames score 1');
  // Frames alone must NOT create a baseline — one entry per CAST, not per window,
  // so a headband left on the desk can't manufacture a personal pivot.
  ok(win.getDivinationBaseline() === null, 'streaming frames alone yield no baseline');
  ok(api.snapshot() === null, 'and no snapshot until one is fetched');

  // Six window stats for entropy casts, computed over the same gate.
  const w = api.divWindowStatsFromBuffer();
  ok(Array.isArray(w) && w.length === 6, 'divWindowStatsFromBuffer returns six windows');
  ok(w.every(x => typeof x.mean === 'number' && typeof x.cv === 'number'), 'each window carries mean and cv');
  const direct = D.median(Array.from({ length: 600 }, (_, i) => D.arousal(frame(i, 0.5))));
  ok(Math.abs(D.median(w.map(x => x.mean)) - direct) < 0.05,
     'window means track the signal (' + D.median(w.map(x => x.mean)).toFixed(3) + ' vs ' + direct.toFixed(3) + ')');
}

console.log('--- Dirty signal cannot become a baseline ---');
{
  const { api } = harness();
  for (let i = 0; i < 600; i++) api.pushDivinationFrame(frame(i, 0.5, 0.25));   // below gate
  ok(api.divWindowStatsFromBuffer() === null, 'frames below the quality gate produce no window stats');
  const { api: api2 } = harness();
  for (let i = 0; i < 600; i++) api2.pushDivinationFrame(
    Object.assign(frame(i, 0.5), { source: 'simulation' }));
  ok(api2.divWindowStatsFromBuffer() === null, 'a simulated stream produces no window stats either');
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
  ok(/Personal baseline still building/.test(elements.divModeHint.textContent),
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

/* ══════════════════════════════════════════════════════════════════════════
 * Async: the real baseline store (baseline-core) behind the synchronous seam,
 * and readings becoming memories. Run against a mock IndexedDB.
 * ═════════════════════════════════════════════════════════════════════════ */
(async () => {

console.log('--- Baseline store: one entry per cast, device-keyed ---');
{
  const { api, win, db } = harness();
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;

  await api.refreshDivinationBaseline();
  ok(api.snapshot() && !api.snapshot().ready, 'cold start: snapshot fetched but not ready');
  ok(api.snapshot().deviceId === 'athena' && api.snapshot().montage === 8,
     'identity comes from eegIntegration, got ' + api.snapshot().deviceId + '/' + api.snapshot().montage);
  ok(win.getDivinationBaseline() === null, 'and the sync seam reports no baseline');
  ok(api.snapshot().maturity.needForPooled === 8, 'countdown starts at 8 casts');

  // Eight state casts, recorded the way the app records them.
  for (let k = 0; k < 8; k++) {
    const r = T.neural_iching.code({ mode: 'state' }).reading;
    await api.recordCastForBaseline(r);
    await settle();
  }
  ok(db._rows.length === 8, '8 casts persisted, got ' + db._rows.length);
  ok(db._rows.every(r => r.windowMeans && r.windowMeans.length === 6), 'each entry holds six window means');
  ok(db._rows.every(r => !r.bandpowers && !r.raw_eeg && !r.frames), 'NO raw EEG is persisted');
  ok(db._rows.every(r => r.montage === 8 && r.deviceId === 'athena'), 'entries carry device and montage');
  ok(db._rows.every(r => r.bucket === 'athena|ch8|all'), 'pooled bucket while binning is off, got ' + db._rows[0].bucket);

  await api.refreshDivinationBaseline();
  const bl = win.getDivinationBaseline();
  ok(bl && bl.source === 'device-pooled', 'baseline matures to device-pooled, got ' + (bl && bl.source));
  ok(bl.casts === 8, 'and reports its sample count, got ' + bl.casts);
  ok(bl.baseline > 0 && bl.baseline < 1, 'pivot is a fraction, got ' + bl.baseline);
  ok(bl.cvPivot === null, 'cvPivot is deliberately withheld until real-data calibration');

  // End to end: the cast must actually use it.
  globalThis.getDivinationBaseline = win.getDivinationBaseline;
  const cast = T.neural_iching.code({ mode: 'state' }).reading;
  ok(cast.provenance.pivots.source === 'personal-history', 'a state cast picks up the stored pivot');
  ok(Math.abs(cast.provenance.pivots.arousal - bl.baseline) < 1e-9, 'pivots on exactly the stored baseline');
  ok(cast.provenance.pivots.cvSource === 'within-cast-quantile',
     'while changing lines still come from the within-cast spread');
  ok(D.provenanceLine(cast.provenance).includes('personal arousal pivot · within-cast CV'),
     'and the provenance line says exactly that: ' + D.provenanceLine(cast.provenance));
  ok(cast.relating, 'the relating hexagram survives a matured baseline');

  // Entropy casts feed the baseline too, via recomputed window stats.
  const before = db._rows.length;
  const ent = T.neural_iching.code({ mode: 'entropy' }).reading;
  ok(ent.lineDetail[0].arousal == null, 'entropy casts carry no window stats of their own');
  await api.recordCastForBaseline(ent);
  await settle();
  ok(db._rows.length === before + 1, 'an entropy cast is still recorded');
  ok(db._rows[db._rows.length - 1].windowMeans.length === 6, 'with six recomputed windows');

  delete globalThis.getDivinationBaseline;
  delete globalThis.eegFrameBuffer;
}

console.log('--- A baseline from one headband must not be used on another ---');
{
  const { api, win, db } = harness({ eeg: { lastConnectionMethod: 'athena', channelCount: 8 } });
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;
  for (let k = 0; k < 10; k++) {
    await api.recordCastForBaseline(T.neural_iching.code({ mode: 'state' }).reading);
    await settle();
  }
  await api.refreshDivinationBaseline();
  ok(win.getDivinationBaseline() !== null, 'Athena baseline is ready');

  // Same person, different headband: 4 channels don't scale like 8.
  globalThis.eegIntegration = { lastConnectionMethod: 'muse2', channelCount: 4 };
  win.eegIntegration = globalThis.eegIntegration;
  Baseline._cache = null;
  await api.refreshDivinationBaseline();
  ok(win.getDivinationBaseline() === null, 'the Athena baseline is NOT reused on the Muse 2');
  ok(api.snapshot().montage === 4, 'snapshot follows the new montage');

  // Unknown device: refuse rather than pool under 'unknown'.
  globalThis.eegIntegration = { lastConnectionMethod: 'unknown', channelCount: 0 };
  win.eegIntegration = globalThis.eegIntegration;
  Baseline._cache = null;
  const n = db._rows.length;
  await api.recordCastForBaseline(T.neural_iching.code({ mode: 'state' }).reading);
  await settle();
  ok(db._rows.length === n, 'a cast on an unidentified device is refused, not filed under unknown');
  delete globalThis.eegFrameBuffer;
}

console.log('--- Baseline hint and reset ---');
{
  const { api, win, elements, db } = harness();
  elements.divModeStateBtn = { style: {} };
  elements.divModeCastBtn = { style: {} };
  elements.divModeHint = { textContent: '' };
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;

  await api.refreshDivinationBaseline();
  api.setDivinationMode('state', true);
  ok(/8 more casts on this headband/.test(elements.divModeHint.textContent),
     'hint counts down to a personal baseline: ' + elements.divModeHint.textContent);

  for (let k = 0; k < 8; k++) {
    await api.recordCastForBaseline(T.neural_iching.code({ mode: 'state' }).reading);
    await settle();
  }
  await api.refreshDivinationBaseline();
  api.setDivinationMode('state', true);
  const hint = elements.divModeHint.textContent;
  ok(/your own median arousal/.test(hint), 'hint switches to the personal pivot: ' + hint);
  ok(/8 past casts on athena \(8ch\)/.test(hint), 'and names the device and sample size');
  ok(/Changing lines still come from the spread/.test(hint), 'and does not claim the CV pivot is personal');

  await api.resetDivinationBaseline();
  await settle();
  ok(db._rows.length === 0, 'reset clears the store');
  ok(win.getDivinationBaseline() === null, 'and the seam reports no baseline again');
  delete globalThis.eegFrameBuffer;
}

console.log('--- Readings become memories ---');
{
  const { api, win, db } = harness();
  for (let i = 0; i < 400; i++) api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = win.eegFrameBuffer;

  // Hexagram: the structure her prose would lose.
  const hex = T.neural_iching.code({ mode: 'state', question: 'what needs attention?' });
  const line = api.divinationMemoryLine(hex);
  console.log('  ' + line.content);
  ok(/^I Ching \(state readout\): #\d+ /.test(line.content), 'names the mode and hexagram: ' + line.content);
  ok(/\[[6789]{6}\]/.test(line.content), 'records the six line values');
  ok(/changing line|no changing lines/.test(line.content), 'records the changing lines');
  ok(/asked: "what needs attention\?"/.test(line.content), 'records the question');
  ok(line.tags.includes('iching') && line.tags.includes('state'), 'tagged for recall');

  // Tarot: every card, not just the first Capitalised phrase in her prose.
  const tarot = api.divinationMemoryLine(T.tarot_draw.code({ spread: 'celticCross' }));
  console.log('  ' + tarot.content.slice(0, 110) + '…');
  ok((tarot.content.match(/\|/g) || []).length === 9, 'all ten Celtic Cross cards recorded');
  ok(/Tarot \(celticCross\)/.test(tarot.content), 'names the spread');

  // Runes: the whole cast, not just the first rune.
  const runes = api.divinationMemoryLine(T.rune_cast.code({ spread: 'norn' }));
  console.log('  ' + runes.content);
  ok((runes.content.match(/\|/g) || []).length === 2, 'all three Norn runes recorded');

  // The opt-in tools too.
  ok(/^Geomancy: Judge /.test(api.divinationMemoryLine(T.geomancy_cast.code({})).content), 'geomancy summarised');
  const cube = api.divinationMemoryLine(T.cube_walk.code({ steps: 4 }));
  ok(/^Cube walk: /.test(cube.content), 'cube walk summarised: ' + cube.content);
  // Non-readings write nothing.
  ok(api.divinationMemoryLine(T.hexagram_lookup.code({ number: 34 })) === null, 'a lookup is not a reading');
  ok(api.divinationMemoryLine(T.biorhythm_calc.code({ birthDate: '1985-03-14' })) === null, 'biorhythm is not a reading');
  ok(api.divinationMemoryLine(null) === null && api.divinationMemoryLine({}) === null, 'junk writes nothing');

  // Saving: type, source, and dedupe.
  await api.saveReadingMemory(hex);
  await settle();
  ok(db._memories.length === 1, 'a reading is saved as a memory');
  ok(db._memories[0].type === 'reading', 'filed under type "reading" so getMemoryContext picks it up');
  ok(db._memories[0].source === 'divination', 'marked as coming from the tool, not prose scraping');
  await api.saveReadingMemory(hex);
  await settle();
  ok(db._memories.length === 1, 're-rendering the same reading does not double-file it');
  await api.saveReadingMemory(T.tarot_draw.code({ spread: 'three' }));
  await settle();
  ok(db._memories.length === 2, 'a different reading is filed');

  // recordDivinationCast is the single call site: memory + baseline + log.
  const h2 = harness();
  for (let i = 0; i < 400; i++) h2.api.pushDivinationFrame(frame(i, 0.5));
  globalThis.eegFrameBuffer = h2.win.eegFrameBuffer;
  h2.api.recordDivinationCast(T.neural_iching.code({ mode: 'state' }));
  await settle(); await settle();
  ok(h2.db._memories.length === 1, 'recordDivinationCast files the memory');
  ok(h2.db._rows.length === 1, 'and records the cast for the baseline');
  ok(h2.win.divinationLineDistribution().casts === 1, 'and keeps the line-distribution log');

  // No database yet? Nothing should throw.
  const h3 = harness({ noDB: true });
  h3.api.recordDivinationCast(T.neural_iching.code({ mode: 'entropy' }));
  await settle();
  ok(true, 'with no IndexedDB the cast path still completes');
  delete globalThis.eegFrameBuffer;
}

console.log('--- Memory context must not be drowned by readings ---');
{
  // getMemoryContext caps readings at 4 of the 10 recent slots. Lifted from
  // index.html and run against a store full of readings plus one personal detail.
  const mcStart = html.indexOf('async function selectMemoriesForContext(userMessage)');
  const mcEnd = html.indexOf('// Auto-extract memories from conversation', mcStart);
  ok(mcStart > 0 && mcEnd > mcStart, 'the memory-context functions were found in index.html');
  const all = [];
  for (let i = 0; i < 30; i++) all.push({ id: i + 1, type: 'reading', timestamp: 2000 + i, date: 'd', content: 'I Ching: cast ' + i });
  all.push({ id: 99, type: 'personal', timestamp: 1000, date: 'd', content: "User's name is Joseph" });
  const build = new Function('getAllMemories', html.slice(mcStart, mcEnd) + '\nreturn getMemoryContext;');
  const getMemoryContext = build(async () => all);
  const ctx = await getMemoryContext('what does today hold');
  const readingLines = (ctx.match(/I Ching: cast/g) || []).length;
  console.log(`  context holds ${readingLines} readings out of ${(ctx.match(/^[🃏👁️💜📝📌]/gmu) || []).length} memories`);
  ok(readingLines <= 4, 'readings are capped at 4 recent slots, got ' + readingLines);
  ok(ctx.includes("User's name is Joseph"), 'the personal detail is not evicted by a night of casting');
}

console.log('--- Memories must reach the LOCAL model too ---');
{
  // The local path replaces the system message that carries the verbose memory
  // block, so a reading memory is worthless there unless the compact note is
  // injected. Regression-guard both the function and its call site.
  const cStart = html.indexOf('function getCompactMemoryNote(');
  const cEnd = html.indexOf('// Get recent + relevant memories for context injection', cStart);
  ok(cStart > 0 && cEnd > cStart, 'getCompactMemoryNote found in index.html');
  const getCompactMemoryNote = new Function(html.slice(cStart, cEnd) + '\nreturn getCompactMemoryNote;')();

  const mems = [
    { date: '29/07/2026', type: 'reading', content: 'I Ching (state readout): #22 Grace [987887] · changing line 1 → #52 Keeping Still' },
    { date: '29/07/2026', type: 'personal', content: "User's name is Joseph" }
  ];
  const note = getCompactMemoryNote(mems, 6, 700);
  console.log('  ' + note.trim().split('\n')[0]);
  ok(note.includes('#22 Grace'), 'the reading reaches the compact note');
  ok(note.includes("User's name is Joseph"), 'so do personal details');
  ok(/never list them back/.test(note), 'with an instruction not to recite them');
  ok(getCompactMemoryNote([], 6, 700) === '', 'no memories, no note');
  ok(getCompactMemoryNote(null) === '', 'null is safe');

  // Caps must actually bind — a 1.2B model may only have 4k of context.
  const many = Array.from({ length: 40 }, (_, i) => ({ date: 'd', type: 'reading', content: 'cast number ' + i + ' '.padEnd(200, 'x') }));
  const capped = getCompactMemoryNote(many, 6, 700);
  ok((capped.match(/^- /gm) || []).length <= 6, 'item cap holds, got ' + (capped.match(/^- /gm) || []).length);
  ok(capped.length < 1100, 'char cap holds, got ' + capped.length);
  ok(getCompactMemoryNote(mems, 1, 700).split('\n').filter(l => l.startsWith('- ')).length === 1, 'maxItems is honoured');

  // And the call site: the local prompt must offer it a seat, populated per message.
  ok(/_optional\.push\(\{ label: 'memories', text: _cachedCompactMemories \}\);/.test(html),
     'the local prompt includes the compact memories as a budgeted part');
  ok(/\{ label: 'memories', text: _optional\[1\]\.text \}/.test(html),
     'and it reaches assembleWithinBudget');
  ok(/_cachedCompactMemories = getCompactMemoryNote\(memories, 6, 700\);/.test(html), 'and refreshMemoryContext fills it');
  ok(/_cachedCompactMemories = '';/.test(html), 'and clears it when memory lookup fails');
}

console.log(fail === 0 ? '\nALL HOST TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

})();

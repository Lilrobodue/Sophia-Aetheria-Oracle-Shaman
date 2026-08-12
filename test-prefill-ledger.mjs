/* test-prefill-ledger.mjs — the device's self-measured prefill ceiling.
 *
 * The ROG Phone loses its GPU on a large prefill: ~1885 tokens killed it twice
 * (24.7 s, 25.2 s), while 934 tokens completed after 39.3 s of work. The limit
 * is per-submission duration, and its value belongs to one phone, one driver,
 * one model and one quantisation — so it must be learned, never hard-coded.
 *
 * That makes the ledger's rules load-bearing, and they are easy to get subtly
 * wrong in ways that either lock a healthy device down to nothing or fail to
 * protect a sick one. Extracted from index.html and exercised directly.
 *
 * Plain node, no dependencies:  node test-prefill-ledger.mjs                  */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const from = html.indexOf('const PREFILL_LEDGER_KEY');
const to = html.indexOf('// Assemble the system prompt within a token ceiling');
ok(from > 0 && to > from, 'the ledger block is where the test expects it');
const block = html.slice(from, to);

// Minimal page stubs — everything the block touches and nothing else.
function makeLedger() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const ctx = {
    localStorage,
    selectedLocalModel: 'agent-lite',
    wasm: false,
    config: { contextLength: 16384, maxTokens: 1024 },
    LOCAL_MODELS: { 'agent-lite': {} },
    warnings: [],
    notes: [],
  };
  const factory = new Function('ctx', `
    const localStorage = ctx.localStorage;
    const console = { warn: (m) => ctx.warnings.push(m), log: () => {}, error: () => {} };
    const runtimeDiag = { note: (e, d) => ctx.notes.push({ e, d }) };
    const isWasmMode = () => ctx.wasm;
    let selectedLocalModel = ctx.selectedLocalModel;
    const config = ctx.config;
    const LOCAL_MODELS = ctx.LOCAL_MODELS;
    ${block}
    return { readPrefillLedger, recordPrefillOutcome, measuredPrefillCeiling,
             knownBadPrefill, localPromptBudget, prefillLedgerKey, prefillEvidence,
             setModel: (m) => { selectedLocalModel = m; } };
  `);
  return Object.assign(factory(ctx), { ctx });
}

console.log('--- no evidence must not restrict anyone ---');
{
  const L = makeLedger();
  ok(L.measuredPrefillCeiling() === null, 'a fresh device has no ceiling');
  ok(L.knownBadPrefill() === null, 'and no known-bad size');
  const b = L.localPromptBudget();
  ok(b.forPrompt === 16384 - 1024 - 192, 'the budget is the context window, untouched: ' + b.forPrompt);
  ok(b.measuredCeiling === null, 'and says so');
}

console.log('--- a success alone never lowers the ceiling ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(934, 'ok');
  L.recordPrefillOutcome(1427, 'ok');
  ok(L.measuredPrefillCeiling() === null,
     'without a failure there is nothing to protect against, so no clamp');
  ok(L.localPromptBudget().forPrompt === 15168, 'the budget is still the full window');
}

console.log('--- a failure clamps to the largest size that has actually worked ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(934, 'ok');
  L.recordPrefillOutcome(1427, 'ok');
  L.recordPrefillOutcome(1885, 'fail');
  ok(L.knownBadPrefill() === 1885, 'the failing size is remembered');
  ok(L.measuredPrefillCeiling() === 1427, 'and the ceiling is the largest proven-good, got ' + L.measuredPrefillCeiling());
  const b = L.localPromptBudget();
  ok(b.forPrompt === 1427, 'the prompt budget follows it, got ' + b.forPrompt);
  ok(L.ctx.warnings.some((w) => /clamped/.test(w)), 'and it is not done silently');
}

console.log('--- the ledger keeps the WORST failure and the BEST success ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(1427, 'ok');
  L.recordPrefillOutcome(1885, 'fail');
  L.recordPrefillOutcome(2400, 'fail');
  ok(L.knownBadPrefill() === 1885, 'a larger failure does not raise the known-bad size');
  L.recordPrefillOutcome(1200, 'ok');
  ok(L.measuredPrefillCeiling() === 1427, 'a smaller success does not lower the ceiling');
}

console.log('--- a size that used to work but now kills is no longer evidence ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(1500, 'ok');
  ok(L.measuredPrefillCeiling() === null, 'no failure yet, no clamp');
  L.recordPrefillOutcome(1400, 'fail');
  // maxOk (1500) is now larger than a known failure (1400) — stale optimism.
  ok(L.measuredPrefillCeiling() === null,
     'the stale success is discarded rather than used as a ceiling above a known failure');
  ok(L.knownBadPrefill() === 1400, 'but the failure is still remembered for the warning');
  L.recordPrefillOutcome(900, 'ok');
  ok(L.measuredPrefillCeiling() === 900, 'and a fresh success below it re-establishes a ceiling');
}

console.log('--- the ceiling belongs to a model AND a backend, not to the device ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(1427, 'ok');
  L.recordPrefillOutcome(1885, 'fail');
  ok(L.prefillLedgerKey() === 'agent-lite|webgpu', 'keyed by both, got ' + L.prefillLedgerKey());
  L.ctx.wasm = true;
  ok(L.measuredPrefillCeiling() === null, 'WASM has its own ledger — a GPU driver limit does not apply to it');
  L.ctx.wasm = false;
  L.setModel('agent-pro');
  ok(L.measuredPrefillCeiling() === null, 'and a different model starts its own evidence');
}

console.log('--- contradicted evidence stands down entirely ---');
{
  // Verbatim from batch 3 on the ROG Phone: agent-qwen-mini lost the GPU on a
  // 582-token prompt, then answered a 678-token one. Prompt size is simply not
  // what decides the outcome for that model, so acting on 582 would nag the user
  // about a size that demonstrably works. Better to protect nobody than to be
  // confidently wrong.
  const L = makeLedger();
  L.setModel('agent-qwen-mini');
  L.recordPrefillOutcome(582, 'fail');
  ok(L.knownBadPrefill() === 582, 'before the contradiction, 582 is a real warning');
  L.recordPrefillOutcome(678, 'ok');
  ok(L.prefillEvidence().contradicted === true, 'a larger success contradicts the failure');
  ok(L.measuredPrefillCeiling() === null, 'so nothing is clamped');
  ok(L.knownBadPrefill() === null, 'and nothing is warned about — 678 > 582 proves size is not the cause');
  ok(L.prefillEvidence().minFail === 582, 'the failure is still on the record for diagnostics');
  ok(L.localPromptBudget().forPrompt === 15168, 'the budget goes back to the full window');
}

console.log('--- completed runs are counted (first-ever runs pay for shader compilation) ---');
{
  const L = makeLedger();
  ok(L.prefillEvidence().runs === 0, 'a model that has never run here says so');
  L.recordPrefillOutcome(600, 'ok');
  L.recordPrefillOutcome(700, 'ok');
  ok(L.prefillEvidence().runs === 2, 'completed generations are tallied, got ' + L.prefillEvidence().runs);
  L.recordPrefillOutcome(900, 'fail');
  ok(L.prefillEvidence().runs === 2, 'a failure is not a run — it completed nothing');
}

console.log('--- the clamp can never starve the prompt entirely ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(80, 'ok');
  L.recordPrefillOutcome(100, 'fail');
  ok(L.localPromptBudget().forPrompt === 512, 'a floor of 512 tokens survives even absurd evidence');
}

console.log('--- bad input is ignored rather than recorded ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(0, 'fail');
  L.recordPrefillOutcome(undefined, 'fail');
  L.recordPrefillOutcome(NaN, 'ok');
  ok(L.knownBadPrefill() === null, 'a missing prompt size does not create a phantom limit');
}

console.log(fail === 0 ? '\nALL PREFILL LEDGER TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

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
             predictedPrefillMs, safePrefillMs, timeBasedPrefillCeiling, prefillRisk,
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

console.log('--- time, not tokens: the real ROG Phone numbers ---');
{
  // reason-lite measured its own rate on a run that worked: 949 tokens, first
  // token at 13 998 ms. Then a 1949-token prompt killed the device at 25 881 ms.
  const L = makeLedger();
  L.setModel('reason-lite');
  L.recordPrefillOutcome(949, 'ok', 13998);
  const rate = L.prefillEvidence().msPerToken;
  ok(Math.abs(rate - 14.75) < 0.05, 'the prefill rate is measured from time-to-first-token, got ' + rate.toFixed(2));
  ok(L.safePrefillMs() === null, 'with nothing killed yet there is no limit to aim below');
  ok(L.prefillRisk(1949) === null, 'and therefore nothing to warn about, however large the prompt');

  L.recordPrefillOutcome(1949, 'fail', 25881);
  ok(L.prefillEvidence().killMs === 25881, 'the kill time is recorded, got ' + L.prefillEvidence().killMs);
  // The clamp aims at the longest prefill actually completed (13 998 ms here),
  // not at a fraction of the kill time — measurement over margin.
  ok(L.safePrefillMs() === 13998, 'the clamp aims at the longest prefill that completed, got ' + L.safePrefillMs());

  // Every real run, checked against the prediction.
  const predict = (t) => Math.round(L.predictedPrefillMs(t) / 100) / 10;
  ok(predict(934) === 13.8, '934 tok predicts 13.8 s, got ' + predict(934));
  ok(predict(1519) === 22.4, '1519 tok predicts 22.4 s, got ' + predict(1519));
  ok(predict(1885) === 27.8, '1885 tok predicts 27.8 s, got ' + predict(1885));
  ok(L.prefillRisk(934) === null && L.prefillRisk(1427) === null && L.prefillRisk(1519) === null,
     'every prompt that actually completed is judged safe');
  ok(L.prefillRisk(1885) && L.prefillRisk(1949), 'and both that actually died are judged risky');
  ok(L.timeBasedPrefillCeiling() === 949,
     'the ceiling is where the rate crosses the proven-safe duration, got ' + L.timeBasedPrefillCeiling());
  // The asymmetry is the point: the clamp is cautious because trimming history is
  // cheap, the warning is not because interrupting someone is not.
  ok(L.timeBasedPrefillCeiling() < 1885 && L.prefillRisk(1519) === null,
     'so a prompt between the two thresholds is trimmed toward, but never warned about');
}

console.log('--- the device limit transfers to a model that has never crashed ---');
{
  // The kill threshold clustered at 24.7 / 25.2 / 25.9 s across two different
  // models, so it belongs to the device. A model that has only ever succeeded
  // still gets protected the first time it is handed an oversized prompt —
  // which is the whole point of separating the two measurements.
  const L = makeLedger();
  L.setModel('agent-lite');
  L.recordPrefillOutcome(1519, 'ok', 22400);
  L.recordPrefillOutcome(1885, 'fail', 25249);

  L.setModel('reason-lite');                       // never failed here
  L.recordPrefillOutcome(949, 'ok', 13998);
  ok(L.prefillEvidence().minFail === 0, 'this model has no failure of its own');
  ok(L.prefillEvidence().killMs === 25249, 'but it inherits the device kill time, got ' + L.prefillEvidence().killMs);
  ok(L.prefillRisk(1949) !== null, 'so an oversized prompt is caught on the FIRST attempt, not after a crash');
  ok(L.measuredPrefillCeiling() > 0, 'and the budget is clamped without ever having lost a device');
}

console.log('--- a slower model gets a smaller ceiling from the same device limit ---');
{
  const L = makeLedger();
  L.setModel('agent-lite');
  L.recordPrefillOutcome(1000, 'ok', 14000);       // 14 ms/tok
  L.recordPrefillOutcome(1885, 'fail', 25249);
  const fast = L.timeBasedPrefillCeiling();
  L.setModel('reason-bonsai-8b');
  L.recordPrefillOutcome(500, 'ok', 10000);        // 20 ms/tok — slower per token
  const slow = L.timeBasedPrefillCeiling();
  // Both aim at the same proven-safe duration (14 000 ms, the longest completed
  // on this device), so the ceilings differ purely by how fast each prefills.
  ok(slow < fast, 'the slower model may prefill fewer tokens in the same time: ' + slow + ' vs ' + fast);
  ok(Math.abs(fast / slow - 20 / 14) < 0.05, 'and the ratio tracks the rate, got ' + (fast / slow).toFixed(2));
}

console.log('--- the slowest observed rate is the one that is trusted ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(1000, 'ok', 14000);
  L.recordPrefillOutcome(1000, 'ok', 21000);   // a slower run, perhaps thermally throttled
  ok(L.prefillEvidence().msPerToken === 21, 'the pessimistic rate wins, got ' + L.prefillEvidence().msPerToken);
  L.recordPrefillOutcome(1000, 'ok', 9000);
  ok(L.prefillEvidence().msPerToken === 21,
     'a later fast run does not erase it — predicting a prefill as faster than it has been is what kills a device');
}

console.log('--- no timing, no time-based claims ---');
{
  const L = makeLedger();
  L.recordPrefillOutcome(1427, 'ok');          // legacy records carry no duration
  L.recordPrefillOutcome(1885, 'fail');
  ok(L.prefillEvidence().msPerToken === 0, 'no rate is invented');
  ok(L.predictedPrefillMs(1885) === null, 'and nothing is predicted');
  ok(L.prefillRisk(1885) === null, 'the time-based warning stays silent');
  ok(L.measuredPrefillCeiling() === 1427, 'but the size-based ceiling still works, got ' + L.measuredPrefillCeiling());
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

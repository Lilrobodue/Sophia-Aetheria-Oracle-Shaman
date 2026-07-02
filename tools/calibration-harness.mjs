// calibration-harness.mjs — cross-session calibration for the Transduction Solver.
//
// Ingests a folder of Sophia session + tones-off baseline CSVs, pairs them, and
// runs the transduction model's OWN code (loaded headless from
// transduction-solver.html) to answer the only question that matters:
//
//     Does the model beat the NULL (predict-the-resting-baseline) model,
//     and does that hold on sessions it was NOT tuned on?
//
// THE HONESTY LOCK (why this exists — see the 2026-07-02 finding):
//   1. One session cannot calibrate anything. Calibration needs a DISTRIBUTION.
//   2. Sleep/drowsiness swamps any acoustic effect. Sessions that look sleep-like
//      are FLAGGED and excluded from calibration by default — you can't separate a
//      frequency effect from a slide into delta sleep.
//   3. Config selection (delivery mode, baseline source) is chosen on a TRAIN split
//      and reported on a HELD-OUT TEST split. We never grade on the data we tuned to.
//   4. "Model beats null" is asserted ONLY if it survives on the held-out set.
//      Otherwise the verdict is INSUFFICIENT or DOES-NOT-BEAT-NULL, stated plainly.
//
// This selects among DISCRETE configs (mode × baseline) using the real model — it
// does NOT fit the model's continuous knobs (subScale, neural-peak gains, decay).
// That fitting is a deliberate follow-up once enough clean awake sessions exist;
// the extension point is marked below. Fitting continuous knobs to a handful of
// sessions is the coherence-dominance mistake — don't.
//
// Usage:
//   node tools/calibration-harness.mjs [--dir <folder>] [--holdout 0.4]
//        [--min-clean 4] [--include-confounded] [--mode <name>] [--out report.json]
//   - Sessions: files matching *session*.csv ; baselines: *baseline*.csv
//   - Pairing: each session → the baseline captured nearest its start (±15 min),
//     else the population baseline (flagged).
//
// Pure Node (ESM). No deps. Deterministic (no Math.random / Date.now in logic).

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dir, '..');
const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const MODES = ['headphones', 'bone', 'nearfield', 'fullrange', 'subbass'];
const PAIR_WINDOW_MS = 15 * 60 * 1000;

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { dir: REPO, holdout: 0.4, minClean: 4, includeConfounded: false, mode: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dir') a.dir = argv[++i];
    else if (k === '--holdout') a.holdout = parseFloat(argv[++i]);
    else if (k === '--min-clean') a.minClean = parseInt(argv[++i], 10);
    else if (k === '--include-confounded') a.includeConfounded = true;
    else if (k === '--mode') a.mode = argv[++i];
    else if (k === '--out') a.out = argv[++i];
  }
  return a;
}

// ── math ────────────────────────────────────────────────────────────────────
function pearson(a, b) {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let nu = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return (da > 0 && db > 0) ? nu / Math.sqrt(da * db) : 0;
}
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function norm100(o) { const t = BANDS.reduce((s, b) => s + (o[b] || 0), 0) || 1; const r = {}; BANDS.forEach(b => r[b] = (o[b] || 0) / t * 100); return r; }

// ── load the solver's real code into a headless sandbox ──────────────────────
function makeSolverSandbox() {
  const html = fs.readFileSync(path.join(REPO, 'transduction-solver.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const ctx2d = new Proxy({}, { get: (t, p) => p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (t[p] !== undefined ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true; } });
  const cache = {};
  const makeEl = id => { const el = { id, style: {}, dataset: {}, width: 860, height: 220, textContent: '', innerHTML: '', value: '', classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, getContext: () => ctx2d, setAttribute() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }; el.appendChild = c => { el.innerHTML += (c && c.innerHTML) || ''; return c; }; return el; };
  const document = { getElementById: id => cache[id] || (cache[id] = makeEl(id)), querySelector: () => makeEl('q'), querySelectorAll: () => [], createElement: () => makeEl('c') };
  const sandbox = { document, console: { log() {}, warn() {}, error() {} }, parseFloat, isNaN, Math, JSON, Object, Array, Date };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + `;globalThis.__set=(k,v)=>{if(k==='baselineData')baselineData=v;else if(k==='sophiaData')sophiaData=v;else if(k==='currentMode')currentMode=v;else if(k==='deltaMode')deltaMode=v;};globalThis.__ab=()=>getActiveBaseline();`, sandbox);
  return sandbox;
}

// ── CSV discovery + pairing ──────────────────────────────────────────────────
function firstTimestamp(file) {
  const line = fs.readFileSync(file, 'utf8').split('\n')[1];
  if (!line) return null;
  const t = new Date(line.split(',')[0]).getTime();
  return isNaN(t) ? null : t;
}
function discover(dir) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.csv'));
  const sessions = files.filter(f => /session/i.test(f) && !/baseline/i.test(f)).map(f => path.join(dir, f));
  const baselines = files.filter(f => /baseline/i.test(f)).map(f => ({ file: path.join(dir, f), t: firstTimestamp(path.join(dir, f)) }));
  return { sessions, baselines };
}
function pairBaseline(sessionStart, baselines) {
  let best = null, bestDelta = Infinity;
  for (const b of baselines) {
    if (b.t == null || sessionStart == null) continue;
    const d = Math.abs(b.t - sessionStart);
    if (d < bestDelta) { bestDelta = d; best = b; }
  }
  return (best && bestDelta <= PAIR_WINDOW_MS) ? best : null;
}

// ── confound (sleep-like) heuristic ──────────────────────────────────────────
function assessConfound(session) {
  const ps = session.perSnapshot, k = Math.max(1, Math.floor(ps.length / 3));
  const normDelta = arr => mean(arr.map(r => { const t = r.delta + r.theta + r.alpha + r.beta + r.gamma; return t > 0 ? r.delta / t * 100 : 20; }));
  const early = normDelta(ps.slice(0, k)), late = normDelta(ps.slice(-k));
  const hr = arr => { const v = arr.map(r => r.hr).filter(x => x > 0); return v.length ? mean(v) : null; };
  const hrEarly = hr(ps.slice(0, k)), hrLate = hr(ps.slice(-k));
  const hrDrop = (hrEarly != null && hrLate != null) ? hrEarly - hrLate : 0;
  const deltaRise = late - early;
  const sleepLike = late > 40 || deltaRise > 15 || hrDrop > 15;
  return { sleepLike, lateDelta: +late.toFixed(0), deltaRise: +deltaRise.toFixed(0), hrDrop: +hrDrop.toFixed(0) };
}

// ── score one session under one (mode, baseline) config ──────────────────────
function scoreSession(sb, session, baselineOrNull, mode) {
  sb.__set('sophiaData', session);
  sb.__set('baselineData', baselineOrNull);
  sb.__set('currentMode', mode);
  const actual = BANDS.map(b => session.bandPct[b]);
  const base = norm100(sb.__ab());
  const baseArr = BANDS.map(b => base[b]);
  const freqs = Object.entries(session.freqs).filter(([f]) => f !== '?' && parseFloat(f) > 0).map(([f, c]) => ({ f: parseFloat(f), c }));
  const tot = freqs.reduce((s, x) => s + x.c, 0);
  if (!tot) return null;
  const comp = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
  for (const uf of freqs) { const p = sb.computePredictedEEG(uf.f).predicted; BANDS.forEach(b => comp[b] += p[b] * uf.c / tot); }
  const compArr = BANDS.map(b => norm100(comp)[b]);
  const dPred = compArr.map((x, i) => x - baseArr[i]), dAct = actual.map((x, i) => x - baseArr[i]);
  return {
    corrModel: pearson(compArr, actual),
    corrNull: pearson(baseArr, actual),
    corrDelta: pearson(dPred, dAct),
    beats: pearson(compArr, actual) - pearson(baseArr, actual),
  };
}

// ── aggregate a config over a set of sessions ────────────────────────────────
function aggregate(sb, sessionRecs, mode, baselineSource) {
  const rows = [];
  for (const rec of sessionRecs) {
    const base = baselineSource === 'measured' ? rec.baselineData : null;
    const s = scoreSession(sb, rec.session, base, mode);
    if (s) rows.push(s);
  }
  if (!rows.length) return null;
  return {
    n: rows.length,
    model: mean(rows.map(r => r.corrModel)),
    null: mean(rows.map(r => r.corrNull)),
    delta: mean(rows.map(r => r.corrDelta)),
    deltaSD: sd(rows.map(r => r.corrDelta)),
    beats: mean(rows.map(r => r.beats)),
    beatFrac: rows.filter(r => r.beats > 0).length / rows.length,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const { sessions, baselines } = discover(args.dir);
  console.log(`\nCross-session calibration harness — ${sessions.length} session(s), ${baselines.length} baseline(s) in ${args.dir}\n`);
  if (!sessions.length) { console.log('No *session*.csv files found. Point --dir at your session folder.'); return; }

  const sb = makeSolverSandbox();
  const recs = [];
  for (const file of sessions) {
    let session;
    try { session = sb.parseSessionCSV(fs.readFileSync(file, 'utf8'), path.basename(file)); }
    catch (e) { console.log(`  ! skip ${path.basename(file)} — parse error: ${e.message}`); continue; }
    if (!session || !session.perSnapshot.length) { console.log(`  ! skip ${path.basename(file)} — no rows`); continue; }
    const start = firstTimestamp(file);
    const pair = pairBaseline(start, baselines);
    const baselineData = pair ? sb.parseSessionCSV(fs.readFileSync(pair.file, 'utf8'), path.basename(pair.file)) : null;
    const confound = assessConfound(session);
    recs.push({ file: path.basename(file), start, session, baselineData, baselineFile: pair ? path.basename(pair.file) : null, confound });
  }
  recs.sort((a, b) => (a.start || 0) - (b.start || 0));

  // ── per-session report (default config: best mode by Δ, measured baseline) ──
  console.log('PER-SESSION (Δ-from-baseline correlation, best delivery mode; measured baseline when paired):');
  for (const r of recs) {
    const perMode = MODES.map(m => ({ m, s: scoreSession(sb, r.session, r.baselineData, m) })).filter(x => x.s);
    const best = perMode.sort((a, b) => b.s.corrDelta - a.s.corrDelta)[0];
    const tag = r.confound.sleepLike ? 'SLEEP-LIKE (excluded)' : 'clean';
    const bl = r.baselineFile ? 'measured' : 'POPULATION (no paired baseline)';
    console.log(`  ${r.file}`);
    console.log(`     ${tag} · baseline:${bl} · lateδ ${r.confound.lateDelta}% δ-rise ${r.confound.deltaRise} HR-drop ${r.confound.hrDrop}`);
    if (best) console.log(`     best mode ${best.m}: model ${(best.s.corrModel * 100).toFixed(0)}%  null ${(best.s.corrNull * 100).toFixed(0)}%  Δ ${(best.s.corrDelta * 100).toFixed(0)}%  ${best.s.beats > 0.05 ? 'beats null' : 'no'}`);
  }

  const clean = args.includeConfounded ? recs : recs.filter(r => !r.confound.sleepLike);
  console.log(`\n${clean.length} clean session(s) usable for calibration (min required: ${args.minClean}).`);

  const report = { generated: 'set-by-caller', dir: args.dir, nSessions: recs.length, nClean: clean.length, minClean: args.minClean, sessions: recs.map(r => ({ file: r.file, baseline: r.baselineFile, confound: r.confound })) };

  // ── HONESTY LOCK: only attempt calibration with enough clean sessions ───────
  if (clean.length < args.minClean) {
    report.verdict = 'INSUFFICIENT_DATA';
    console.log(`\n=== VERDICT: INSUFFICIENT DATA ===`);
    console.log(`Need ≥ ${args.minClean} clean (awake, non-sleep-like) sessions to calibrate; have ${clean.length}.`);
    console.log(`Collect more AWAKE sessions (eyes open, stay alert), each with a tones-off baseline`);
    console.log(`captured first, ideally one deliberate frequency/mode per session. Then re-run.`);
    finish(report, args);
    return;
  }

  // ── config selection on TRAIN, reported on held-out TEST ───────────────────
  const nTrain = Math.max(1, Math.round(clean.length * (1 - args.holdout)));
  const train = clean.slice(0, nTrain), test = clean.slice(nTrain);
  const modeList = args.mode ? [args.mode] : MODES;
  const configs = [];
  for (const m of modeList) for (const src of ['measured', 'population']) {
    const tr = aggregate(sb, train, m, src);
    if (tr) configs.push({ mode: m, baseline: src, train: tr });
  }
  configs.sort((a, b) => b.train.delta - a.train.delta);       // pick by TRAIN Δ only
  const best = configs[0];
  const testAgg = test.length ? aggregate(sb, test, best.mode, best.baseline) : null;

  console.log(`\nHeld-out split: ${train.length} train / ${test.length} test.`);
  console.log(`Best config by TRAIN Δ-correlation: mode=${best.mode}, baseline=${best.baseline}  (train Δ ${(best.train.delta * 100).toFixed(0)}%, beats-null ${(best.train.beats * 100).toFixed(0)}%)`);

  report.bestConfig = { mode: best.mode, baseline: best.baseline, train: best.train, test: testAgg };
  report.allConfigsTrain = configs.map(c => ({ mode: c.mode, baseline: c.baseline, ...c.train }));

  if (!testAgg || testAgg.n < 2) {
    report.verdict = 'NEED_MORE_FOR_HOLDOUT';
    console.log(`\n=== VERDICT: NEED MORE FOR HOLD-OUT ===`);
    console.log(`Not enough held-out sessions (${test.length}) to confirm the config generalizes. Collect a few more.`);
  } else if (testAgg.beats > 0.05 && testAgg.delta > 0) {
    report.verdict = 'MODEL_BEATS_NULL';
    console.log(`\n=== VERDICT: MODEL BEATS NULL (held-out) ===`);
    console.log(`Held-out test: model ${(testAgg.model * 100).toFixed(0)}%  null ${(testAgg.null * 100).toFixed(0)}%  Δ ${(testAgg.delta * 100).toFixed(0)}±${(testAgg.deltaSD * 100).toFixed(0)}%  beats-null +${(testAgg.beats * 100).toFixed(0)}% (${(testAgg.beatFrac * 100).toFixed(0)}% of sessions).`);
    console.log(`The transduction model earns weight with config [${best.mode} · ${best.baseline}]. Next: fit continuous knobs (subScale/peaks) on train, re-validate on test.`);
  } else {
    report.verdict = 'DOES_NOT_BEAT_NULL';
    console.log(`\n=== VERDICT: MODEL DOES NOT BEAT NULL (held-out) ===`);
    console.log(`Held-out test: model ${(testAgg.model * 100).toFixed(0)}%  null ${(testAgg.null * 100).toFixed(0)}%  Δ ${(testAgg.delta * 100).toFixed(0)}%  beats-null ${(testAgg.beats * 100).toFixed(0)}%.`);
    console.log(`On clean data the model does not yet outperform "predict the resting baseline." Do NOT trust its absolute`);
    console.log(`predictions; the subharmonic knobs need rethinking, not fine-tuning. The tooling & baseline still stand.`);
  }

  // EXTENSION POINT (deliberately not implemented until data justifies it):
  //   fit continuous knobs — sweep subScale ∈ [5..60], neural-peak gains, decay —
  //   on `train` to maximize Δ-correlation, then report `test`. Requires threading
  //   those params into computePredictedEEG (currently hardcoded). Only do this
  //   once VERDICT is MODEL_BEATS_NULL or clearly promising on ≥ ~6 clean sessions.

  finish(report, args);
}

function finish(report, args) {
  if (args.out) {
    // caller stamps time (Date.now avoided in logic); use ISO from process env-free clock
    report.generated = new Date().toISOString();
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`\nReport written to ${args.out}`);
  }
  console.log('');
}

main();

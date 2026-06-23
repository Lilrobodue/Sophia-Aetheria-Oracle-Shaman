// fnirs_replay.mjs — offline verification of Sophia's fNIRS pace-axis on REAL exports.
//
// Mirrors the FnirsIndex math in index.html (pure functions, kept in sync by hand).
//
// THE TWO-KEY LOCK (per Selah): a PASS requires BOTH
//   key 1 — within-data stability: bootstrap ordering ≥ 90%
//   key 2 — across-block reproducibility: the state ordering holds across SEPARATE
//           blocks (≥2 blocks/state), not just resampling within one.
// Passing one key without the other is NOT a pass. Across-block is the thing that
// burned the EEG score; bootstrap alone is necessary-but-not-sufficient.
//
// Plus a MOTION CHECK as a number: the "STD, SQI-clean" column drops any window in
// which SQI dipped below threshold, and recomputes. If separation survives clean
// windows → the swings are the mind. If it collapses → the head. (Meaningful only in
// per-frame mode; on sparse 30s CSV it coincides with STD.)
//
// Usage:
//   node tools/fnirs_replay.mjs <low...> <mid...> <high...>
//     - .csv (30s centers) or .json (preferred — uses per-frame `fnirsRaw` if present)
//     - STATE label = filename prefix before the first '-' (calm / focused / scattered)
//     - pass MULTIPLE files per state for the across-block key, e.g.
//       node tools/fnirs_replay.mjs calm1.json calm2.json focused1.json focused2.json scattered1.json scattered2.json
//     - state ORDER = order of first appearance = expected low→high arousal

import fs from 'fs';

const SQI_MIN = 0.7;
const INNER = ['LI', 'RI'];
const WINDOW = 20;
const SCATTER_RATIO = 3.0;
const SETTLED_THRESHOLD = 0.35;
const PASS = { spread: 2.0, bootstrap: 0.90 };

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mad = a => { if (a.length < 2) return 0; const m = median(a); return median(a.map(v => Math.abs(v - m))); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const SPREADS = { std, mad };

function splitCsvLine(line) { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

function loadCSV(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = splitCsvLine(lines[0]);
  const samples = lines.slice(1).map(line => {
    const c = splitCsvLine(line); const row = {}; head.forEach((h, i) => row[h] = c[i]); const s = {};
    for (const o of ['LI', 'RI', 'LO', 'RO']) {
      const hbo = parseFloat(row[`fnirs_${o}_hbo`]), sqi = parseFloat(row[`fnirs_${o}_sqi`]);
      if (isFinite(hbo) && isFinite(sqi)) s[o] = { hbo, sqi };
    }
    return Object.keys(s).length ? s : null;
  }).filter(Boolean);
  return { samples, mode: 'sparse(csv 30s)' };
}
function loadJSON(path) {
  const j = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (j.fnirsRaw && Array.isArray(j.fnirsRaw.samples)) {
    const idx = {}; j.fnirsRaw.columns.forEach((c, i) => idx[c] = i);
    const samples = j.fnirsRaw.samples.map(r => {
      const s = {}; for (const o of ['LI', 'RI', 'LO', 'RO']) { const hbo = r[idx[`${o}_hbo`]], sqi = r[idx[`${o}_sqi`]]; if (hbo != null && sqi != null) s[o] = { hbo, sqi }; }
      return Object.keys(s).length ? s : null;
    }).filter(Boolean);
    return { samples, mode: `per-frame (${samples.length} frames)` };
  }
  const samples = (j.timeline || []).map(e => e.fnirs || null).filter(Boolean);
  return { samples, mode: 'sparse(json 30s)' };
}
const load = path => /\.json$/i.test(path) ? loadJSON(path) : loadCSV(path);

// spread of SQI-gated hbo per optode, averaged across optodes.
// sqiClean: drop the WHOLE sample set if it's a window with any sub-threshold SQI
// (handled by the caller via window filtering); here we always per-sample gate.
function indexOf(samples, optodes, spreadFn) {
  const stds = [];
  for (const o of optodes) { const v = samples.filter(s => s[o] && s[o].sqi >= SQI_MIN).map(s => s[o].hbo); if (v.length >= 3) stds.push(spreadFn(v)); }
  return stds.length ? mean(stds) : null;
}
// a window is "SQI-clean" if every sample has all chosen optodes ≥ threshold
function windowClean(win, optodes) { return win.every(s => optodes.every(o => s[o] && s[o].sqi >= SQI_MIN)); }

// session index: sliding-window median (dense) or single (sparse).
// sqiClean drops dipped windows (dense) — the motion check.
function sessionIndex(samples, optodes, spreadFn, sqiClean = false) {
  if (samples.length >= 2 * WINDOW) {
    const wins = [];
    for (let i = 0; i + WINDOW <= samples.length; i++) {
      const w = samples.slice(i, i + WINDOW);
      if (sqiClean && !windowClean(w, optodes)) continue;
      const v = indexOf(w, optodes, spreadFn); if (v != null) wins.push(v);
    }
    return wins.length ? median(wins) : null;
  }
  return indexOf(samples, optodes, spreadFn);
}

// KEY 1 — within-data bootstrap, pooling each state's blocks.
function bootstrap(statesPooled, spreadFn, N = 4000) {
  const dense = statesPooled.every(s => s.samples.length >= 2 * WINDOW);
  let ok = 0, usable = 0;
  for (let n = 0; n < N; n++) {
    const idxs = statesPooled.map(s => {
      if (dense) {
        const wins = []; for (let i = 0; i + WINDOW <= s.samples.length; i++) { const v = indexOf(s.samples.slice(i, i + WINDOW), INNER, spreadFn); if (v != null) wins.push(v); }
        if (!wins.length) return null; const r = []; for (let k = 0; k < wins.length; k++) r.push(wins[(Math.random() * wins.length) | 0]); return median(r);
      } else { const r = []; for (let k = 0; k < s.samples.length; k++) r.push(s.samples[(Math.random() * s.samples.length) | 0]); return indexOf(r, INNER, spreadFn); }
    });
    if (idxs.some(v => v == null)) continue; usable++;
    let mono = true; for (let j = 1; j < idxs.length; j++) if (!(idxs[j] > idxs[j - 1])) { mono = false; break; }
    if (mono) ok++;
  }
  return usable ? ok / usable : null;
}

// ── main ──
const files = process.argv.slice(2);
if (files.length < 2) { console.error('usage: node tools/fnirs_replay.mjs <low...> <mid...> <high...>  (filename prefix = state; ≥2 files/state for the across-block key)'); process.exit(1); }

// group files by state label (prefix before first '-'), preserve first-seen order
const order = []; const groups = {};
for (const f of files) {
  const label = (f.split(/[\\/]/).pop() || f).split('-')[0].replace(/\.(csv|json)$/i, '');
  if (!groups[label]) { groups[label] = []; order.push(label); }
  groups[label].push({ file: f, ...load(f) });
}

console.log('loaded:');
for (const lbl of order) for (const b of groups[lbl]) console.log(`  ${lbl.padEnd(11)} ${b.mode.padEnd(22)} ${b.file.split(/[\\/]/).pop()}`);

// per-state pooled samples (for bootstrap + headline index)
const pooled = order.map(lbl => ({ label: lbl, samples: groups[lbl].flatMap(b => b.samples) }));
const base = sessionIndex(pooled[0].samples, INNER, std);

console.log('\nstate'.padEnd(12), 'STD'.padEnd(12), 'MAD'.padEnd(12), 'STD·SQIclean'.padEnd(14), '×base', ' settled  gate');
for (const st of pooled) {
  const sIdx = sessionIndex(st.samples, INNER, std);
  const mIdx = sessionIndex(st.samples, INNER, mad);
  const cIdx = sessionIndex(st.samples, INNER, std, true);
  const ratio = base ? sIdx / base : NaN, set = clamp((ratio - 1) / (SCATTER_RATIO - 1), 0, 1);
  const e = x => x == null ? 'n/a' : x.toExponential(3);
  console.log(st.label.padEnd(12), e(sIdx).padEnd(12), e(mIdx).padEnd(12), e(cIdx).padEnd(14),
              (base ? ratio.toFixed(2) : 'n/a').padEnd(6), set.toFixed(3).padEnd(8), set <= SETTLED_THRESHOLD ? 'advance' : 'hold');
}

// headline ordering + separation (STD, pooled)
const sIdxs = pooled.map(s => sessionIndex(s.samples, INNER, std));
const ordered = sIdxs.every((v, i) => i === 0 || (v != null && v > sIdxs[i - 1]));
const spread = Math.max(...sIdxs) / Math.min(...sIdxs);
const cIdxs = pooled.map(s => sessionIndex(s.samples, INNER, std, true));
const cleanSpread = (cIdxs.every(v => v != null)) ? Math.max(...cIdxs) / Math.min(...cIdxs) : null;

// KEY 1 — bootstrap
const boot = bootstrap(pooled, std);
// KEY 2 — across-block reproducibility (needs ≥2 blocks/state)
const haveBlocks = order.every(l => groups[l].length >= 2);
let key2 = null, key2detail = '';
if (haveBlocks) {
  // per-block STD index, then require strict separation between adjacent states:
  // max(lower state blocks) < min(higher state blocks)
  const perState = order.map(l => groups[l].map(b => sessionIndex(b.samples, INNER, std)).filter(v => v != null));
  let strict = true;
  for (let i = 1; i < perState.length; i++) { if (!(Math.min(...perState[i]) > Math.max(...perState[i - 1]))) strict = false; }
  key2 = strict;
  key2detail = order.map((l, i) => `${l}[${perState[i].map(v => v.toExponential(2)).join(', ')}]`).join('  ');
} else {
  key2detail = 'insufficient blocks (need ≥2 per state) — run 2–3 blocks each';
}

console.log(`\nordering ${order.join(' < ')}: ${ordered ? 'HOLDS ✓' : 'FAILS ✗'}   separation ${spread.toFixed(2)}×` +
            (cleanSpread != null ? `   (SQI-clean ${cleanSpread.toFixed(2)}×)` : ''));
console.log(`KEY 1  within-data bootstrap : ${boot != null ? (boot * 100).toFixed(1) + '%' : 'n/a'}   ${boot != null && boot >= PASS.bootstrap ? '✓' : '✗'} (need ≥${PASS.bootstrap * 100}%)`);
console.log(`KEY 2  across-block ordering : ${key2 == null ? 'n/a' : key2 ? 'reproduces ✓' : 'does NOT reproduce ✗'}   ${key2detail}`);

const key1pass = ordered && spread >= PASS.spread && boot != null && boot >= PASS.bootstrap;
const verdict = key1pass && key2 === true;
console.log(`\n╞═ VERDICT: ${verdict ? 'PASS ✓✓ (both keys)' : 'NOT YET ✗'} ═╡`);
if (!verdict) {
  const missing = [];
  if (!ordered) missing.push('ordering fails');
  if (!(spread >= PASS.spread)) missing.push(`separation <${PASS.spread}×`);
  if (!(boot != null && boot >= PASS.bootstrap)) missing.push('key1 bootstrap <90%');
  if (key2 !== true) missing.push(key2 == null ? 'key2 needs ≥2 blocks/state' : 'key2 ordering not reproduced across blocks');
  console.log('   missing: ' + missing.join(' · '));
}
if (cleanSpread != null) console.log(`   motion check: STD ${spread.toFixed(2)}× vs SQI-clean ${cleanSpread.toFixed(2)}× — ${cleanSpread >= spread * 0.8 ? 'survives clean windows (mind) ✓' : 'collapses without dips (head?) ✗'}`);
console.log('\nNOTE: sparse .csv (~15 pts) makes KEY 1 fragile and KEY 2 impossible by construction.');
console.log('Real verdict needs .json exports WITH fnirsRaw, 2–3 blocks per state, same length & posture.');

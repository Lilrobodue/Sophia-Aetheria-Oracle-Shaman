const { BaselineMath: M, BaselineStore: S, Baseline: B } = require('./baseline-core.js');
const { Divination: D } = require('./divination-core.js');
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

console.log('--- pure math ---');
ok(M.median([3,1,2]) === 2, 'median odd');
ok(M.median([4,1,2,3]) === 2.5, 'median even');
ok(M.median([]) === null, 'median empty is null not 0');
ok(M.iqr([1,2,3,4,5,6,7,8,9]) === 4, 'iqr, got ' + M.iqr([1,2,3,4,5,6,7,8,9]));
ok(M.a12([1,2,3],[1,2,3]) === 0.5, 'identical samples A12 = 0.5');
ok(M.a12([5,6,7],[1,2,3]) === 1, 'fully separated A12 = 1');
ok(M.a12([],[1]) === null, 'A12 empty is null');

console.log('--- time binning ---');
const at = h => new Date(2026, 6, 29, h, 0, 0).getTime();
ok(M.timeBinFor(at(3), 'quarter') === '00-06', '3am -> 00-06');
ok(M.timeBinFor(at(13), 'quarter') === '12-18', '1pm -> 12-18');
ok(M.timeBinFor(at(23), 'quarter') === '18-00', '11pm -> 18-00 wraps');
ok(M.timeBinFor(at(13), 'none') === 'all', 'none scheme pools');
// Custom boundaries for a vampire schedule: wake 16:00
const vamp = { boundaries: [16, 22, 4, 10] };
ok(M.timeBinFor(at(17), vamp) === '16-22', 'custom scheme, 5pm -> 16-22');
ok(M.timeBinFor(at(5), vamp) === '04-10', 'custom scheme, 5am -> 04-10');
console.log('  vampire bins for 17:00/23:00/05:00/11:00 =',
  [17,23,5,11].map(h => M.timeBinFor(at(h), vamp)).join(' '));

console.log('--- bucket keying (montage must be part of the key) ---');
ok(M.bucketKey('athena', 8, '00-06') !== M.bucketKey('athena', 4, '00-06'),
   'same device, different montage = different bucket');
ok(M.bucketKey('athena', 8, '00-06') !== M.bucketKey('muse2', 8, '00-06'), 'device separates');

console.log('--- summarizeWindows ---');
const win = (m, c) => ({ mean: m, cv: c });
const six = [win(.10,.10), win(.14,.12), win(.16,.20), win(.12,.11), win(.20,.30), win(.13,.13)];
const sum = M.summarizeWindows(six, { deviceId:'athena', montage:8, timeBin:'00-06', framesUsed:118, meanQuality:0.88 });
ok(sum.castArousal === 0.135, 'castArousal is median of window means, got ' + sum.castArousal);
ok(sum.windowMeans.length === 6 && sum.windowCVs.length === 6, 'six of each retained');
ok(sum.bucket === 'athena|ch8|00-06', 'bucket built, got ' + sum.bucket);
ok(M.summarizeWindows([win(1,1)], {}).error, 'fewer than six windows rejected');
ok(!('bandpowers' in sum) && !('frames' in sum), 'no raw EEG in the stored entry');

console.log('--- baseline selection & fallback ladder ---');
const mkEntries = (n, opts) => Array.from({length:n}, (_, i) => {
  const o = Object.assign({ deviceId:'athena', montage:8, timeBin:'00-06', base:0.15, spread:0.02 }, opts);
  return { timestamp: 1e12 + i * 86400000, deviceId:o.deviceId, montage:o.montage, timeBin:o.timeBin,
    castArousal: o.base + ((i % 5) - 2) * o.spread, castCV: 0.12 + ((i % 3) - 1) * 0.01 };
});
const cold = M.selectBaseline([], { deviceId:'athena', montage:8, timeBin:'00-06' });
ok(cold.ready === false && cold.source === 'insufficient', 'cold start is not ready');
ok(cold.maturity.needForPooled === 8, 'cold start reports 8 casts needed');
ok(cold.note.includes('within-cast median'), 'cold start note explains the fallback');

const few = M.selectBaseline(mkEntries(9), { deviceId:'athena', montage:8, timeBin:'00-06' });
ok(few.ready && few.source === 'device-pooled', '9 casts -> pooled baseline, got ' + few.source);
ok(few.maturity.needForBinned === 3, 'reports 3 more for a binned baseline');

const many = M.selectBaseline(mkEntries(30), { deviceId:'athena', montage:8, timeBin:'00-06' });
ok(many.source === 'device+bin', '30 casts in bin -> binned baseline, got ' + many.source);
ok(Math.abs(many.baseline - 0.15) < 0.01, 'baseline near the true centre, got ' + many.baseline);
ok(many.spread.arousalIQR > 0, 'spread reported');

// Cross-device contamination is the bug this must never have
const mixed = mkEntries(20).concat(mkEntries(20, { deviceId:'muse2', montage:4, base:0.45 }));
const clean = M.selectBaseline(mixed, { deviceId:'athena', montage:8, timeBin:'00-06' });
ok(Math.abs(clean.baseline - 0.15) < 0.01, 'muse2 entries excluded, got ' + clean.baseline);
ok(clean.nSameDevice === 20, 'only same-device counted, got ' + clean.nSameDevice);
const montageMix = mkEntries(20).concat(mkEntries(20, { deviceId:'athena', montage:4, base:0.45 }));
const clean2 = M.selectBaseline(montageMix, { deviceId:'athena', montage:8, timeBin:'00-06' });
ok(Math.abs(clean2.baseline - 0.15) < 0.01, 'same device different montage excluded, got ' + clean2.baseline);

// Bounded rolling window must track drift, not average it away
const drifting = mkEntries(20, { base:0.15 }).concat(
  mkEntries(60, { base:0.30 }).map((e, i) => ({ ...e, timestamp: 1e12 + (20 + i) * 86400000 })));
const tracked = M.selectBaseline(drifting, { deviceId:'athena', montage:8, timeBin:'00-06', windowSize:40 });
ok(Math.abs(tracked.baseline - 0.30) < 0.02, 'rolling window follows drift, got ' + tracked.baseline);
ok(tracked.n === 40, 'window bounded at 40, got ' + tracked.n);

console.log('--- drift detection ---');
const noDrift = M.driftReport(mkEntries(40));
ok(noDrift.ready && !noDrift.flagged, 'stable history not flagged');
const yesDrift = M.driftReport(mkEntries(20, { base:0.15 }).concat(
  mkEntries(10, { base:0.40 }).map((e, i) => ({ ...e, timestamp: 1e12 + (100 + i) * 86400000 }))));
ok(yesDrift.flagged, 'shifted history flagged');
ok(yesDrift.direction === 'more activated', 'direction correct');
ok(yesDrift.note.includes('Nothing has been reset'), 'drift note promises no auto-action');
ok(M.driftReport(mkEntries(5)).ready === false, 'thin history reports not-ready, not a false negative');
console.log('  drift shift:', yesDrift.shiftInIQRs, 'IQRs | separation A12:', yesDrift.separation);

console.log('--- does time of day matter? ---');
const sameEverywhere = mkEntries(20, { timeBin:'00-06', base:0.15 })
  .concat(mkEntries(20, { timeBin:'12-18', base:0.15 }).map((e,i) => ({...e, timestamp: 2e12 + i*8.64e7})));
const rep1 = M.binReport(sameEverywhere);
ok(rep1.verdict === 'pooling-fine', 'identical bins -> pool, got ' + rep1.verdict);
const differs = mkEntries(20, { timeBin:'00-06', base:0.12 })
  .concat(mkEntries(20, { timeBin:'12-18', base:0.28 }).map((e,i) => ({...e, timestamp: 2e12 + i*8.64e7})));
const rep2 = M.binReport(differs);
ok(rep2.verdict === 'bin-worthwhile', 'separated bins -> bin, got ' + rep2.verdict);
ok(M.binReport(mkEntries(4)).verdict === 'insufficient', 'thin data -> insufficient');
console.log('  pooled case A12:', rep1.pairs.map(p=>p.a12).join(','),
            '| separated case A12:', rep2.pairs.map(p=>p.a12).join(','));

console.log('--- glue layer against a mock IndexedDB ---');
/* Minimal in-memory stand-in exercising the same call surface as the adapter. */
function mockDB() {
  const rows = []; let next = 1;
  const wrap = v => ({ onsuccess:null, onerror:null, result:v });
  const fire = r => { setTimeout(() => r.onsuccess && r.onsuccess(), 0); return r; };
  const store = {
    add(e) { e.id = next++; rows.push(e); return fire(wrap(e.id)); },
    getAll() { return fire(wrap([...rows])); },
    count() { return fire(wrap(rows.length)); },
    clear() { rows.length = 0; return fire(wrap(undefined)); },
    delete(id) { const i = rows.findIndex(r => r.id === id); if (i >= 0) rows.splice(i,1); return fire(wrap(undefined)); },
    index(name) { return { getAll(key) { return fire(wrap(rows.filter(r => r[name] === key))); } }; }
  };
  return { objectStoreNames: { contains: n => n === 'neuralBaselines' },
           transaction: () => ({ objectStore: () => store }), _rows: rows };
}

(async () => {
  const db = mockDB();
  ok(S.available(db), 'adapter sees the store');

  globalThis.eegIntegration = { lastConnectionMethod:'athena', channelCount:8 };
  B.configure({ binScheme:'none', minSamplesPooled:8, minSamplesBinned:12 });

  const cold2 = await B.getBaselineFor(db);
  ok(!cold2.ready && cold2.deviceId === 'athena' && cold2.montage === 8, 'identity derived from eegIntegration');

  // Feed real window stats out of divination-core so the two modules are wired for real
  const frames = Array.from({length:120}, (_, i) => ({ quality:0.9, bandpowers:{
    delta:45+8*Math.sin(i/9), theta:22+6*Math.cos(i/6), alpha:18+7*Math.sin(i/4),
    beta:11+4*Math.sin(i/3), gamma:4+2*Math.cos(i/2) }}));
  for (let k = 0; k < 12; k++) {
    const cast = D.castIChing({ mode:'state', frames: frames.slice(k).concat(frames) });
    const windows = cast.lineDetail.map(l => ({ mean:l.arousal, cv:l.cv }));
    const r = await B.recordCast(db, windows, { framesUsed:120, meanQuality:0.9 });
    ok(r.recorded, 'cast ' + k + ' recorded: ' + (r.reason || ''));
  }
  ok(db._rows.length === 12, '12 entries persisted, got ' + db._rows.length);
  ok(db._rows.every(r => r.windowMeans && !r.bandpowers), 'persisted entries hold scalars only');

  const warm = await B.getBaselineFor(db);
  ok(warm.ready && warm.source === 'device-pooled', 'baseline matured, got ' + warm.source);
  console.log('  matured baseline:', warm.baseline, 'CV:', warm.baselineCV, '| n =', warm.n);

  // The whole point: hand it back to castIChing and confirm it is actually used
  const withBase = D.castIChing({ mode:'state', frames, baseline: warm.baseline, baselineCV: warm.baselineCV });
  ok(withBase.provenance.pivots.source === 'personal-history', 'cast used the personal pivot');
  const withoutBase = D.castIChing({ mode:'state', frames });
  ok(withoutBase.provenance.pivots.source === 'within-cast-median', 'cold cast reports the fallback pivot');
  console.log('  with baseline: ', withBase.lines.join(''), '->', withBase.primary.num, withBase.primary.english);
  console.log('  without:       ', withoutBase.lines.join(''), '->', withoutBase.primary.num, withoutBase.primary.english);

  // Quality gate and unknown-device guard
  const bad = await B.recordCast(db, six, { meanQuality:0.3 });
  ok(!bad.recorded && bad.reason.includes('below record threshold'), 'poor signal refused');
  globalThis.eegIntegration = { lastConnectionMethod:'unknown', channelCount:0 };
  B._cache = null;
  const anon = await B.recordCast(db, six, { meanQuality:0.9 });
  ok(!anon.recorded && anon.reason.includes('unknown montage'), 'unidentified device refused');
  globalThis.eegIntegration = { lastConnectionMethod:'athena', channelCount:8 };
  B._cache = null;

  const st = await B.status(db);
  ok(typeof st.provenanceLine === 'string' && st.provenanceLine.length > 5, 'provenance line renders');
  console.log('  provenance line:', st.provenanceLine);

  const json = JSON.parse(await B.exportJSON(db));
  ok(json.count === db._rows.length && json.schema === 1, 'export well formed');
  const cleared = await B.reset(db);
  ok(cleared.cleared >= 0 && db._rows.length === 0, 'reset wipes');

  console.log(fail === 0 ? '\nALL TESTS PASSED' : `\n${fail} FAILURE(S)`);
  process.exit(fail ? 1 : 0);
})();

const { Divination: D, DIVINATION_TOOLS: T } = require('./divination-core.js');
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

console.log('--- 64 hexagram table ---');
ok(D.HEXAGRAMS.length === 64, 'expected 64 hexagrams');
const bits = new Set(D.HEXAGRAMS.map(h => h.bits));
ok(bits.size === 64, 'all 64 line-patterns distinct, got ' + bits.size);
ok(D.HEXAGRAMS.every(h => h.lower && h.upper), 'every hexagram resolves both trigrams');
ok(D.HEXAGRAMS.every(h => /^[01]{6}$/.test(h.bits)), 'bit strings well formed');

// King Wen pairing law: hex(2k) = invert(hex(2k-1)); if palindromic, complement instead.
let pairErrors = [];
for (let k = 1; k <= 32; k++) {
  const a = D.byNum(2 * k - 1), b = D.byNum(2 * k);
  const inv = D.invert(a.bits);
  const expected = (inv === a.bits) ? D.complement(a.bits) : inv;
  if (b.bits !== expected) pairErrors.push(`${a.num}/${b.num}: got ${b.bits} expected ${expected}`);
}
ok(pairErrors.length === 0, 'King Wen pairing law violations:\n    ' + pairErrors.join('\n    '));

// Palindromic hexagrams should be exactly 1,27,29,61 (paired by complement)
const pal = D.HEXAGRAMS.filter(h => D.invert(h.bits) === h.bits).map(h => h.num);
console.log('  self-inverting hexagrams:', pal.join(', '));
ok(JSON.stringify(pal) === JSON.stringify([1,2,27,28,29,30,61,62]), 'unexpected palindrome set');

// Nuclear operation must always land on a real hexagram
ok(D.HEXAGRAMS.every(h => D.byBits(D.nuclear(h.bits))), 'nuclear always resolves');
ok(D.byBits(D.nuclear('111111')).num === 1, 'nuclear of 1 is 1');
ok(D.byBits(D.nuclear('000000')).num === 2, 'nuclear of 2 is 2');

// Spot-check trigram images against known descriptions
const img = n => D.hexSummary(D.byNum(n)).image;
console.log('  11 =', img(11), '| 29 =', img(29), '| 63 =', img(63), '| 44 =', img(44));
ok(img(11) === 'Earth over Heaven', 'hex 11 Peace = Earth over Heaven');
ok(img(12) === 'Heaven over Earth', 'hex 12 Standstill = Heaven over Earth');
ok(img(63) === 'Water over Fire', 'hex 63 After Completion = Water over Fire');
ok(img(64) === 'Fire over Water', 'hex 64 Before Completion = Fire over Water');
ok(img(50) === 'Fire over Wind', 'hex 50 Caldron = Fire over Wind');
ok(img(48) === 'Water over Wind', 'hex 48 Well = Water over Wind');

console.log('--- Aetheria bridge (all 64 reachable) ---');
// Mimic the app's AETHERIA_FREQUENCIES for the 27 mapped hexagrams
const MAPPED = [[1,174,8],[2,285,22],[3,396,51],[4,417,53],[5,528,2],[6,639,24],[7,741,30],
  [8,852,52],[9,963,61],[10,1206,29],[11,1449,4],[12,1692,34],[13,1935,20],[14,2178,11],
  [15,2421,23],[16,2664,50],[17,2907,49],[18,3150,46],[19,3504,21],[20,3858,48],[21,4212,58]]
  .map(([pos,freq,hex]) => ({pos,freq,hex,regime:pos<10?'GUT':pos<19?'HEART':'HEAD',keyword:'k'+pos}));
const dists = {};
for (let n = 1; n <= 64; n++) {
  const r = D.aetheriaForHexagram(n, MAPPED);
  ok(r.positions.length > 0, 'hexagram ' + n + ' has no bridge');
  dists[r.distance] = (dists[r.distance] || 0) + 1;
}
console.log('  bridge distance histogram:', dists);

console.log('--- I Ching casting ---');
const mkFrames = (n, bias) => Array.from({length:n}, (_, i) => ({
  t: i, quality: 0.9,
  bandpowers: { delta:10, theta:20+10*Math.sin(i/7), alpha:25+10*Math.cos(i/5),
                beta: bias*30 + 8*Math.sin(i/3), gamma: bias*10 },
  metrics: { focus:0.5, meditation:0.5 }
}));
const stateCast = D.castIChing({ mode:'state', frames: mkFrames(120, 1.0), question:'test' });
ok(stateCast.primary && stateCast.primary.num >= 1, 'state cast produced a hexagram');
ok(stateCast.provenance.mode === 'state', 'state mode preserved');
ok(stateCast.lines.every(v => [6,7,8,9].includes(v)), 'line values valid');
console.log('  state cast:', stateCast.lines.join(''), '->', stateCast.primary.num,
            stateCast.primary.english, '| changing:', stateCast.changingLines.join(',') || 'none');

const entCast = D.castIChing({ mode:'entropy', method:'yarrow', frames: mkFrames(120, 0.4) });
ok(entCast.provenance.eegBitsUsed > 0, 'entropy mode consumed EEG bits');
console.log('  entropy cast:', entCast.lines.join(''), '->', entCast.primary.num, entCast.primary.english);

const noEEG = D.castIChing({ mode:'state', frames: [] });
ok(noEEG.provenance.fallbackToCSPRNG === true, 'fallback flagged when no EEG');
ok(noEEG.provenance.mode === 'entropy', 'state request downgrades to entropy honestly');

// Relating hexagram must differ from primary iff there are changing lines
const many = Array.from({length:200}, () => D.castIChing({ mode:'entropy', frames: mkFrames(60, 0.6) }));
ok(many.every(r => (r.changingLines.length === 0) === (r.relating === null)),
   'relating hexagram present exactly when lines change');
ok(many.every(r => r.changingLines.length === 0 || r.relating.num !== r.primary.num),
   'relating differs from primary');
// yarrow odds sanity
const tally = {6:0,7:0,8:0,9:0};
many.forEach(r => r.lines.forEach(v => tally[v]++));
const tot = 200*6;
console.log('  yarrow line tally (expect ~6.3/31.3/43.8/18.8%):',
  Object.entries(tally).map(([k,v]) => k+':'+(100*v/tot).toFixed(1)+'%').join(' '));

console.log('--- Geomancy ---');
const geoKeys = new Set(D.GEOMANTIC_FIGURES.map(f => f.slice(1).join('')));
ok(geoKeys.size === 16, 'all 16 geomantic figures distinct, got ' + geoKeys.size);
ok(new Set(D.GEOMANTIC_FIGURES.map(f => f[0])).size === 16, 'all 16 names distinct');
let unresolved = 0, invalid = 0;
for (let i = 0; i < 300; i++) {
  const c = D.castGeomancy({ frames: mkFrames(40, 0.5) });
  const all = [...c.mothers, ...c.daughters, ...c.nieces, c.witnesses.right, c.witnesses.left,
               c.judge, c.reconciler];
  if (all.some(f => f.name === 'UNRESOLVED')) unresolved++;
  if (!c.valid) invalid++;
}
ok(unresolved === 0, 'unresolved geomantic figures: ' + unresolved);
ok(invalid === 0, 'invalid judges (odd points): ' + invalid);
const chart = D.castGeomancy({ frames: mkFrames(40, 0.5), question:'q' });
console.log('  judge:', chart.judge.name, '| witnesses:', chart.witnesses.right.name, '/',
            chart.witnesses.left.name, '| valid:', chart.valid);

console.log('--- Tarot ---');
ok(D.buildDeck().length === 78, 'deck is 78 cards, got ' + D.buildDeck().length);
ok(new Set(D.buildDeck().map(c => c.id)).size === 78, 'all card ids unique');
const cc = D.drawTarot({ spread:'celticCross', frames: mkFrames(20, 0.5) });
ok(cc.cards.length === 10, 'celtic cross draws 10');
ok(new Set(cc.cards.map(c => c.id)).size === 10, 'no duplicate cards drawn');
console.log('  celtic cross first three:', cc.cards.slice(0,3)
  .map(c => c.name + (c.reversed ? ' (rev)' : '')).join(' | '));

console.log('--- Runes ---');
ok(D.ELDER_FUTHARK_FULL.length === 24, 'Elder Futhark is 24 runes');
const nonRev = D.ELDER_FUTHARK_FULL.filter(r => !r[3]).map(r => r[0]);
console.log('  non-reversible (no merkstave):', nonRev.join(', '), `[${nonRev.length}]`);
// Settled against published sources — pinned so it can't drift back.
ok(JSON.stringify(nonRev) === JSON.stringify(
     ['Gebo','Hagalaz','Isa','Jera','Eihwaz','Sowilo','Ingwaz','Dagaz']),
   'the eight symmetric runes are exactly the consensus set, got ' + nonRev.join(', '));
const wyrd = D.castRunes({ spread:'single', includeWyrd:true, frames: [] });
ok(D.ELDER_FUTHARK_FULL.every(r => r[0] !== 'Wyrd'), 'Wyrd is not one of the 24');
ok(D.castRunes({ spread:'norn', includeWyrd:true }).provenance.bagSize === 25, 'Wyrd makes 25 in the bag');
ok(D.castRunes({ spread:'norn', includeWyrd:false }).provenance.bagSize === 24, 'and can be left out');
const rc = D.castRunes({ spread:'cross', frames: mkFrames(20, 0.5) });
ok(rc.runes.length === 5, 'cross spread draws 5');
ok(new Set(rc.runes.map(r => r.name)).size === 5, 'no duplicate runes');
ok(rc.runes.every(r => r.reversible || r.merkstave === false), 'symmetric runes never merkstave');

console.log('--- Biorhythm ---');
const bio = D.biorhythm('1985-03-14', '2026-07-29');
ok(bio.daysAlive > 15000, 'days alive computed');
ok(Object.keys(bio.cycles).length === 6, 'six cycles');
ok(bio.note.includes('no established predictive validity'), 'honesty note present');

console.log('--- Cube walk ---');
for (let i = 0; i < 200; i++) {
  const w = D.cubeWalk({ frames: mkFrames(30, i/200), steps:4,
    freqTable: MAPPED.concat(Array.from({length:6},(_,j)=>({pos:22+j,freq:4566+j*354,regime:'HEAD',keyword:'k'}))) });
  ok(w.path.every(p => p >= 1 && p <= 27), 'cube path stays in 1..27: ' + w.path);
  ok(w.path.length === 5, 'walk length = steps + 1');
}
const w = D.cubeWalk({ frames: mkFrames(30, 0.5), steps:3, freqTable: MAPPED });
console.log('  path:', w.path.join(' -> '), '| centre crossed:', w.passedCentre);

console.log('--- Tool registry ---');
ok(Object.keys(T).length === 8, '8 tools exported, got ' + Object.keys(T).length);
Object.entries(T).forEach(([k, t]) => {
  ok(t.name === k, 'tool key matches name: ' + k);
  ok(typeof t.code === 'function', 'tool has code fn: ' + k);
  ok(typeof t.description === 'string' && t.description.length > 30, 'tool described: ' + k);
  ok(t.default === true, 'tool is a default (reloads from the module each session): ' + k);
});
// Enabled-by-default is a prompt-budget decision, not a preference: every enabled
// tool is described to the model on every turn. The four daily traditions ship on,
// the four specialist ones ship opt-in.
const onByDefault = Object.keys(T).filter(k => T[k].enabled).sort();
const optIn = Object.keys(T).filter(k => !T[k].enabled).sort();
console.log('  on by default:', onByDefault.join(', '));
console.log('  opt-in:', optIn.join(', '));
ok(JSON.stringify(onByDefault) === JSON.stringify(['hexagram_lookup','neural_iching','rune_cast','tarot_draw']),
   'expected default-on set, got ' + onByDefault.join(', '));
ok(JSON.stringify(optIn) === JSON.stringify(['bibliomancy_draw','biorhythm_calc','cube_walk','geomancy_cast']),
   'expected opt-in set, got ' + optIn.join(', '));
// An opt-in tool must still work the moment it is switched on.
ok(T.geomancy_cast.code({}).success, 'opt-in tools run when enabled');
globalThis.eegFrameBuffer = mkFrames(120, 0.7);
const r1 = T.neural_iching.code({ mode:'state', question:'does the buffer wire up?' });
ok(r1.success && r1.reading.primary, 'neural_iching tool works off global buffer');
ok(T.hexagram_lookup.code({ number:64 }).hexagram.english === 'Before Completion', 'lookup by number');
ok(T.hexagram_lookup.code({ bits:'111111' }).hexagram.num === 1, 'lookup by bits');
ok(T.hexagram_lookup.code({ number:99 }).error, 'bad lookup errors cleanly');
ok(T.geomancy_cast.code({}).success, 'geomancy tool works');
ok(T.tarot_draw.code({ spread:'horseshoe' }).reading.cards.length === 7, 'horseshoe = 7 cards');
ok(T.rune_cast.code({}).success, 'rune tool works');
ok(T.biorhythm_calc.code({ birthDate:'1985-03-14' }).success, 'biorhythm tool works');
ok(T.cube_walk.code({}).success, 'cube walk tool works');
ok(T.bibliomancy_draw.code({}).draw.error, 'bibliomancy errors cleanly with empty store');

console.log('--- Host seams (mode toggle, personal baseline, KB hook) ---');
// The UI toggle parks the user's choice on globalThis.divinationMode; an explicit
// tool param must still win, and anything unrecognised falls back to entropy.
globalThis.eegFrameBuffer = mkFrames(240, 0.9);
globalThis.divinationMode = 'state';
ok(T.neural_iching.code({}).reading.provenance.requestedMode === 'state', 'toggle sets the default mode');
ok(T.neural_iching.code({ mode:'entropy' }).reading.provenance.requestedMode === 'entropy',
   'explicit mode param overrides the toggle');
globalThis.divinationMode = 'nonsense';
ok(T.neural_iching.code({}).reading.provenance.requestedMode === 'entropy', 'unknown mode falls back to entropy');
globalThis.divinationMode = 'state';

// Personal pivot: the host supplies one through getDivinationBaseline().
delete globalThis.getDivinationBaseline;
ok(T.neural_iching.code({}).reading.provenance.pivots.source === 'within-cast-median',
   'cold start pivots on within-cast medians');
globalThis.getDivinationBaseline = () => ({ baseline: 0.15, baselineCV: 0.08, samples: 40 });
const personal = T.neural_iching.code({}).reading;
ok(personal.provenance.pivots.source === 'personal-history', 'host baseline is used when offered');
ok(personal.provenance.pivots.arousal === 0.15, 'personal pivot is the baseline value, got ' + personal.provenance.pivots.arousal);
globalThis.getDivinationBaseline = () => { throw new Error('store on fire'); };
ok(T.neural_iching.code({}).reading.provenance.pivots.source === 'within-cast-median',
   'a throwing baseline provider degrades to cold start instead of failing the cast');
delete globalThis.getDivinationBaseline;

// A baseline pivot must actually move the lines, or it is decoration.
const hotFrames = mkFrames(180, 1.0);
const lowPivot  = D.castIChing({ mode:'state', frames: hotFrames, baseline: 0.05, cvPivot: 0.5 });
const highPivot = D.castIChing({ mode:'state', frames: hotFrames, baseline: 0.95, cvPivot: 0.5 });
ok(lowPivot.lines.every(v => v === 7 || v === 9), 'below a low pivot every line reads yang');
ok(highPivot.lines.every(v => v === 6 || v === 8), 'below a high pivot every line reads yin');

console.log('--- CV pivot: quantile, not multiplier ---');
// An explicit cvPivot is an ABSOLUTE threshold, used as given.
const explicit = D.castIChing({ mode:'state', frames: hotFrames, baseline: 0.2, cvPivot: 0.077 });
ok(explicit.provenance.pivots.cv === 0.077, 'cvPivot is used verbatim, got ' + explicit.provenance.pivots.cv);
ok(explicit.provenance.pivots.cvSource === 'personal-quantile', 'and labelled as the personal quantile');
// The legacy multiplier path still works but is labelled, so it can be spotted.
const legacy = D.castIChing({ mode:'state', frames: hotFrames, baseline: 0.2, baselineCV: 0.05 });
ok(Math.abs(legacy.provenance.pivots.cv - 0.075) < 1e-9, 'baselineCV keeps the 1.5x legacy behaviour');
ok(legacy.provenance.pivots.cvSource === 'baseline-multiplier', 'and is labelled as the multiplier');
// cvPivot wins when both arrive, so a host passing both can't silently re-multiply.
const both = D.castIChing({ mode:'state', frames: hotFrames, baseline: 0.2, baselineCV: 0.05, cvPivot: 0.2 });
ok(both.provenance.pivots.cv === 0.2, 'cvPivot beats baselineCV, got ' + both.provenance.pivots.cv);
// The seam must never forward both — that is how the multiplier crept back in.
globalThis.getDivinationBaseline = () => ({ baseline: 0.15, baselineCV: 0.05, cvPivot: 0.18 });
globalThis.eegFrameBuffer = mkFrames(240, 0.9);
ok(T.neural_iching.code({ mode:'state' }).reading.provenance.pivots.cv === 0.18,
   'the tool seam prefers cvPivot over baselineCV');
delete globalThis.getDivinationBaseline;

// Cold start is DETERMINISTIC, and knowing why matters: quantile(6 values, 0.75)
// is the 5th smallest, so exactly one window sits above it. Every cold-start cast
// has exactly one changing line. Documented here so it reads as a known property
// rather than a surprise in the field.
const coldCasts = Array.from({ length: 50 }, (_, i) =>
  D.castIChing({ mode:'state', frames: mkFrames(180, 0.3 + i / 100) }));
ok(coldCasts.every(c => c.provenance.pivots.cvSource === 'within-cast-quantile'), 'cold start uses the within-cast quantile');
ok(coldCasts.every(c => c.changingLines.length === 1),
   'cold start yields exactly one changing line every time (see the CV PIVOT note)');
ok(coldCasts.every(c => c.relating), 'so a relating hexagram always exists at cold start');

// Bibliomancy reads whatever chunk store the host installs.
globalThis.getBibliomancyChunks = () => [{ source:'notes.txt · chunk 1', text:'the passage' }];
const biblio = T.bibliomancy_draw.code({ question:'what should I read?' });
ok(biblio.draw.passage === 'the passage', 'bibliomancy reads the host chunk hook');
ok(biblio.draw.source === 'notes.txt · chunk 1', 'chunk source is carried through');
globalThis.getBibliomancyChunks = () => { throw new Error('no store'); };
ok(T.bibliomancy_draw.code({}).draw.error, 'a throwing chunk hook errors cleanly');
delete globalThis.getBibliomancyChunks;

console.log('--- Provenance line ---');
const stateProv = T.neural_iching.code({ mode:'state' }).reading.provenance;
const stateLine = D.provenanceLine(stateProv);
console.log('  state:', stateLine);
ok(/^state readout · \d+ frames · (personal baseline|personal arousal pivot · within-cast CV|within-cast median)$/.test(stateLine),
   'state provenance line well formed: ' + stateLine);
// The mixed case must not be described as a full personal baseline.
globalThis.getDivinationBaseline = () => ({ baseline: 0.15, cvPivot: null });
const mixed = D.provenanceLine(T.neural_iching.code({ mode:'state' }).reading.provenance);
console.log('  personal arousal only:', mixed);
ok(mixed.includes('personal arousal pivot · within-cast CV'),
   'a personal arousal pivot with within-cast CV says so: ' + mixed);
globalThis.getDivinationBaseline = () => ({ baseline: 0.15, cvPivot: 0.18 });
ok(D.provenanceLine(T.neural_iching.code({ mode:'state' }).reading.provenance).includes('personal baseline'),
   'both pivots personal reads as personal baseline');
delete globalThis.getDivinationBaseline;
globalThis.eegFrameBuffer = [];
const coldLine = D.provenanceLine(T.neural_iching.code({ mode:'state' }).reading.provenance);
console.log('  no headband:', coldLine);
ok(coldLine.includes('headband not connected'), 'fallback is stated, not hidden: ' + coldLine);
ok(D.provenanceLine(T.neural_iching.code({ mode:'entropy', method:'coin' }).reading.provenance)
   .startsWith('coin draw'), 'entropy line names the method');
// Frames present but all below the quality gate — a different failure, said differently.
globalThis.eegFrameBuffer = mkFrames(120, 0.9).map(f => ({ ...f, quality: 0.1 }));
const gatedLine = D.provenanceLine(T.neural_iching.code({ mode:'state' }).reading.provenance);
console.log('  below gate:', gatedLine);
ok(gatedLine.includes('all 120 frames below the quality gate'),
   'quality-gate fallback is distinguished from a missing headband: ' + gatedLine);
// A few clean frames, but under the 12-frame minimum: a third, distinct message.
globalThis.eegFrameBuffer = mkFrames(120, 0.9).map((f, i) => ({ ...f, quality: i < 5 ? 0.9 : 0.1 }));
const thinLine = D.provenanceLine(T.neural_iching.code({ mode:'state' }).reading.provenance);
console.log('  too few clean:', thinLine);
ok(thinLine.includes('just 5 of 120 frames passed'), 'thin-signal fallback is stated: ' + thinLine);
globalThis.eegFrameBuffer = mkFrames(120, 0.9);
ok(D.provenanceLine(T.geomancy_cast.code({}).chart.provenance).startsWith('EEG-seeded draw'),
   'geomancy line labelled');
ok(D.provenanceLine(T.cube_walk.code({}).walk.provenance).startsWith('EEG-steered walk'),
   'cube walk line labelled');
ok(D.provenanceLine(null) === '', 'no provenance yields no line');

// Simulated frames are scored 0 by the host, so they can never pass as a readout.
globalThis.eegFrameBuffer = mkFrames(120, 0.9).map(f => ({ ...f, quality: 0, simulated: true }));
ok(T.neural_iching.code({ mode:'state' }).reading.provenance.fallbackToCSPRNG === true,
   'simulated stream cannot produce a state readout');
globalThis.eegFrameBuffer = mkFrames(120, 0.9);

console.log(fail === 0 ? '\nALL TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

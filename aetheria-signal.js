/*
 * aetheria-signal.js — Aetheria Calibration & Signal Provenance
 * ------------------------------------------------------------------
 * A framework-agnostic, drop-in module for every app that reads a Muse or a
 * Polar H10. Two jobs:
 *
 *   1. calibrate()     — a pre-session GATE that judges whether a connection is
 *                        trustworthy and tells the user the one thing to fix.
 *                        Pure read: it judges, it NEVER alters the stream.
 *
 *   2. makeProcessor() — a during-session EXTRACT-AND-DISCLOSE layer that pulls
 *                        real signal out of imperfect contact and stamps exactly
 *                        how much was clean vs. salvaged. Raw passes through
 *                        untouched in parallel, always.
 *
 * THE LINE THAT MUST NEVER BE CROSSED
 *   We compensate for bad conditions. We never invent data. The test, encoded
 *   as a rule for every technique here:
 *
 *     If the sensor fell completely off the body, would this technique still
 *     produce output? If YES -> it is manufacturing -> it is not in this file.
 *     If it produces NOTHING when there is nothing, and only recovers signal
 *     genuinely present -> honest extraction -> keep it.
 *
 *   Honest extraction sees THROUGH noise to real signal (notch, artifact
 *   rejection, picking clean channels, bridging a gap short enough to truly
 *   bridge). Manufacturing PAINTS OVER absence (smoothing a flatline into a
 *   pulse, filling a 30 s dropout with plausible beats). Every extractor below
 *   passes the strap-off test; each one is annotated with how.
 *
 * FACTS IN THE APP, MEANING IN THE TAGGER
 *   This module records facts (gate result, fractions, provenance). It assigns
 *   NO confidence weight and NO verdict. The Tagger reads `calibration` and
 *   `signalProvenance` and does the interpreting.
 *
 * Pure, dependency-free, no UI. Exposes window.AetheriaSignal (and
 * module.exports under CommonJS). Blocks drop straight into the app export
 * schemas next to `signals` (aetheria.shared_listening.v1), Sophia, the game.
 *
 * Build brief by Selah (Claude, Anthropic) w/ Joseph & Alisha Lewis, 2026.
 */
(function (global) {
  'use strict';

  // ─── VERSIONS ────────────────────────────────────────────────────────────
  // Bump these when the bar changes so a pass today stays comparable later.
  var CALIB_VERSION = 'aetheria.calib.v1';
  var PROV_VERSION  = 'aetheria.prov.v1';

  var MUSE_LABELS = ['TP9', 'AF7', 'AF8', 'TP10'];

  // ─── CONSERVATIVE DEFAULT THRESHOLDS ─────────────────────────────────────
  // Start conservative and LOG METRICS EVEN ON FAIL. After real sessions
  // accumulate, set the pass bar from the actual distribution of the data —
  // don't hand-pick numbers that feel rigorous and aren't. Every threshold is
  // overridable via opts.thresholds and is echoed back in CalibrationResult.
  var MUSE_THRESHOLDS = {
    flatStdUv:        0.6,    // std below this on a channel => flat / no contact (uV)
    railFraction:     0.02,   // >2% of samples at saturation => railed channel
    saturationUv:     900,    // |sample| at/above this counts as railed (uV)
    minGoodChannels:  2,      // need at least this many contacting sensors to pass
    cmrrRatioMax:     4.0,    // common-mode/per-ch variance above this => reference degraded
    mainsRelMax:      6.0     // line power / neighbour power above this => mains too high to pass
    ,
    slopeMin:        -4.0,    // 1/f log-log slope must sit within [slopeMin, slopeMax]
    slopeMax:        -0.25,
    ampSaneMinUv:     1.0,    // plausible EEG RMS band (uV)
    ampSaneMaxUv:     150,
    decodeRmsUv:      1500    // RMS above this is not EEG — the Muse-2 12-bit decode bug. HARD FAIL.
  };

  var POLAR_THRESHOLDS = {
    rrMinMs:          273,    // ~220 bpm ceiling
    rrMaxMs:          2000,   // ~30 bpm floor
    maxJumpFrac:      0.33,   // beat-to-beat change beyond this = contact glitch, not a real beat
    minValidBeats:    8,      // need at least this many plausible R-R in the window to pass
    minValidFraction: 0.6     // and at least this fraction of beats plausible
  };

  var PROC_DEFAULTS = {
    windowSec:        1.0,    // provenance is scored per this-many-seconds window
    // EEG artifact detection (per-window, on the CLEANED-of-mains signal)
    blinkUv:          75,     // frontal (AF7/AF8) low-freq deflection above this = blink
    emgBandPowerMul:  3.0,    // >20 Hz power this-many-x the resting median = jaw/EMG burst
    motionG:          0.08,   // accel magnitude deviation (g) above this = movement
    notchQ:           30,     // notch sharpness
    notchRemoveFrac:  0.05,   // >5% window power removed by notch => window counts as "recovered"
    // Provenance tiers
    salvageFloor:     0.5,    // rawFraction below this => tier "salvage"
    cleanFloor:       0.9,    // rawFraction at/above this (and no salvage) => tier "clean"
    // Polar R-R
    interpCapMs:      2000,   // bridge gaps up to this long; BEYOND -> mark gap, never fill
    ectopicFrac:      0.20    // R-R deviating this-much from local median = ectopic
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  SHARED MATH — pure, dependency-free
  // ═══════════════════════════════════════════════════════════════════════

  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function variance(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0, i;
    for (i = 0; i < a.length; i++) { var d = a[i] - m; s += d * d; }
    return s / (a.length - 1);
  }
  function std(a) { return Math.sqrt(variance(a)); }
  function rms(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(a.length ? s / a.length : 0); }
  function median(a) {
    if (!a.length) return 0;
    var b = a.slice().sort(function (x, y) { return x - y; });
    var m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  // Column extractor: samples is [[ch0,ch1,...], ...]; pull one channel.
  function column(samples, c) {
    var out = new Array(samples.length), i;
    for (i = 0; i < samples.length; i++) out[i] = samples[i][c];
    return out;
  }

  function nextPow2AtMost(n) { var p = 1; while (p * 2 <= n) p *= 2; return p; }

  // Iterative radix-2 Cooley-Tukey FFT (in-place, complex). re/im length = pow2.
  function fft(re, im) {
    var n = re.length, i, j = 0, k, m;
    for (i = 0; i < n - 1; i++) {
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
      k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (m = 0; m < len / 2; m++) {
          var a = i + m, b = i + m + len / 2;
          var xr = re[b] * cr - im[b] * ci;
          var xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // One-sided power spectral density of a real signal, Hann-windowed.
  // Returns { freqs, power } over bins 0..N/2. Uses the largest pow2 <= len.
  function psd(signal, fs) {
    var N = nextPow2AtMost(signal.length);
    if (N < 8) return { freqs: [], power: [] };
    var seg = signal.slice(signal.length - N); // most recent N samples
    var re = new Array(N), im = new Array(N), i;
    var winPow = 0;
    for (i = 0; i < N; i++) {
      var w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1))); // Hann
      re[i] = seg[i] * w; im[i] = 0; winPow += w * w;
    }
    fft(re, im);
    var half = N >> 1;
    var freqs = new Array(half + 1), power = new Array(half + 1);
    var norm = 1 / (fs * winPow);
    for (i = 0; i <= half; i++) {
      var p = (re[i] * re[i] + im[i] * im[i]) * norm;
      if (i > 0 && i < half) p *= 2; // one-sided
      freqs[i] = i * fs / N;
      power[i] = p;
    }
    return { freqs: freqs, power: power };
  }

  // Integrate PSD power over [lo, hi) Hz.
  function bandPower(spec, lo, hi) {
    var s = 0, i;
    for (i = 0; i < spec.freqs.length; i++) {
      var f = spec.freqs[i];
      if (f >= lo && f < hi) s += spec.power[i];
    }
    return s;
  }

  // Power right at f0 (nearest bin +/-1) relative to neighbouring bins — a
  // clean line-noise tell independent of overall amplitude.
  function linePowerRatio(spec, f0) {
    if (!spec.freqs.length) return 0;
    var df = spec.freqs[1] - spec.freqs[0] || 1;
    var k = Math.round(f0 / df);
    if (k <= 1 || k >= spec.freqs.length - 2) return 0;
    var atLine = spec.power[k] + spec.power[k - 1] + spec.power[k + 1];
    // neighbours a few bins away, avoiding the line skirt
    var span = Math.max(2, Math.round(3 / df));
    var neigh = [], i;
    for (i = k - span - 2; i <= k + span + 2; i++) {
      if (i < 0 || i >= spec.power.length) continue;
      if (Math.abs(i - k) <= 1) continue;
      neigh.push(spec.power[i]);
    }
    var base = median(neigh) * 3 || 1e-12;
    return atLine / base;
  }

  // Least-squares slope of log10(power) vs log10(freq) over [lo,hi] — the 1/f fit.
  function spectralSlope(spec, lo, hi) {
    var xs = [], ys = [], i;
    for (i = 0; i < spec.freqs.length; i++) {
      var f = spec.freqs[i];
      if (f >= lo && f <= hi && spec.power[i] > 0) { xs.push(Math.log10(f)); ys.push(Math.log10(spec.power[i])); }
    }
    if (xs.length < 4) return NaN;
    var mx = mean(xs), my = mean(ys), num = 0, den = 0;
    for (i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    return den === 0 ? NaN : num / den;
  }

  // RBJ notch biquad — coefficients for a band-stop at f0 with quality Q.
  function notchCoeffs(f0, fs, Q) {
    var w0 = 2 * Math.PI * f0 / fs;
    var cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw / (2 * Q);
    var b0 = 1, b1 = -2 * cw, b2 = 1;
    var a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function makeBiquadState() { return { x1: 0, x2: 0, y1: 0, y2: 0 }; }
  function biquad(c, s, x) {
    var y = c.b0 * x + c.b1 * s.x1 + c.b2 * s.x2 - c.a1 * s.y1 - c.a2 * s.y2;
    s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
    return y;
  }

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // ═══════════════════════════════════════════════════════════════════════
  //  PART A — THE GATE (calibration at connect)
  //  Pure read over a short check window. It judges; it never alters anything.
  // ═══════════════════════════════════════════════════════════════════════

  function calibrate(sensor, window, opts) {
    opts = opts || {};
    if (sensor === 'polar_h10') return calibratePolar(window, opts);
    return calibrateMuse(window, opts);
  }

  function calibrateMuse(window, opts) {
    var T = mergeThresholds(MUSE_THRESHOLDS, opts.thresholds);
    var fs = window.fs || opts.fs || 256;
    var channels = window.channels || opts.channels || MUSE_LABELS;
    var samples = window.samples || [];
    var reasons = [];
    var metrics = {};
    var perSensor = {};

    // Guard: nothing to judge.
    if (!samples.length) {
      return {
        passed: false, calibVersion: CALIB_VERSION, thresholds: T, metrics: { nSamples: 0 },
        perSensor: {}, baseline: {}, reasons: ['no samples in check window'],
        fixes: ['Confirm the headband is connected and streaming, then re-run the check.']
      };
    }

    metrics.nSamples = samples.length;
    metrics.windowSec = samples.length / fs;

    // ── Per-sensor contact: empty/flat or railed => that sensor fails. ──
    var goodChannels = 0;
    var chSignals = [];
    for (var c = 0; c < channels.length; c++) {
      var sig = column(samples, c);
      chSignals.push(sig);
      var s = std(sig);
      var railed = 0, i;
      for (i = 0; i < sig.length; i++) if (Math.abs(sig[i]) >= T.saturationUv) railed++;
      var railFrac = railed / sig.length;
      var flat = s < T.flatStdUv;
      var isRailed = railFrac > T.railFraction;
      var contact = !flat && !isRailed;
      // quality 0..1 from how comfortably std sits in a plausible EEG band.
      var q = contact ? clamp01((s - T.flatStdUv) / 20) : 0;
      var reason;
      if (flat) reason = 'flat / no contact';
      else if (isRailed) reason = 'railed / saturated';
      perSensor[channels[c]] = { contact: contact, quality: +q.toFixed(3), reason: reason };
      if (contact) goodChannels++;
      metrics['std_' + channels[c]] = +s.toFixed(2);
    }
    metrics.goodChannels = goodChannels;
    if (goodChannels < T.minGoodChannels) {
      reasons.push('only ' + goodChannels + ' of ' + channels.length + ' sensors contacting');
    }
    for (var ci = 0; ci < channels.length; ci++) {
      if (!perSensor[channels[ci]].contact) reasons.push(channels[ci] + ' ' + perSensor[channels[ci]].reason);
    }

    // ── Reference / CMRR integrity (center forehead, Fpz). ──
    // We never receive Fpz as a channel, so CMRR is ESTIMATED: when the
    // reference is good, differential EEG across sensors is largely
    // independent and the cross-channel average partially cancels. When the
    // reference degrades, a large common-mode component rides every channel in
    // lock-step, so var(average) balloons relative to mean per-channel var.
    // This is an estimate and is labelled as such — the Tagger treats it so.
    var cmrrRatio = NaN;
    if (goodChannels >= 2) {
      var n = samples.length, avg = new Array(n), perChVar = [], k;
      for (k = 0; k < n; k++) {
        var sum = 0, cnt = 0;
        for (c = 0; c < channels.length; c++) {
          if (perSensor[channels[c]].contact) { sum += samples[k][c]; cnt++; }
        }
        avg[k] = cnt ? sum / cnt : 0;
      }
      for (c = 0; c < channels.length; c++) if (perSensor[channels[c]].contact) perChVar.push(variance(chSignals[c]));
      var meanChVar = mean(perChVar) || 1e-12;
      cmrrRatio = variance(avg) / meanChVar;
    }
    metrics.cmrrRatio = isNaN(cmrrRatio) ? null : +cmrrRatio.toFixed(3);
    var cmrrIntact = !(cmrrRatio > T.cmrrRatioMax);
    metrics.cmrrIntact = cmrrIntact ? 1 : 0;
    if (!cmrrIntact) reasons.push('reference/CMRR degraded (common-mode not rejected — reseat center forehead)');

    // ── Line noise (50/60 Hz) with region auto-detect. ──
    // Judge on the best-contacting channel's spectrum.
    var refIdx = 0, bestStd = -1;
    for (c = 0; c < channels.length; c++) {
      if (perSensor[channels[c]].contact && metrics['std_' + channels[c]] > bestStd) { bestStd = metrics['std_' + channels[c]]; refIdx = c; }
    }
    var spec = psd(chSignals[refIdx], fs);
    var r50 = linePowerRatio(spec, 50), r60 = linePowerRatio(spec, 60);
    var mainsHz = opts.mainsHz && opts.mainsHz !== 'auto' ? opts.mainsHz : (r60 >= r50 ? 60 : 50);
    var mainsRel = mainsHz === 60 ? r60 : r50;
    metrics.mainsHz = mainsHz;
    metrics.mainsRel = +mainsRel.toFixed(2);
    metrics.line50Rel = +r50.toFixed(2);
    metrics.line60Rel = +r60.toFixed(2);
    if (mainsRel > T.mainsRelMax) {
      reasons.push('mains noise high at ' + mainsHz + ' Hz (biggest contact-quality tell — reseat / add water)');
    }

    // ── EEG-likeness + Muse-2 decode-bug guard. ──
    var refRms = rms(chSignals[refIdx]);
    metrics.rmsUv = +refRms.toFixed(2);
    var decodeBug = refRms > T.decodeRmsUv;
    metrics.decodeBugSuspected = decodeBug ? 1 : 0;
    var slope = spectralSlope(spec, 2, 40);
    metrics.spectralSlope = isNaN(slope) ? null : +slope.toFixed(3);
    var ampSane = refRms >= T.ampSaneMinUv && refRms <= T.ampSaneMaxUv;
    var slopeOk = !isNaN(slope) && slope >= T.slopeMin && slope <= T.slopeMax;
    var eegLike = ampSane && slopeOk && !decodeBug;
    metrics.eegLike = eegLike ? 1 : 0;
    if (decodeBug) {
      reasons.push('signal reads RMS ' + Math.round(refRms) + ' uV — not EEG (Muse-2 decode bug). HARD FAIL.');
    } else if (!eegLike) {
      if (!ampSane) reasons.push('amplitude ' + Math.round(refRms) + ' uV outside plausible EEG range');
      if (!slopeOk) reasons.push('no plausible 1/f spectral slope (got ' + metrics.spectralSlope + ')');
    }

    // ── Dry-electrode low-frequency bias: NOTE it, never "fix" it. ──
    var delta = bandPower(spec, 1, 4), theta = bandPower(spec, 4, 8);
    var alpha = bandPower(spec, 8, 13), beta = bandPower(spec, 13, 30);
    var lowBias = (delta + theta) / ((alpha + beta) || 1e-12);
    metrics.lowFreqBias = +lowBias.toFixed(3);

    // ── Baseline: RECORDED AS FACT. Never applied to the stream. ──
    var baseline = {
      rmsUv: +refRms.toFixed(2),
      deltaPower: +delta.toFixed(4), thetaPower: +theta.toFixed(4),
      alphaPower: +alpha.toFixed(4), betaPower: +beta.toFixed(4),
      lowFreqBias: +lowBias.toFixed(3)
    };

    // ── Headline gate. Decode bug is an absolute hard fail. ──
    var passed = !decodeBug &&
                 goodChannels >= T.minGoodChannels &&
                 cmrrIntact &&
                 mainsRel <= T.mainsRelMax &&
                 eegLike;

    return {
      passed: passed, calibVersion: CALIB_VERSION, thresholds: T, metrics: metrics,
      perSensor: perSensor, baseline: baseline, reasons: reasons,
      fixes: passed ? [] : museFixes(reasons, mainsHz)
    };
  }

  function museFixes(reasons, mainsHz) {
    var fixes = [];
    var joined = reasons.join(' | ');
    if (/no contact|only .* sensors|flat/.test(joined)) {
      fixes.push('Dab a little water on the sensor pads and clear hair from behind the ears — the side sensors (TP9/TP10) seat slowest.');
    }
    if (/CMRR|reference/.test(joined)) {
      fixes.push('Reseat the band for firm, even pressure — press the center of the forehead in; the middle reference pad has to make good contact.');
    }
    if (/mains/.test(joined)) {
      fixes.push('Move away from chargers/laptops, and confirm your region is set to ' + mainsHz + ' Hz mains.');
    }
    if (/railed|saturated|decode/.test(joined)) {
      fixes.push('Scrub any oxidation off the metal connectors and reconnect; if RMS still reads in the thousands, restart the stream (decode path check).');
    }
    if (/1\/f|amplitude/.test(joined)) {
      fixes.push('Hold still for a few seconds and reseat — the check needs a clean resting stretch to see the EEG shape.');
    }
    if (!fixes.length) fixes.push('Reseat the band for firm, even contact and re-run the check.');
    return fixes;
  }

  function calibratePolar(window, opts) {
    var T = mergeThresholds(POLAR_THRESHOLDS, opts.thresholds);
    var rr = window.rr || window.rrMs || [];
    var reasons = [], metrics = {};

    if (!rr.length) {
      return {
        passed: false, calibVersion: CALIB_VERSION, thresholds: T, metrics: { nBeats: 0 },
        baseline: {}, reasons: ['no R-R stream'],
        fixes: ['Wet the strap electrodes and settle it snug just below the chest muscles, then re-run the check.']
      };
    }

    var valid = 0, i, prev = null, impossibleJumps = 0;
    var validRr = [];
    for (i = 0; i < rr.length; i++) {
      var v = rr[i];
      var inRange = v >= T.rrMinMs && v <= T.rrMaxMs;
      var jumpOk = prev === null || Math.abs(v - prev) / prev <= T.maxJumpFrac;
      if (inRange && jumpOk) { valid++; validRr.push(v); }
      else if (inRange && !jumpOk) impossibleJumps++;
      prev = inRange ? v : prev;
    }
    metrics.nBeats = rr.length;
    metrics.validBeats = valid;
    metrics.validFraction = +(valid / rr.length).toFixed(3);
    metrics.impossibleJumps = impossibleJumps;
    metrics.meanBpm = validRr.length ? +(60000 / mean(validRr)).toFixed(1) : null;

    if (valid < T.minValidBeats) reasons.push('too few plausible beats (' + valid + ')');
    if (metrics.validFraction < T.minValidFraction) reasons.push('unstable contact — ' + Math.round((1 - metrics.validFraction) * 100) + '% of beats implausible');

    var passed = valid >= T.minValidBeats && metrics.validFraction >= T.minValidFraction;
    var baseline = { meanRrMs: validRr.length ? +mean(validRr).toFixed(1) : null, meanBpm: metrics.meanBpm };

    return {
      passed: passed, calibVersion: CALIB_VERSION, thresholds: T, metrics: metrics,
      baseline: baseline, reasons: reasons,
      fixes: passed ? [] : ['Wet the strap electrodes, tighten it snug against the skin just below the chest muscles, and re-run the check.']
    };
  }

  function mergeThresholds(base, over) {
    var out = {}, k;
    for (k in base) if (base.hasOwnProperty(k)) out[k] = base[k];
    if (over) for (k in over) if (over.hasOwnProperty(k)) out[k] = over[k];
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PART B — THE PROCESSOR (extract-and-disclose during the session)
  //  Emits a cleaned stream PLUS a provenance record. Raw passes through
  //  untouched in parallel. Every extractor passes the strap-off test.
  // ═══════════════════════════════════════════════════════════════════════

  function makeProcessor(sensor, opts) {
    opts = opts || {};
    if (sensor === 'polar_h10') return makePolarProcessor(opts);
    return makeMuseProcessor(opts);
  }

  function makeMuseProcessor(opts) {
    var P = mergeThresholds(PROC_DEFAULTS, opts.proc);
    var T = mergeThresholds(MUSE_THRESHOLDS, opts.thresholds);
    var fs = opts.fs || 256;
    var channels = opts.channels || MUSE_LABELS;
    var streamId = opts.streamId || 'muse';
    var mainsHz = opts.mainsHz && opts.mainsHz !== 'auto' ? opts.mainsHz : (opts.calibration && opts.calibration.metrics && opts.calibration.metrics.mainsHz) || 60;
    var restingEmg = (opts.baseline && opts.baseline.betaPower) || null; // resting >20Hz reference if provided

    var notch = notchCoeffs(mainsHz, fs, P.notchQ);
    var notchState = channels.map(makeBiquadState);
    var winLen = Math.max(1, Math.round(P.windowSec * fs));

    var cleanCbs = [], rawCbs = [];
    var buf = channels.map(function () { return []; });   // cleaned (notched) window buffer
    var rawBuf = channels.map(function () { return []; }); // raw window buffer (untouched)
    var accBuf = [];
    var tStart = null, tLast = 0, sampleClock = 0;

    // Provenance accumulators
    var timeline = [];       // [{tMs, quality}]
    var rawWindows = 0, recoveredWindows = 0, gapWindows = 0, totalWindows = 0;
    var comps = {};          // compensation -> count
    var blinkCount = 0, blinkWindows = 0, emgWindows = 0, motionWindows = 0;
    var droppedByCh = {};
    var decodeGuardTripped = false;
    var emgMedians = [];     // rolling resting estimate of >20Hz power

    function note(name) { comps[name] = (comps[name] || 0) + 1; }

    function push(raw) {
      // raw.ch = [TP9, AF7, AF8, TP10]; optional raw.acc = [x,y,z]; optional raw.t
      var t = (raw.t != null) ? raw.t : (sampleClock / fs) * 1000;
      if (tStart === null) tStart = t;
      tLast = t;
      sampleClock++;

      // RAW IS SACRED — pass the untouched sample straight through, always.
      for (var r = 0; r < rawCbs.length; r++) rawCbs[r](raw);

      var cleanCh = new Array(channels.length);
      for (var c = 0; c < channels.length; c++) {
        var x = raw.ch[c];
        // Muse-2 decode guard: a single sample in the thousands of uV is not
        // EEG. We do NOT paint over it — we flag it hard and pass the value
        // through unchanged so the raw record stays honest.
        if (Math.abs(x) > T.decodeRmsUv) decodeGuardTripped = true;
        // 50/60 Hz notch — strap-off test: a notch on silence outputs silence.
        var y = biquad(notch, notchState[c], x);
        cleanCh[c] = y;
        buf[c].push(y);
        rawBuf[c].push(x);
      }
      if (raw.acc) accBuf.push(Math.sqrt(raw.acc[0] * raw.acc[0] + raw.acc[1] * raw.acc[1] + raw.acc[2] * raw.acc[2]));

      // Score + emit a provenance window every winLen samples.
      if (buf[0].length >= winLen) flushWindow(t);

      // Emit the cleaned sample for the experience/display.
      var clean = { t: t, ch: cleanCh };
      for (var cc = 0; cc < cleanCbs.length; cc++) cleanCbs[cc](clean);
    }

    function flushWindow(tMs) {
      totalWindows++;
      var used = [], dropped = [];
      var quality = 0, qCount = 0;
      var windowRecovered = false, windowIsGap;

      // ── Bad-channel rejection + selection ──
      // Strap-off test: an off-head channel is flat/railed -> dropped, produces
      // nothing. We record which channels were used vs dropped this segment.
      for (var c = 0; c < channels.length; c++) {
        var rawSig = rawBuf[c];
        var s = std(rawSig);
        var railed = 0, i;
        for (i = 0; i < rawSig.length; i++) if (Math.abs(rawSig[i]) >= T.saturationUv) railed++;
        var bad = s < T.flatStdUv || (railed / rawSig.length) > T.railFraction;
        if (bad) {
          dropped.push(channels[c]);
          droppedByCh[channels[c]] = (droppedByCh[channels[c]] || 0) + 1;
          windowRecovered = true;
          note('dropped_' + channels[c]);
        } else {
          used.push(c);
          quality += clamp01((s - T.flatStdUv) / 20); qCount++;
        }
      }
      windowIsGap = used.length === 0; // no usable channel this window

      // ── Notch materiality: did it actually remove meaningful mains power? ──
      if (used.length) {
        var refc = used[0];
        var pr = psd(rawBuf[refc], fs), pc = psd(buf[refc], fs);
        var removed = bandPower(pr, mainsHz - 2, mainsHz + 2) - bandPower(pc, mainsHz - 2, mainsHz + 2);
        var total = bandPower(pr, 1, 45) || 1e-12;
        if (removed / total > P.notchRemoveFrac) { windowRecovered = true; note('notch_' + mainsHz + 'hz'); }

        // ── Eye-blink / EOG rejection on frontal AF7/AF8 ──
        // Strap-off test: no head -> no blink transients -> nothing flagged.
        var frontal = [1, 2].filter(function (fi) { return used.indexOf(fi) !== -1; });
        var blinkedHere = false;
        for (var f = 0; f < frontal.length; f++) {
          var fsig = buf[frontal[f]];
          var lo = movingLowFreqPeak(fsig, fs);
          if (lo > P.blinkUv) { blinkedHere = true; blinkCount++; }
        }
        if (blinkedHere) { blinkWindows++; windowRecovered = true; note('blink_reject'); }

        // ── Jaw-clench / EMG rejection: >20 Hz power burst ──
        var emgNow = bandPower(pc, 20, Math.min(45, fs / 2 - 1));
        emgMedians.push(emgNow); if (emgMedians.length > 30) emgMedians.shift();
        var emgRef = restingEmg || median(emgMedians) || emgNow;
        if (emgNow > emgRef * P.emgBandPowerMul && emgMedians.length >= 5) {
          emgWindows++; windowRecovered = true; note('emg_reject');
        }
      }

      // ── Motion rejection (accelerometer when present) ──
      // Strap-off test: without an accel stream we simply cannot claim motion
      // rejection — we don't fabricate it; we just don't credit it.
      if (accBuf.length) {
        var accDev = std(accBuf);
        if (accDev > P.motionG) { motionWindows++; windowRecovered = true; note('motion_reject'); }
      }

      // ── Quality + classification ──
      var q;
      if (windowIsGap) { q = 0; gapWindows++; }
      else {
        q = qCount ? quality / qCount : 0;
        if (windowRecovered) recoveredWindows++; else rawWindows++;
      }
      timeline.push({ tMs: Math.round(tMs), quality: +q.toFixed(3) });

      // roll the window buffers
      for (var cix = 0; cix < channels.length; cix++) { buf[cix] = []; rawBuf[cix] = []; }
      accBuf = [];
    }

    // Peak-to-peak of a slow (<4 Hz) component — a blink signature — without
    // an FFT: subtract a short moving average to isolate the low-freq swing.
    function movingLowFreqPeak(sig, fs) {
      var win = Math.max(2, Math.round(fs / 8));
      var mn = Infinity, mx = -Infinity, i, acc = 0;
      var q = [];
      for (i = 0; i < sig.length; i++) {
        q.push(sig[i]); acc += sig[i];
        if (q.length > win) acc -= q.shift();
        var m = acc / q.length;
        if (m < mn) mn = m; if (m > mx) mx = m;
      }
      return mx - mn;
    }

    function finalize() {
      // fold any partial trailing window so its data isn't silently lost
      if (buf[0] && buf[0].length) flushWindow(tLast);
      var denom = totalWindows || 1;
      var rawFraction = rawWindows / denom;
      var recoveredFraction = recoveredWindows / denom;
      // EEG is NEVER interpolated — we do not invent brain samples. Gaps are
      // recorded as absence, not filled.
      var gapFraction = gapWindows / denom;

      var tier = rawFraction >= P.cleanFloor ? 'clean'
               : rawFraction >= P.salvageFloor ? 'compensated' : 'salvage';

      var applied = Object.keys(comps);
      if (decodeGuardTripped) { applied.push('decode_guard_triggered'); tier = 'salvage'; }

      var stream = {};
      stream[streamId] = {
        rawFraction: +rawFraction.toFixed(4),
        recoveredFraction: +recoveredFraction.toFixed(4),
        interpolatedFraction: 0,          // EEG is never bridged
        gapFraction: +gapFraction.toFixed(4),
        compensationsApplied: applied,
        qualityTimeline: timeline,
        tier: tier,
        detail: {
          mainsHz: mainsHz,
          blinksRejected: blinkCount,
          blinkWindows: blinkWindows,
          emgWindows: emgWindows,
          motionWindows: motionWindows,
          motionAvailable: accBuf.length > 0 || motionWindows > 0,
          channelsDropped: droppedByCh,
          decodeGuardTripped: decodeGuardTripped,
          windows: totalWindows
        }
      };
      return { provVersion: PROV_VERSION, perStream: stream };
    }

    return {
      push: push,
      onClean: function (cb) { cleanCbs.push(cb); },
      onRaw: function (cb) { rawCbs.push(cb); },
      finalize: finalize
    };
  }

  // ── Polar H10: R-R recovery + ectopic handling + CAPPED interpolation ──
  function makePolarProcessor(opts) {
    var P = mergeThresholds(PROC_DEFAULTS, opts.proc);
    var T = mergeThresholds(POLAR_THRESHOLDS, opts.thresholds);
    var streamId = opts.streamId || 'polar';

    var cleanCbs = [], rawCbs = [];
    var recent = [];         // local window of accepted R-R for median
    var tClock = 0;

    var rawBeats = 0, recoveredBeats = 0, interpBeats = 0, gapBeats = 0, ectopic = 0, total = 0;
    var timeline = [];
    var comps = {};
    function note(n) { comps[n] = (comps[n] || 0) + 1; }

    function emit(sample) {
      for (var i = 0; i < cleanCbs.length; i++) cleanCbs[i](sample);
    }

    function push(raw) {
      var rr = (raw.rr != null) ? raw.rr : raw.rrMs;
      total++;
      // RAW IS SACRED.
      for (var r = 0; r < rawCbs.length; r++) rawCbs[r](raw);

      var t = (raw.t != null) ? raw.t : tClock;
      var med = recent.length ? median(recent) : rr;
      var ratio = (med && rr != null) ? rr / med : 1;

      // Null or impossibly FAST -> unusable. A gap, filled with NOTHING.
      if (rr == null || rr < T.rrMinMs) {
        gapBeats++; note('gap_marked');
        emit({ t: t, rr: null, kind: 'gap' });
        timeline.push({ tMs: Math.round(t), quality: 0 });
        tClock = t + (med || 800);
        return;
      }

      // Missed beat(s): the interval is a large multiple of the local rate, so
      // one or more beats were dropped. Bridge ONLY if the whole hole is short
      // enough to genuinely bridge (<= interpCapMs). This is the one place
      // interpolation is allowed, and the cap is where honesty is enforced:
      // past it we do not fill — we mark a gap.
      if (recent.length >= 3 && ratio >= 1.75) {
        if (rr <= P.interpCapMs) {
          var k = Math.max(2, Math.round(ratio));
          var each = rr / k;
          for (var j = 0; j < k; j++) { interpBeats++; emit({ t: t + j * each, rr: each, kind: 'interpolated' }); }
          note('rr_interp_missed_beat');
          timeline.push({ tMs: Math.round(t), quality: 0.4 });
          tClock = t + rr;
          return;
        }
        // Hole longer than the cap (e.g. a dropout): mark a gap, fill NOTHING.
        gapBeats++; note('gap_marked');
        emit({ t: t, rr: null, kind: 'gap' });
        timeline.push({ tMs: Math.round(t), quality: 0 });
        tClock = t + rr;
        return;
      }

      // Impossibly SLOW but not a clean multiple (and past the cap) -> gap.
      if (rr > T.rrMaxMs) {
        gapBeats++; note('gap_marked');
        emit({ t: t, rr: null, kind: 'gap' });
        timeline.push({ tMs: Math.round(t), quality: 0 });
        tClock = t + Math.min(rr, P.interpCapMs);
        return;
      }

      // Ectopic: a real-looking but out-of-place beat (deviates from local median).
      if (recent.length >= 3 && Math.abs(rr - med) / med > P.ectopicFrac) {
        ectopic++; recoveredBeats++;
        note('ectopic_flagged');
        emit({ t: t, rr: rr, kind: 'recovered', ectopic: true });
        timeline.push({ tMs: Math.round(t), quality: 0.6 });
        // an ectopic beat does not update the resting median
        tClock = t + rr;
        return;
      }

      // Clean beat.
      rawBeats++;
      recent.push(rr); if (recent.length > 11) recent.shift();
      emit({ t: t, rr: rr, kind: 'raw' });
      timeline.push({ tMs: Math.round(t), quality: 1 });
      tClock = t + rr;
    }

    function finalize() {
      var denom = total || 1;
      var rawFraction = rawBeats / denom;
      var recoveredFraction = recoveredBeats / denom;
      var interpolatedFraction = interpBeats / (rawBeats + recoveredBeats + interpBeats || 1);
      var tier = rawFraction >= P.cleanFloor ? 'clean'
               : rawFraction >= P.salvageFloor ? 'compensated' : 'salvage';
      var stream = {};
      stream[streamId] = {
        rawFraction: +rawFraction.toFixed(4),
        recoveredFraction: +recoveredFraction.toFixed(4),
        interpolatedFraction: +interpolatedFraction.toFixed(4),
        gapFraction: +(gapBeats / denom).toFixed(4),
        compensationsApplied: Object.keys(comps),
        qualityTimeline: timeline,
        tier: tier,
        detail: { ectopicFlagged: ectopic, gapsMarked: gapBeats, interpCapMs: P.interpCapMs, beats: total }
      };
      return { provVersion: PROV_VERSION, perStream: stream };
    }

    return {
      push: push,
      onClean: function (cb) { cleanCbs.push(cb); },
      onRaw: function (cb) { rawCbs.push(cb); },
      finalize: finalize
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EXPORT
  // ═══════════════════════════════════════════════════════════════════════

  var API = {
    calibVersion: CALIB_VERSION,
    provVersion: PROV_VERSION,
    calibrate: calibrate,
    makeProcessor: makeProcessor,
    // exposed for tests / reuse / threshold tuning
    _thresholds: { muse: MUSE_THRESHOLDS, polar: POLAR_THRESHOLDS, proc: PROC_DEFAULTS },
    _math: { psd: psd, bandPower: bandPower, spectralSlope: spectralSlope, linePowerRatio: linePowerRatio, rms: rms, std: std }
  };

  global.AetheriaSignal = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);

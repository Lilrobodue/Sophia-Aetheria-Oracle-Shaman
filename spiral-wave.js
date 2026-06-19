/*
 * spiral-wave.js — Sophia Aetheria Spiral Wave Detection
 * ------------------------------------------------------------------
 * Downstream signatures of rotating cortical "spiral" waves
 * (Ye et al., Science 2026, DOI:10.1126/science.adx1369) from the
 * 4-channel Muse S/2 montage (AF7, AF8, TP9, TP10 @ 256 Hz).
 *
 * Three metrics per analysis window:
 *   1. Pairwise PLV matrix     — 6 channel pairs x 4 bands
 *   2. Phase-lag direction     — front<->back traveling-wave direction (L/R)
 *   3. Hemispheric coherence   — inter-hemispheric / ipsilateral PLV ratio
 *
 * Phase extraction note:
 *   We build a band-limited *analytic* signal directly in the frequency
 *   domain (FFT -> keep only the band's positive-frequency bins, doubled
 *   -> IFFT). This folds the band-pass and the Hilbert transform into one
 *   step and is phase-accurate (no FIR group-delay misalignment). The
 *   instantaneous phase is atan2(imag, real) of that complex signal.
 *
 * Pure, dependency-free, runs client-side. Exposes window.SpiralWaveAnalyzer.
 */
(function (global) {
  'use strict';

  // ---- Constants -----------------------------------------------------------

  // Frequency bands of interest (Hz). Delta is intentionally excluded:
  // the front/back electrode spacing on Muse can't resolve <4 Hz direction.
  var BANDS = {
    theta: { low: 4, high: 8 },   // meditation, drowsiness, memory
    alpha: { low: 8, high: 13 },  // relaxed awareness, default mode
    beta:  { low: 13, high: 30 }, // active thinking, focus
    gamma: { low: 30, high: 50 }, // cross-regional binding
  };
  var BAND_NAMES = ['theta', 'alpha', 'beta', 'gamma'];

  // Center frequency per band, used to convert phase lag -> milliseconds.
  var BAND_CENTERS = { theta: 6, alpha: 10.5, beta: 21.5, gamma: 40 };

  // The six unique channel pairs and what each one probes.
  var CHANNEL_PAIRS = [
    { name: 'AF7-AF8',  a: 'AF7', b: 'AF8',  type: 'inter-hemispheric-frontal' },
    { name: 'TP9-TP10', a: 'TP9', b: 'TP10', type: 'inter-hemispheric-temporal' },
    { name: 'AF7-TP9',  a: 'AF7', b: 'TP9',  type: 'ipsilateral-left' },
    { name: 'AF8-TP10', a: 'AF8', b: 'TP10', type: 'ipsilateral-right' },
    { name: 'AF7-TP10', a: 'AF7', b: 'TP10', type: 'contralateral-left-right' },
    { name: 'AF8-TP9',  a: 'AF8', b: 'TP9',  type: 'contralateral-right-left' },
  ];

  var CHANNELS = ['AF7', 'AF8', 'TP9', 'TP10'];
  var TWO_PI = 2 * Math.PI;

  // ---- FFT (iterative radix-2, in place) -----------------------------------

  function nextPow2(n) {
    var p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function largestPow2AtMost(n) {
    var p = 1;
    while ((p << 1) <= n) p <<= 1;
    return p;
  }

  // In-place Cooley-Tukey FFT. re/im are Float64Array of length N (power of 2).
  // inverse=true performs the IFFT (with 1/N scaling).
  function fft(re, im, inverse) {
    var n = re.length;
    if (n <= 1) return;

    // Bit-reversal permutation
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }

    var sign = inverse ? 1 : -1;
    for (var len = 2; len <= n; len <<= 1) {
      var ang = sign * TWO_PI / len;
      var wpr = Math.cos(ang);
      var wpi = Math.sin(ang);
      for (var start = 0; start < n; start += len) {
        var wr = 1, wi = 0;
        var halfLen = len >> 1;
        for (var k = 0; k < halfLen; k++) {
          var iEven = start + k;
          var iOdd = start + k + halfLen;
          var er = re[iEven], ei = im[iEven];
          var or_ = re[iOdd], oi = im[iOdd];
          var tr2 = or_ * wr - oi * wi;
          var ti2 = or_ * wi + oi * wr;
          re[iEven] = er + tr2;
          im[iEven] = ei + ti2;
          re[iOdd] = er - tr2;
          im[iOdd] = ei - ti2;
          var nwr = wr * wpr - wi * wpi;
          wi = wr * wpi + wi * wpr;
          wr = nwr;
        }
      }
    }

    if (inverse) {
      for (var m = 0; m < n; m++) {
        re[m] /= n;
        im[m] /= n;
      }
    }
  }

  // ---- Band-limited analytic phase -----------------------------------------

  // Given a real signal window (length = power of 2), returns an object
  // mapping each band name -> Float64Array of instantaneous phase (radians).
  function bandAnalyticPhases(signal, sampleRate) {
    var N = signal.length;

    // Detrend (remove DC / slow mean) so band masking is clean.
    var mean = 0;
    for (var i = 0; i < N; i++) mean += signal[i];
    mean /= N;

    var baseRe = new Float64Array(N);
    var baseIm = new Float64Array(N);
    for (var s = 0; s < N; s++) baseRe[s] = signal[s] - mean;
    fft(baseRe, baseIm, false);

    var out = {};
    for (var bi = 0; bi < BAND_NAMES.length; bi++) {
      var band = BAND_NAMES[bi];
      var lo = BANDS[band].low;
      var hi = BANDS[band].high;

      // Bin indices for this band (positive frequencies only).
      var loBin = Math.max(1, Math.ceil(lo * N / sampleRate));
      var hiBin = Math.min((N >> 1) - 1, Math.floor(hi * N / sampleRate));

      var re = new Float64Array(N);
      var im = new Float64Array(N);
      // Keep only this band's positive-frequency bins, doubled -> analytic.
      for (var k = loBin; k <= hiBin; k++) {
        re[k] = 2 * baseRe[k];
        im[k] = 2 * baseIm[k];
      }
      fft(re, im, true); // IFFT -> band-limited analytic time signal

      var phase = new Float64Array(N);
      for (var t = 0; t < N; t++) phase[t] = Math.atan2(im[t], re[t]);
      out[band] = phase;
    }
    return out;
  }

  // ---- PLV between two phase series ----------------------------------------

  // edgeTrim discards samples at both ends to avoid IFFT edge ringing.
  function plvFromPhases(phaseA, phaseB, edgeTrim) {
    var N = phaseA.length;
    var start = edgeTrim;
    var end = N - edgeTrim;
    if (end - start < 8) { start = 0; end = N; }

    var sumCos = 0, sumSin = 0;
    var count = end - start;
    for (var i = start; i < end; i++) {
      var diff = phaseA[i] - phaseB[i];
      sumCos += Math.cos(diff);
      sumSin += Math.sin(diff);
    }
    var mCos = sumCos / count;
    var mSin = sumSin / count;
    return {
      plv: Math.sqrt(mCos * mCos + mSin * mSin),
      phaseDiff: Math.atan2(mSin, mCos), // mean phase diff (A relative to B)
    };
  }

  function lagMsFromPhaseDiff(phaseDiff, band) {
    var f = BAND_CENTERS[band] || 10;
    return (phaseDiff / TWO_PI) * (1000 / f);
  }

  function directionFromPhaseDiff(phaseDiff, strength) {
    if (strength < 0.1) return 'indeterminate';
    // phaseDiff = front - back. Positive => front leads => wave front-to-back.
    return phaseDiff > 0 ? 'front-to-back' : 'back-to-front';
  }

  // ---- Analyzer ------------------------------------------------------------

  function SpiralWaveAnalyzer(opts) {
    opts = opts || {};
    this.sampleRate = opts.sampleRate || 256;
    // Target analysis window (samples). Snapped to a power of two at analyze().
    this.windowSize = opts.windowSize || 512; // ~2 s at 256 Hz
    this.minSamples = opts.minSamples || 256;  // need >=1 s to be meaningful
    // Band used for the directional (front<->back) read-out.
    this.directionBand = opts.directionBand || 'alpha';
  }

  // channels: { AF7:[..], AF8:[..], TP9:[..], TP10:[..] } raw sample arrays.
  // Returns the full spiral-metric object, or null if there isn't enough data.
  SpiralWaveAnalyzer.prototype.analyze = function (channels, timestamp) {
    // Determine usable window length common to all four channels.
    var minLen = Infinity;
    for (var c = 0; c < CHANNELS.length; c++) {
      var arr = channels[CHANNELS[c]];
      if (!arr || arr.length < this.minSamples) return null;
      if (arr.length < minLen) minLen = arr.length;
    }
    var target = Math.min(this.windowSize, minLen);
    var N = largestPow2AtMost(target);
    if (N < this.minSamples) return null;

    var edgeTrim = Math.min(64, Math.floor(N * 0.1));

    // Per-channel band-limited analytic phase for the most recent N samples.
    var phases = {};
    for (var ci = 0; ci < CHANNELS.length; ci++) {
      var ch = CHANNELS[ci];
      var full = channels[ch];
      var win = full.slice(full.length - N);
      phases[ch] = bandAnalyticPhases(win, this.sampleRate);
    }

    // 1) Pairwise PLV matrix: { pairName: { band: { plv, phaseDiff } } }
    var plvMatrix = {};
    for (var pi = 0; pi < CHANNEL_PAIRS.length; pi++) {
      var pair = CHANNEL_PAIRS[pi];
      var perBand = {};
      for (var bi = 0; bi < BAND_NAMES.length; bi++) {
        var band = BAND_NAMES[bi];
        perBand[band] = plvFromPhases(phases[pair.a][band], phases[pair.b][band], edgeTrim);
      }
      plvMatrix[pair.name] = perBand;
    }

    // 2) Phase-lag direction (front -> back) in the directional band.
    var dBand = this.directionBand;
    var leftRaw = plvFromPhases(phases.AF7[dBand], phases.TP9[dBand], edgeTrim);
    var rightRaw = plvFromPhases(phases.AF8[dBand], phases.TP10[dBand], edgeTrim);

    var left = {
      lagMs: lagMsFromPhaseDiff(leftRaw.phaseDiff, dBand),
      direction: directionFromPhaseDiff(leftRaw.phaseDiff, leftRaw.plv),
      strength: leftRaw.plv,
      band: dBand,
    };
    var right = {
      lagMs: lagMsFromPhaseDiff(rightRaw.phaseDiff, dBand),
      direction: directionFromPhaseDiff(rightRaw.phaseDiff, rightRaw.plv),
      strength: rightRaw.plv,
      band: dBand,
    };
    var biLag = (left.lagMs + right.lagMs) / 2;
    var biStrength = Math.min(left.strength, right.strength);
    // Symmetry: how aligned the two pathways' phase offsets are (0..1).
    var symmetry = (1 + Math.cos(leftRaw.phaseDiff - rightRaw.phaseDiff)) / 2;
    var bilateral = {
      lagMs: biLag,
      direction: directionFromPhaseDiff((leftRaw.phaseDiff + rightRaw.phaseDiff) / 2, biStrength),
      symmetry: symmetry,
    };
    var phaseLag = { left: left, right: right, bilateral: bilateral };

    // 3) Hemispheric coherence ratio, per band.
    var hcr = {};
    var dominantBand = BAND_NAMES[0];
    var bestInter = -1;
    for (var hbi = 0; hbi < BAND_NAMES.length; hbi++) {
      var hb = BAND_NAMES[hbi];
      var interHemi = (plvMatrix['AF7-AF8'][hb].plv + plvMatrix['TP9-TP10'][hb].plv) / 2;
      var ipsi = (plvMatrix['AF7-TP9'][hb].plv + plvMatrix['AF8-TP10'][hb].plv) / 2;
      var ratio = ipsi > 0.01 ? interHemi / ipsi : interHemi * 100;
      hcr[hb] = {
        interHemisphericPLV: interHemi,
        ipsilateralPLV: ipsi,
        hcr: ratio,
        interpretation: ratio > 1.2 ? 'hemispheric-dominant'
                      : ratio < 0.8 ? 'ipsilateral-dominant' : 'balanced',
      };
      if (interHemi > bestInter) { bestInter = interHemi; dominantBand = hb; }
    }

    return {
      timestamp: timestamp || (typeof performance !== 'undefined' ? performance.now() : 0),
      windowSamples: N,
      windowSeconds: N / this.sampleRate,
      plvMatrix: plvMatrix,
      phaseLag: phaseLag,
      hcr: hcr,
      dominantBand: dominantBand,
    };
  };

  // Compact snapshot for export / timeline (rounded, small footprint).
  SpiralWaveAnalyzer.prototype.summarize = function (result) {
    if (!result) return null;
    var r2 = function (x) { return Math.round(x * 100) / 100; };
    var matrix = {};
    for (var p in result.plvMatrix) {
      if (!result.plvMatrix.hasOwnProperty(p)) continue;
      var key = p.replace('-', '_');
      matrix[key] = {};
      for (var b = 0; b < BAND_NAMES.length; b++) {
        matrix[key][BAND_NAMES[b]] = r2(result.plvMatrix[p][BAND_NAMES[b]].plv);
      }
    }
    var hcrOut = {};
    for (var hb in result.hcr) {
      if (!result.hcr.hasOwnProperty(hb)) continue;
      hcrOut[hb] = {
        interHemi: r2(result.hcr[hb].interHemisphericPLV),
        ipsi: r2(result.hcr[hb].ipsilateralPLV),
        hcr: r2(result.hcr[hb].hcr),
        interp: result.hcr[hb].interpretation,
      };
    }
    var pl = result.phaseLag;
    return {
      plv_matrix: matrix,
      phase_lag_left: { lagMs: r2(pl.left.lagMs), direction: pl.left.direction, strength: r2(pl.left.strength), band: pl.left.band },
      phase_lag_right: { lagMs: r2(pl.right.lagMs), direction: pl.right.direction, strength: r2(pl.right.strength), band: pl.right.band },
      phase_lag_bilateral: { lagMs: r2(pl.bilateral.lagMs), direction: pl.bilateral.direction, symmetry: r2(pl.bilateral.symmetry) },
      hcr: hcrOut,
      dominant_band: result.dominantBand,
    };
  };

  // Expose constants for the UI layer.
  SpiralWaveAnalyzer.BANDS = BANDS;
  SpiralWaveAnalyzer.BAND_NAMES = BAND_NAMES;
  SpiralWaveAnalyzer.CHANNEL_PAIRS = CHANNEL_PAIRS;
  SpiralWaveAnalyzer.BAND_CENTERS = BAND_CENTERS;

  global.SpiralWaveAnalyzer = SpiralWaveAnalyzer;
})(typeof window !== 'undefined' ? window : globalThis);

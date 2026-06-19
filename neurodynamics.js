/*
 * neurodynamics.js — Sophia Aetheria Temporal Dynamics
 * ------------------------------------------------------------------
 * The honest "whole from the part": we can't reconstruct cortical SPACE from
 * 4 electrodes, but Takens' embedding theorem lets us reconstruct the topology
 * of the underlying dynamical system's ATTRACTOR from a single time series —
 * a real, rigorous "whole shape" — plus fractal/complexity measures that
 * characterise how rich and ordered the dynamics are.
 *
 *   - Delay embedding (Takens)      -> phase-space attractor reconstruction
 *   - Higuchi fractal dimension     -> 1 (smooth) .. 2 (rough/noise)
 *   - Sample entropy                -> regularity / predictability
 *   - Lempel-Ziv complexity         -> ~0 (ordered) .. ~1 (random)
 *   - Recurrence rate               -> how often the trajectory revisits states
 *
 * Pure, dependency-free. Exposes window.NeuroDynamics.
 */
(function (global) {
  'use strict';

  function mean(a) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i];
    return s / a.length;
  }
  function std(a) {
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / a.length);
  }

  // ---- Biquad filters (RBJ cookbook) + zero-phase filtfilt -----------------
  // The raw EEG carries broadband + 60 Hz mains noise, which pins Higuchi FD
  // near 2 (noise) and τ at 1. Band-limiting to 1-45 Hz and notching 60 Hz first
  // makes the complexity metrics reflect brain rhythms, not wall power.
  function biquad(type, f0, fs, Q) {
    var w0 = 2 * Math.PI * f0 / fs;
    var c = Math.cos(w0), s = Math.sin(w0);
    var alpha = s / (2 * Q);
    var b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2;
      a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2;
      a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
    } else { // notch
      b0 = 1; b1 = -2 * c; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  function applyBiquad(x, c) {
    var y = new Array(x.length), z1 = 0, z2 = 0;
    for (var i = 0; i < x.length; i++) {
      var xi = x[i];
      var yi = c.b0 * xi + z1;
      z1 = c.b1 * xi - c.a1 * yi + z2;
      z2 = c.b2 * xi - c.a2 * yi;
      y[i] = yi;
    }
    return y;
  }
  function filtfilt(x, c) {
    var y = applyBiquad(x, c);
    y.reverse();
    y = applyBiquad(y, c);
    y.reverse();
    return y;
  }
  // Band-limit (1-45 Hz) + 60 Hz notch, zero-phase, with reflection padding.
  function bandlimitNotch(x, fs) {
    var pad = Math.min(128, x.length >> 2);
    var ext = new Array(x.length + 2 * pad);
    for (var i = 0; i < pad; i++) ext[i] = x[pad - 1 - i];
    for (var j = 0; j < x.length; j++) ext[pad + j] = x[j];
    for (var k = 0; k < pad; k++) ext[pad + x.length + k] = x[x.length - 1 - k];
    var y = filtfilt(ext, biquad('highpass', 1, fs, 0.707));
    y = filtfilt(y, biquad('lowpass', 45, fs, 0.707));
    y = filtfilt(y, biquad('notch', 60, fs, 30));
    return y.slice(pad, pad + x.length);
  }

  // ---- Delay (τ) selection: first lag where autocorrelation drops below 1/e --
  function chooseTau(x, maxLag) {
    var N = x.length;
    var m = mean(x);
    var denom = 0;
    for (var i = 0; i < N; i++) denom += (x[i] - m) * (x[i] - m);
    if (denom <= 0) return 1;
    var threshold = 1 / Math.E;
    for (var lag = 1; lag <= maxLag; lag++) {
      var num = 0;
      for (var t = 0; t < N - lag; t++) num += (x[t] - m) * (x[t + lag] - m);
      var ac = num / denom;
      if (ac < threshold) return lag;
    }
    return Math.min(maxLag, Math.max(1, Math.round(maxLag / 2)));
  }

  // ---- Takens delay embedding: vectors (x[i], x[i+τ], ..., x[i+(m-1)τ]) ------
  function delayEmbed(x, m, tau) {
    var N = x.length;
    var count = N - (m - 1) * tau;
    if (count <= 0) return [];
    var out = new Array(count);
    for (var i = 0; i < count; i++) {
      var v = new Array(m);
      for (var d = 0; d < m; d++) v[d] = x[i + d * tau];
      out[i] = v;
    }
    return out;
  }

  // ---- Higuchi fractal dimension --------------------------------------------
  function higuchiFD(x, kmax) {
    var N = x.length;
    kmax = kmax || 10;
    var lnL = [], lnK = [];
    for (var k = 1; k <= kmax; k++) {
      var Lk = 0, valid = 0;
      for (var mStart = 0; mStart < k; mStart++) {
        var nMax = Math.floor((N - 1 - mStart) / k);
        if (nMax < 1) continue;
        var sum = 0;
        for (var i = 1; i <= nMax; i++) {
          sum += Math.abs(x[mStart + i * k] - x[mStart + (i - 1) * k]);
        }
        var norm = (N - 1) / (nMax * k);
        Lk += (sum * norm) / k;
        valid++;
      }
      if (valid > 0) {
        var Lm = Lk / valid;
        if (Lm > 0) { lnL.push(Math.log(Lm)); lnK.push(Math.log(1 / k)); }
      }
    }
    if (lnL.length < 3) return null;
    // slope of ln(L) vs ln(1/k) = fractal dimension
    var n = lnL.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var j = 0; j < n; j++) { sx += lnK[j]; sy += lnL[j]; sxx += lnK[j] * lnK[j]; sxy += lnK[j] * lnL[j]; }
    var d = n * sxx - sx * sx;
    return Math.abs(d) > 1e-12 ? (n * sxy - sx * sy) / d : null;
  }

  // ---- Sample entropy (m=2, r=0.2*std) --------------------------------------
  function sampleEntropy(x, m, r) {
    var N = x.length;
    m = m || 2;
    r = (r == null) ? 0.2 * std(x) : r;
    if (r <= 0) return 0;
    function countMatches(mm) {
      var count = 0;
      for (var i = 0; i < N - mm; i++) {
        for (var j = i + 1; j < N - mm; j++) {
          var match = true;
          for (var d = 0; d < mm; d++) {
            if (Math.abs(x[i + d] - x[j + d]) > r) { match = false; break; }
          }
          if (match) count++;
        }
      }
      return count;
    }
    var B = countMatches(m);
    var A = countMatches(m + 1);
    if (B === 0 || A === 0) return null; // undefined — too few matches
    return -Math.log(A / B);
  }

  // ---- Lempel-Ziv complexity (binarised vs median, LZ76, normalised) --------
  function lempelZiv(x) {
    var N = x.length;
    var sorted = Array.prototype.slice.call(x).sort(function (a, b) { return a - b; });
    var median = sorted[sorted.length >> 1];
    var s = '';
    for (var i = 0; i < N; i++) s += (x[i] > median) ? '1' : '0';
    // LZ76 substring-complexity count
    var c = 1, l = 1, iPtr = 0, k = 1, kMax = 1;
    while (true) {
      if (s.charAt(iPtr + k - 1) === s.charAt(l + k - 1)) {
        k++;
        if (l + k > N) { c++; break; }
      } else {
        if (k > kMax) kMax = k;
        iPtr++;
        if (iPtr === l) { c++; l += kMax; if (l + 1 > N) break; iPtr = 0; k = 1; kMax = 1; }
        else { k = 1; }
      }
    }
    // Normalise: b(n) = n / log2(n)
    var norm = N / (Math.log(N) / Math.log(2));
    return c / norm;
  }

  // ---- Recurrence rate of the embedded trajectory ---------------------------
  function recurrenceRate(vectors, eps, cap) {
    var n = vectors.length;
    if (n < 4) return 0;
    // Downsample to cap points for an O(cap^2) pass.
    cap = cap || 250;
    var idx = [];
    if (n > cap) {
      var step = n / cap;
      for (var s = 0; s < cap; s++) idx.push(Math.floor(s * step));
    } else {
      for (var s2 = 0; s2 < n; s2++) idx.push(s2);
    }
    var M = idx.length, m = vectors[0].length;
    var pairs = 0, recur = 0;
    for (var i = 0; i < M; i++) {
      for (var j = i + 1; j < M; j++) {
        var dist = 0;
        var vi = vectors[idx[i]], vj = vectors[idx[j]];
        for (var d = 0; d < m; d++) { var dd = vi[d] - vj[d]; dist += dd * dd; }
        dist = Math.sqrt(dist);
        pairs++;
        if (dist < eps) recur++;
      }
    }
    return pairs > 0 ? recur / pairs : 0;
  }

  // ---- Top-level analysis ---------------------------------------------------
  function NeuroDynamics() {}

  // Analyse a 1-D signal. Returns embedding params, complexity metrics, and a
  // normalised 2-D phase portrait (delay embedding) for rendering.
  NeuroDynamics.analyze = function (signal, opts) {
    opts = opts || {};
    if (!signal || signal.length < 64) return null;
    var fs = opts.sampleRate || 256;
    // Work on a manageable window; detrend.
    var win = signal.slice(-(opts.windowSize || 1024));
    var mu = mean(win);
    var x = new Array(win.length);
    for (var i = 0; i < win.length; i++) x[i] = win[i] - mu;
    // Band-limit (1-45 Hz) + 60 Hz notch so the metrics reflect brain rhythms,
    // not broadband/mains noise (which otherwise pins FD~2 and τ=1).
    if (opts.bandlimit !== false) x = bandlimitNotch(x, fs);
    var sigma = std(x) || 1e-9;

    var maxLag = opts.maxLag || 64;
    var tau = chooseTau(x, maxLag);
    var m = opts.embeddingDim || 3;

    var vectors = delayEmbed(x, m, tau);
    // Recurrence threshold scales with signal spread & dimension.
    var eps = 0.2 * sigma * Math.sqrt(m);
    var rr = recurrenceRate(vectors, eps);

    // 2-D phase portrait (x[t] vs x[t+τ]), normalised to [-1,1], downsampled.
    var portrait = [];
    var pcount = x.length - tau;
    var pstep = Math.max(1, Math.floor(pcount / (opts.portraitPoints || 400)));
    var norm = 1 / (3 * sigma); // ~clip at 3σ
    for (var p = 0; p < pcount; p += pstep) {
      portrait.push({
        x: Math.max(-1, Math.min(1, x[p] * norm)),
        y: Math.max(-1, Math.min(1, x[p + tau] * norm)),
      });
    }

    var r2 = function (v) { return v == null ? null : Math.round(v * 1000) / 1000; };
    return {
      tau: tau,
      embeddingDim: m,
      higuchiFD: r2(higuchiFD(x, opts.kmax || 10)),
      sampleEntropy: r2(sampleEntropy(x, 2, 0.2 * sigma)),
      lempelZiv: r2(lempelZiv(x)),
      recurrenceRate: r2(rr),
      portrait: portrait,
    };
  };

  // Expose individual tools too (handy for testing / reuse).
  NeuroDynamics.delayEmbed = delayEmbed;
  NeuroDynamics.higuchiFD = higuchiFD;
  NeuroDynamics.sampleEntropy = sampleEntropy;
  NeuroDynamics.lempelZiv = lempelZiv;
  NeuroDynamics.recurrenceRate = recurrenceRate;
  NeuroDynamics.chooseTau = chooseTau;
  NeuroDynamics.bandlimitNotch = bandlimitNotch;

  global.NeuroDynamics = NeuroDynamics;
})(typeof window !== 'undefined' ? window : globalThis);

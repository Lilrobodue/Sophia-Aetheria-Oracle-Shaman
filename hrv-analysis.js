/*
 * hrv-analysis.js — Heart-Rate Variability from Polar H10 R-R intervals
 * ------------------------------------------------------------------
 * Pure time- and frequency-domain HRV from a stream of R-R intervals (ms).
 * Everything here is HONEST: with too few beats it returns nulls, never
 * fabricated coherence. R-R must be genuinely present.
 *
 *   Time domain:  meanRR, meanHR, SDNN, RMSSD, pNN50
 *   Freq domain:  LF (0.04-0.15), HF (0.15-0.40), LF/HF, and an HRV
 *                 "coherence" score (peak-power ratio around the dominant
 *                 low-frequency rhythm — the HeartMath-style measure).
 *
 * Pure, dependency-free. Exposes window.HRVAnalysis (and module.exports).
 */
(function (global) {
  'use strict';

  var MIN_BEATS_TIME = 5;    // below this, time-domain HRV is meaningless
  var MIN_BEATS_FREQ = 20;   // below this, don't attempt a spectrum

  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function std(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = 0, i;
    for (i = 0; i < a.length; i++) { var d = a[i] - m; s += d * d; }
    return Math.sqrt(s / (a.length - 1));
  }

  function nextPow2AtMost(n) { var p = 1; while (p * 2 <= n) p *= 2; return p; }

  // radix-2 FFT (in-place complex)
  function fft(re, im) {
    var n = re.length, i, j = 0, k, m;
    for (i = 0; i < n - 1; i++) {
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
      k = n >> 1; while (k <= j) { j -= k; k >>= 1; } j += k;
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (m = 0; m < len / 2; m++) {
          var a = i + m, b = i + m + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Reject physiologically impossible R-R before any stats (contact glitches).
  function cleanRR(rr) {
    var out = [], i;
    for (i = 0; i < rr.length; i++) {
      var v = rr[i];
      if (v == null || !isFinite(v)) continue;
      if (v < 273 || v > 2000) continue;                 // ~30-220 bpm
      if (out.length && Math.abs(v - out[out.length - 1]) / out[out.length - 1] > 0.33) continue; // impossible jump
      out.push(v);
    }
    return out;
  }

  function timeDomain(rr) {
    if (rr.length < MIN_BEATS_TIME) return null;
    var diffs = [], nn50 = 0, i;
    for (i = 1; i < rr.length; i++) {
      var d = rr[i] - rr[i - 1];
      diffs.push(d);
      if (Math.abs(d) > 50) nn50++;
    }
    var sq = 0;
    for (i = 0; i < diffs.length; i++) sq += diffs[i] * diffs[i];
    var rmssd = diffs.length ? Math.sqrt(sq / diffs.length) : 0;
    var m = mean(rr);
    return {
      nBeats: rr.length,
      meanRR: +m.toFixed(1),
      meanHR: +(60000 / m).toFixed(1),
      sdnn: +std(rr).toFixed(1),
      rmssd: +rmssd.toFixed(1),
      pnn50: +(diffs.length ? (nn50 / diffs.length) * 100 : 0).toFixed(1)
    };
  }

  // Even-sampled tachogram -> spectrum. Resample instantaneous R-R at `fsHz`
  // over a bounded recent window so cost stays flat on long sessions.
  function freqDomain(rr, opts) {
    opts = opts || {};
    if (rr.length < MIN_BEATS_FREQ) return null;
    var fsHz = opts.resampleHz || 2;         // 2 Hz is ample below the 0.4 Hz HF ceiling
    var maxSec = opts.windowSec || 256;      // cap the window (~4 min)

    // beat times (s) from cumulative R-R
    var t = [0], i;
    for (i = 0; i < rr.length; i++) t.push(t[i] + rr[i] / 1000);
    var totalSpan = t[t.length - 1];
    var startT = Math.max(0, totalSpan - maxSec);

    // linear-interpolate instantaneous R-R onto an even grid
    var grid = [], ti = startT, bi = 0;
    while (ti <= totalSpan && grid.length < 4096) {
      while (bi < rr.length - 1 && t[bi + 1] < ti) bi++;
      grid.push(rr[Math.min(bi, rr.length - 1)]);
      ti += 1 / fsHz;
    }
    var N = nextPow2AtMost(grid.length);
    if (N < 32) return null;
    var seg = grid.slice(grid.length - N);
    var gm = mean(seg);
    var re = new Array(N), im = new Array(N), winPow = 0;
    for (i = 0; i < N; i++) {
      var w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));   // Hann
      re[i] = (seg[i] - gm) * w; im[i] = 0; winPow += w * w;
    }
    fft(re, im);
    var half = N >> 1, freqs = [], power = [];
    var norm = 1 / (fsHz * winPow);
    for (i = 0; i <= half; i++) {
      var p = (re[i] * re[i] + im[i] * im[i]) * norm;
      if (i > 0 && i < half) p *= 2;
      freqs.push(i * fsHz / N); power.push(p);
    }

    function bandP(lo, hi) { var s = 0, k; for (k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) s += power[k]; return s; }
    var lf = bandP(0.04, 0.15), hf = bandP(0.15, 0.40), vlf = bandP(0.0033, 0.04);

    // Coherence (HeartMath-style): find the dominant peak in 0.04-0.26 Hz,
    // take the power in a narrow +/-0.03 Hz window around it, over total.
    var peakF = 0.1, peakP = -1, k;
    for (k = 0; k < freqs.length; k++) {
      if (freqs[k] >= 0.04 && freqs[k] <= 0.26 && power[k] > peakP) { peakP = power[k]; peakF = freqs[k]; }
    }
    var peakWin = bandP(peakF - 0.03, peakF + 0.03);
    var totalBand = bandP(0.04, 0.4) || 1e-12;
    var coherence = peakWin / totalBand;             // 0..1
    var coherenceRatio = peakWin / ((totalBand - peakWin) || 1e-12);

    return {
      lf: +lf.toFixed(2), hf: +hf.toFixed(2), vlf: +vlf.toFixed(2),
      lfhf: +(lf / (hf || 1e-12)).toFixed(3),
      peakHz: +peakF.toFixed(3),
      coherence: +coherence.toFixed(3),
      coherenceRatio: +coherenceRatio.toFixed(3)
    };
  }

  // One-shot: full HRV report from a raw R-R array (ms).
  function analyze(rrRaw, opts) {
    var rr = cleanRR(rrRaw || []);
    var td = timeDomain(rr);
    var fd = freqDomain(rr, opts);
    return {
      nBeatsRaw: (rrRaw || []).length,
      nBeatsClean: rr.length,
      time: td,
      freq: fd,
      // convenience top-level for the UI
      meanHR: td ? td.meanHR : null,
      rmssd: td ? td.rmssd : null,
      coherence: fd ? fd.coherence : null
    };
  }

  var API = { analyze: analyze, cleanRR: cleanRR, timeDomain: timeDomain, freqDomain: freqDomain,
              MIN_BEATS_TIME: MIN_BEATS_TIME, MIN_BEATS_FREQ: MIN_BEATS_FREQ };

  global.HRVAnalysis = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);

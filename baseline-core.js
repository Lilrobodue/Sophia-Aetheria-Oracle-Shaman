/* ============================================================================
 * baseline-core.js — Sophia Aetheria Oracle
 * Personal neural baseline persistence for divination-core.js state mode.
 *
 * Load AFTER divination-core.js, BEFORE the main inline script:
 *   <script src="./divination-core.js"></script>
 *   <script src="./baseline-core.js"></script>
 *
 * Exposes: window.BaselineMath   (pure functions — no IDB, no DOM, fully testable)
 *          window.BaselineStore  (thin IndexedDB adapter over SophiaOracleDB v3)
 *          window.Baseline       (glue: getBaselineFor / recordCast / reports)
 *
 * DESIGN CONTRACT
 *   1. Baselines are keyed by device AND montage. Athena's 8 channels and Muse 2's
 *      4 do not produce comparable band-power scaling. Never pool across them.
 *   2. Hierarchical fallback, always reported, never silent:
 *        device+timeBin -> device pooled -> within-cast median (not personal)
 *   3. Only derived scalars are stored. No raw EEG ever touches the disk.
 *   4. Drift is reported to the human, never auto-corrected. Code cannot tell a
 *      new headband fit from a genuine change in the person.
 * ========================================================================= */
(function (global) {
'use strict';

const SCHEMA = 1;

/* ========================================================== PURE MATH ==== */

const median = arr => { const s = [...arr].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

const quantile = (arr, q) => { const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo); };

const iqr = arr => { const q1 = quantile(arr, 0.25), q3 = quantile(arr, 0.75);
  return (q1 == null) ? null : q3 - q1; };

/* Common-language effect size (Vargha-Delaney A12): the probability that a
 * randomly drawn value from A exceeds one from B, ties counted as half.
 * 0.5 = the two samples are indistinguishable. Distribution-free, no deps. */
function a12(A, B) {
  if (!A.length || !B.length) return null;
  let gt = 0, eq = 0;
  A.forEach(a => B.forEach(b => { if (a > b) gt++; else if (a === b) eq++; }));
  return (gt + 0.5 * eq) / (A.length * B.length);
}

/* ---------------------------------------------------------- time binning */
/* Fixed clock quarters are the default, but they are wrong for a vampire
 * schedule — they will slice one waking period across two bins. Pass custom
 * boundaries (hours, ascending, 0-23) matching when you actually get up. */
const BIN_SCHEMES = {
  none:    { boundaries: [], labels: ['all'] },
  quarter: { boundaries: [0, 6, 12, 18] },
  sixth:   { boundaries: [0, 4, 8, 12, 16, 20] }
};

function timeBinFor(date, scheme) {
  const s = (typeof scheme === 'string') ? BIN_SCHEMES[scheme] : scheme;
  if (!s || !s.boundaries || !s.boundaries.length) return 'all';
  const h = new Date(date).getHours();
  // Boundaries are a circular partition of the clock, so they must be sorted
  // before interval lookup and the pre-first-boundary hours wrap into the last
  // bin. Passing [16,22,4,10] for a 16:00 wake time has to work.
  const b = [...s.boundaries].map(Number).sort((x, y) => x - y);
  let i = b.length - 1;                       // default: wrap into the last interval
  for (let k = 0; k < b.length; k++) if (h >= b[k]) i = k;
  const start = b[i], end = b[(i + 1) % b.length];
  const pad = n => String(n).padStart(2, '0');
  return pad(start) + '-' + pad(end);
}

/* Bucket identity. Montage is part of the key, not metadata — see contract §1. */
const bucketKey = (deviceId, montage, timeBin) =>
  [deviceId || 'unknown', 'ch' + (montage || 0), timeBin || 'all'].join('|');

/* ------------------------------------------------ per-cast summarisation */
/* Takes the six per-line window stats that divination-core already computes
 * ({mean, cv} each) and reduces them to the scalars a baseline needs. */
function summarizeWindows(windows, meta) {
  const means = windows.map(w => w.mean).filter(v => typeof v === 'number');
  const cvs   = windows.map(w => w.cv).filter(v => typeof v === 'number');
  if (means.length < 6 || cvs.length < 6) return { error: 'need six windows' };
  const m = meta || {};
  return {
    schema: SCHEMA,
    timestamp: m.timestamp || Date.now(),
    deviceId: m.deviceId || 'unknown',
    montage: m.montage || 0,
    timeBin: m.timeBin || 'all',
    bucket: bucketKey(m.deviceId, m.montage, m.timeBin),
    windowMeans: means.map(v => +v.toFixed(5)),
    windowCVs: cvs.map(v => +v.toFixed(5)),
    castArousal: +median(means).toFixed(5),
    castCV: +median(cvs).toFixed(5),
    framesUsed: m.framesUsed || 0,
    meanQuality: m.meanQuality == null ? null : +m.meanQuality.toFixed(3)
  };
}

/* ------------------------------------------------------ baseline selection */
/* Bounded rolling window: exact median over the most recent `windowSize`
 * entries. Bounded on purpose — it keeps the median cheap AND lets the baseline
 * track slow genuine drift instead of being anchored to your first month. */
function selectBaseline(entries, opts) {
  const o = Object.assign({
    deviceId: null, montage: null, timeBin: null,
    minSamplesBinned: 12,      // before a time-bin-specific baseline is trusted
    minSamplesPooled: 8,       // before any personal baseline is trusted
    windowSize: 40,
    now: Date.now()
  }, opts || {});

  const sameDevice = entries.filter(e =>
    e.deviceId === o.deviceId && String(e.montage) === String(o.montage));

  const binned = o.timeBin && o.timeBin !== 'all'
    ? sameDevice.filter(e => e.timeBin === o.timeBin) : [];

  const recent = arr => [...arr].sort((a, b) => b.timestamp - a.timestamp).slice(0, o.windowSize);

  let chosen = null, source = 'insufficient', pool = [];
  if (binned.length >= o.minSamplesBinned)          { pool = recent(binned);     source = 'device+bin'; }
  else if (sameDevice.length >= o.minSamplesPooled) { pool = recent(sameDevice); source = 'device-pooled'; }

  if (pool.length) {
    // The arousal pivot is the median of past cast-level arousal: "am I more
    // activated than I usually am". The CV pivot is the 75th percentile of every
    // past WINDOW cv, not a multiple of the median — see BRIEF §5. A quantile is
    // self-calibrating: at your own baseline it yields ~1.5 changing lines per
    // cast, which is what yarrow averages, and it moves when today is genuinely
    // more unstable than your normal.
    const allWindowCVs = pool.reduce((a, e) => a.concat(e.windowCVs || [e.castCV]), []);
    chosen = {
      baseline:   median(pool.map(e => e.castArousal)),
      baselineCV: median(pool.map(e => e.castCV)),
      cvPivot:    quantile(allWindowCVs, 0.75)
    };
  }

  return {
    ready: !!chosen,
    source,
    baseline:   chosen ? +chosen.baseline.toFixed(5)   : null,
    baselineCV: chosen ? +chosen.baselineCV.toFixed(5) : null,
    cvPivot:    chosen ? +chosen.cvPivot.toFixed(5)    : null,
    n: pool.length,
    nSameDevice: sameDevice.length,
    nSameBin: binned.length,
    maturity: {
      towardPooled: Math.min(1, sameDevice.length / o.minSamplesPooled),
      towardBinned: o.timeBin && o.timeBin !== 'all'
        ? Math.min(1, binned.length / o.minSamplesBinned) : null,
      needForPooled: Math.max(0, o.minSamplesPooled - sameDevice.length),
      needForBinned: o.timeBin && o.timeBin !== 'all'
        ? Math.max(0, o.minSamplesBinned - binned.length) : null
    },
    spread: pool.length ? {
      arousalIQR: +iqr(pool.map(e => e.castArousal)).toFixed(5),
      cvIQR:      +iqr(pool.map(e => e.castCV)).toFixed(5)
    } : null,
    note: chosen
      ? 'Personal baseline from ' + source + ' (' + pool.length + ' casts).'
      : 'Not enough history on this device yet — state mode will fall back to the '
        + 'within-cast median, which measures relative balance inside one reading '
        + 'rather than how you compare to yourself.'
  };
}

/* ------------------------------------------------------------------ drift */
/* Compare the most recent `recentN` casts against the `priorN` before them.
 * Shift is expressed in IQRs of the prior window so it is scale-free. This
 * flags for a human; it never rewrites anything. */
function driftReport(entries, opts) {
  const o = Object.assign({ recentN: 10, priorN: 20, flagAtIQRs: 1.0 }, opts || {});
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  if (sorted.length < o.recentN + o.priorN) {
    return { ready: false, need: o.recentN + o.priorN - sorted.length,
             note: 'Not enough history to assess drift yet.' };
  }
  const recent = sorted.slice(0, o.recentN).map(e => e.castArousal);
  const prior  = sorted.slice(o.recentN, o.recentN + o.priorN).map(e => e.castArousal);
  const spread = iqr(prior) || 1e-9;
  const shift = (median(recent) - median(prior)) / spread;
  return {
    ready: true,
    recentMedian: +median(recent).toFixed(5),
    priorMedian:  +median(prior).toFixed(5),
    shiftInIQRs:  +shift.toFixed(3),
    separation:   +a12(recent, prior).toFixed(3),
    flagged: Math.abs(shift) >= o.flagAtIQRs,
    direction: shift > 0 ? 'more activated' : 'less activated',
    note: Math.abs(shift) >= o.flagAtIQRs
      ? 'Your recent baseline has moved. This could be a new headband fit, a changed '
        + 'electrode position, a seasonal or schedule change, or a real change in you. '
        + 'The code cannot tell which. Nothing has been reset.'
      : 'Baseline stable within normal spread.'
  };
}

/* ----------------------------------------------- does time-of-day matter? */
/* The empirical answer to "might be nothing, the logs will say". Reports each
 * bin's median and spread plus pairwise A12 separation. Interpretation:
 *   A12 ~0.50  bins are indistinguishable, don't bin
 *   A12 ~0.56  small, probably not worth the sample-size cost
 *   A12 >=0.64 real separation, binning earns its keep                       */
function binReport(entries, opts) {
  const o = Object.assign({ minPerBin: 10, meaningfulA12: 0.64 }, opts || {});
  const byBin = {};
  entries.forEach(e => { (byBin[e.timeBin] = byBin[e.timeBin] || []).push(e.castArousal); });

  const bins = Object.entries(byBin).map(([bin, vals]) => ({
    bin, n: vals.length,
    median: +median(vals).toFixed(5),
    iqr: vals.length > 1 ? +iqr(vals).toFixed(5) : null,
    reportable: vals.length >= o.minPerBin
  })).sort((a, b) => a.bin.localeCompare(b.bin));

  const pairs = [];
  const usable = bins.filter(b => b.reportable).map(b => b.bin);
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const v = a12(byBin[usable[i]], byBin[usable[j]]);
      // a12 is directional (P(a > b)); `separation` is the symmetric magnitude.
      pairs.push({ a: usable[i], b: usable[j], a12: +v.toFixed(3),
                   separation: Math.abs(v - 0.5) * 2,
                   meaningful: Math.abs(v - 0.5) + 0.5 >= o.meaningfulA12 });
    }
  }
  const anyMeaningful = pairs.some(p => p.meaningful);
  return {
    bins, pairs,
    verdict: !usable.length ? 'insufficient'
      : anyMeaningful ? 'bin-worthwhile' : 'pooling-fine',
    note: !usable.length
      ? 'Need at least ' + o.minPerBin + ' casts in two or more bins before this means anything.'
      : anyMeaningful
        ? 'At least one pair of time bins separates meaningfully. Time-of-day binning is '
          + 'earning its keep — but check the boundaries match your actual waking hours.'
        : 'No bin pair separates meaningfully. Pool across time of day and keep the larger '
          + 'sample; revisit if the picture changes.'
  };
}

const BaselineMath = { median, quantile, iqr, a12, BIN_SCHEMES, timeBinFor, bucketKey,
  summarizeWindows, selectBaseline, driftReport, binReport, SCHEMA };

/* ================================================== INDEXEDDB ADAPTER ====
 * Adds a `neuralBaselines` store to the existing SophiaOracleDB. The app's
 * onupgradeneeded already guards every store with `if (!contains(...))`, so
 * bumping the version to 3 and adding one block is safe for existing users.
 * ======================================================================= */
const STORE = 'neuralBaselines';

function ensureStore(idb) {
  /* Called from inside onupgradeneeded. See BRIEF §2 for the exact edit. */
  if (!idb.objectStoreNames.contains(STORE)) {
    const s = idb.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    s.createIndex('bucket', 'bucket', { unique: false });
    s.createIndex('deviceId', 'deviceId', { unique: false });
    s.createIndex('timestamp', 'timestamp', { unique: false });
  }
}

function tx(db, mode) { return db.transaction([STORE], mode).objectStore(STORE); }
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const BaselineStore = {
  STORE, ensureStore,
  available: db => !!(db && db.objectStoreNames && db.objectStoreNames.contains(STORE)),
  async put(db, entry) { return req(tx(db, 'readwrite').add(entry)); },
  async allForDevice(db, deviceId) {
    if (!deviceId) return req(tx(db, 'readonly').getAll());
    return req(tx(db, 'readonly').index('deviceId').getAll(deviceId));
  },
  async all(db) { return req(tx(db, 'readonly').getAll()); },
  async count(db) { return req(tx(db, 'readonly').count()); },
  async clear(db, deviceId) {
    if (!deviceId) {                          // always return a count, not undefined
      const n = await this.count(db);
      await req(tx(db, 'readwrite').clear());
      return n;
    }
    const rows = await this.allForDevice(db, deviceId);
    const store = tx(db, 'readwrite');
    await Promise.all(rows.map(r => req(store.delete(r.id))));
    return rows.length;
  },
  async exportJSON(db) {
    const rows = await this.all(db);
    return JSON.stringify({ exported: new Date().toISOString(), schema: SCHEMA,
      app: 'Sophia Aetheria Oracle', count: rows.length, entries: rows }, null, 2);
  }
};

/* ============================================================== GLUE ==== */
const DEFAULTS = {
  binScheme: 'quarter',        // override with custom boundaries for a vampire schedule
  minSamplesPooled: 8,
  minSamplesBinned: 12,
  windowSize: 40,
  minQualityToRecord: 0.6      // stricter than casting — bad frames poison a baseline
};

const Baseline = {
  config: Object.assign({}, DEFAULTS),
  _cache: null,

  configure(patch) { Object.assign(this.config, patch || {}); this._cache = null; return this.config; },

  deviceIdentity() {
    /* Derive from the live EEG integration. Montage is the channel count, which
     * is what actually determines band-power scaling. */
    const eeg = global.eegIntegration || {};
    const method = eeg.lastConnectionMethod || 'unknown';
    const montage = eeg.channelCount || (method === 'athena' ? 8 : method === 'unknown' ? 0 : 4);
    return { deviceId: method, montage };
  },

  async load(db) {
    if (!BaselineStore.available(db)) return [];
    if (this._cache) return this._cache;
    const { deviceId } = this.deviceIdentity();
    this._cache = await BaselineStore.allForDevice(db, deviceId);
    return this._cache;
  },

  /* Call before a state-mode cast. Returns {baseline, baselineCV} to hand to
   * castIChing, plus everything needed to render an honest provenance line. */
  async getBaselineFor(db, when) {
    const { deviceId, montage } = this.deviceIdentity();
    const timeBin = timeBinFor(when || Date.now(), this.config.binScheme);
    const entries = await this.load(db);
    const sel = selectBaseline(entries, {
      deviceId, montage, timeBin,
      minSamplesPooled: this.config.minSamplesPooled,
      minSamplesBinned: this.config.minSamplesBinned,
      windowSize: this.config.windowSize
    });
    return Object.assign(sel, { deviceId, montage, timeBin });
  },

  /* Call after any EEG cast, whichever mode was used — entropy casts still
   * produce perfectly good window statistics, and throwing them away just
   * makes the baseline take longer to mature. */
  async recordCast(db, windows, meta) {
    if (!BaselineStore.available(db)) return { recorded: false, reason: 'store unavailable' };
    const m = meta || {};
    if (m.meanQuality != null && m.meanQuality < this.config.minQualityToRecord) {
      return { recorded: false, reason: 'signal quality ' + m.meanQuality.toFixed(2)
               + ' below record threshold ' + this.config.minQualityToRecord };
    }
    const { deviceId, montage } = this.deviceIdentity();
    if (deviceId === 'unknown' || !montage) {
      return { recorded: false, reason: 'no identified device — refusing to pool unknown montages' };
    }
    const entry = summarizeWindows(windows, Object.assign({}, m, {
      deviceId, montage, timeBin: timeBinFor(m.timestamp || Date.now(), this.config.binScheme)
    }));
    if (entry.error) return { recorded: false, reason: entry.error };
    const id = await BaselineStore.put(db, entry);
    this._cache = null;
    return { recorded: true, id, bucket: entry.bucket,
             castArousal: entry.castArousal, castCV: entry.castCV };
  },

  async drift(db) { return driftReport(await this.load(db)); },
  async bins(db)  { return binReport(await this.load(db)); },

  async status(db) {
    const sel = await this.getBaselineFor(db);
    const [d, b] = [await this.drift(db), await this.bins(db)];
    return { baseline: sel, drift: d, timeOfDay: b,
      provenanceLine: sel.ready
        ? sel.source.replace('device+bin', 'personal baseline, ' + sel.timeBin)
              .replace('device-pooled', 'personal baseline') + ' · ' + sel.n + ' casts · ' + sel.deviceId
        : 'within-cast median · ' + sel.maturity.needForPooled + ' more casts to personal baseline' };
  },

  async exportJSON(db) { return BaselineStore.exportJSON(db); },
  async reset(db, deviceOnly) {
    const { deviceId } = this.deviceIdentity();
    const n = await BaselineStore.clear(db, deviceOnly ? deviceId : null);
    this._cache = null;
    return { cleared: n };
  }
};

/* -------------------------------------------------------------- exports */
global.BaselineMath = BaselineMath;
global.BaselineStore = BaselineStore;
global.Baseline = Baseline;
if (typeof module !== 'undefined' && module.exports)
  module.exports = { BaselineMath, BaselineStore, Baseline };

})(typeof window !== 'undefined' ? window : globalThis);

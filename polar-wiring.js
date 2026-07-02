/*
 * polar-wiring.js — bridges the Polar H10 driver into the Sophia app
 * ------------------------------------------------------------------
 * The H10 driver (polar-h10.js) publishes to the shared event bus. The rest of
 * Sophia is classic scripts, so this is a classic script too (no ES-module
 * import/export — those break under file://). This is the glue:
 *
 *   - instantiates PolarH10 with window.AetheriaBus
 *   - subscribes to 'Aetheria_RR' and 'Aetheria_State'
 *   - makes the H10 the heart-rate source (with Athena PPG as fallback)
 *   - accumulates R-R for HRV (window.HRVAnalysis) and for signal provenance
 *     (window.AetheriaSignal — makeProcessor('polar_h10'))
 *   - runs the calibration GATE over the first ~20 s of beats
 *   - exposes window.connectPolarH10 / disconnectPolarH10 for the UI
 *   - publishes window.PolarState, which the session export reads
 *
 * Honesty: R-R is captured raw and passed through the provenance processor,
 * which caps interpolation and marks true dropouts as gaps (never filled).
 */
(function () {
'use strict';

var PolarH10 = window.PolarH10;
if (!PolarH10) { console.error('polar-wiring: PolarH10 driver not loaded (check polar-h10.js loads first)'); return; }

var bus = window.AetheriaBus;
if (!bus) { console.error('polar-wiring: AetheriaBus not loaded'); return; }

var FRESH_MS = 5000;          // H10 HR counts as "current" for this long
var CALIB_WINDOW_MS = 20000;  // gather beats this long, then run the gate

var h10 = new PolarH10(bus);

var State = {
  connected: false,
  status: 'disconnected',
  lastHR: null,
  lastHRt: 0,
  sessionRR: [],            // all accepted R-R (ms) this session — raw, sacred
  _calibRR: [],
  _calibStart: 0,
  calibration: null,        // CalibrationResult from the gate
  hrv: null,                // latest HRVAnalysis.analyze() result
  processor: null,          // AetheriaSignal polar_h10 processor
  _lastHrvAt: 0,

  isFresh: function () { return this.connected && this.lastHR != null && (now() - this.lastHRt) < FRESH_MS; },

  reset: function () {
    this.sessionRR = []; this._calibRR = []; this._calibStart = 0;
    this.calibration = null; this.hrv = null; this._lastHrvAt = 0;
    this.processor = (window.AetheriaSignal && window.AetheriaSignal.makeProcessor)
      ? window.AetheriaSignal.makeProcessor('polar_h10', { streamId: 'polar' })
      : null;
  },

  // Snapshot for the JSON session export.
  exportBlock: function () {
    return {
      source: 'polar_h10',
      lastHR: this.lastHR,
      beats: this.sessionRR.length,
      hrv: this.hrv ? { time: this.hrv.time, freq: this.hrv.freq } : null
    };
  },
  finalizeProvenance: function () { return this.processor ? this.processor.finalize() : null; }
};

function now() {
  // performance.now() is monotonic; fall back to a counter-free constant base.
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : State._tick++;
}
State._tick = 0;

// ── Heart-rate + R-R stream ────────────────────────────────────────────────
bus.subscribe('Aetheria_RR', function (p) {
  if (!p) return;

  if (p.hr_bpm != null && p.hr_bpm > 0) {
    State.lastHR = p.hr_bpm;
    State.lastHRt = now();
    updateHRDisplay(p.hr_bpm, h10.contactQuality);
  }

  if (p.rr_ms != null && isFinite(p.rr_ms)) {
    State.sessionRR.push(p.rr_ms);
    if (State.processor) State.processor.push({ rr: p.rr_ms });

    // Calibration gate: collect the opening window, then judge once.
    if (!State.calibration) {
      if (!State._calibStart) State._calibStart = now();
      State._calibRR.push(p.rr_ms);
      if (now() - State._calibStart >= CALIB_WINDOW_MS && State._calibRR.length >= 8) {
        runGate();
      }
    }

    // Recompute HRV at most ~once/sec (cheap, but no need to thrash).
    if (window.HRVAnalysis && (now() - State._lastHrvAt) > 1000) {
      State._lastHrvAt = now();
      State.hrv = window.HRVAnalysis.analyze(State.sessionRR);
      updateHRVDisplay(State.hrv);
    }
  }
});

// ── Status / lifecycle ──────────────────────────────────────────────────────
bus.subscribe('Aetheria_State', function (p) {
  if (!p) return;
  if (p.type === 'sensor_status' && p.sensor && p.sensor.indexOf('Polar') !== -1) {
    State.status = p.status;
    State.connected = (p.status === 'streaming');
    updateStatusUI(p.status);
  }
  if (p.type === 'log' && p.logType === 'error') {
    console.warn(p.message);
  }
});

function runGate() {
  if (!window.AetheriaSignal) return;
  State.calibration = window.AetheriaSignal.calibrate('polar_h10', { rr: State._calibRR }, {});
  var el = document.getElementById('polarGate');
  if (el) {
    if (State.calibration.passed) {
      el.style.color = '#00ff88';
      el.textContent = 'Signal check: passed (' + (State.calibration.metrics.meanBpm || '—') + ' bpm)';
    } else {
      el.style.color = '#ffaa00';
      el.textContent = 'Signal check: ' + (State.calibration.reasons[0] || 'unstable') +
                       (State.calibration.fixes && State.calibration.fixes[0] ? ' — ' + State.calibration.fixes[0] : '');
    }
    el.style.display = 'block';
  }
}

// ── DOM helpers (all guarded — this module never assumes an element exists) ──
function updateHRDisplay(bpm, sqi) {
  var color = sqi >= 1 ? '#00ff88' : sqi > 0 ? '#ffaa00' : '#ff0055';
  // Update BOTH the always-visible Heart/HRV section (polarHr*) and the Athena
  // panel's shared HR readout (heartRate*) — whichever is on screen shows it.
  ['polarHrValue', 'heartRateValue'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.textContent = bpm + ' BPM';
  });
  ['polarHrSqi', 'heartRateSqi'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.style.color = color;
  });
}

function updateHRVDisplay(hrv) {
  var el = document.getElementById('polarHRV');
  if (!el) return;
  if (hrv && hrv.time) {
    var parts = ['RMSSD ' + hrv.time.rmssd + ' ms', 'SDNN ' + hrv.time.sdnn + ' ms'];
    if (hrv.freq) parts.push('coherence ' + hrv.freq.coherence);
    el.textContent = parts.join(' · ');
    el.style.display = 'block';
  }
}

function updateStatusUI(status) {
  var btn = document.getElementById('polarConnectBtn');
  var stat = document.getElementById('polarStatus');
  var label = { disconnected: '❤️ Connect Polar H10', connecting: '⏳ Connecting…',
                streaming: '❤️ H10 Connected', error: '⚠️ H10 Error' }[status] || '❤️ Connect Polar H10';
  if (btn) btn.textContent = label;
  if (stat) {
    stat.textContent = 'Polar H10: ' + status;
    stat.style.color = status === 'streaming' ? '#00ff88' : status === 'error' ? '#ff6b9d' : '#888';
  }
  // On disconnect, clear the H10's own HR readout (leave the Athena panel's alone).
  if (status === 'disconnected' || status === 'error') {
    var hr = document.getElementById('polarHrValue'); if (hr) hr.textContent = '— BPM';
    var sq = document.getElementById('polarHrSqi'); if (sq) sq.style.color = '#888';
  }
}

// ── Public API for the UI ───────────────────────────────────────────────────
window.connectPolarH10 = async function () {
  try {
    State.reset();
    await h10.connect();
  } catch (e) {
    console.warn('Polar H10 connect failed:', e && e.message);
  }
};
window.disconnectPolarH10 = async function () {
  try { await h10.disconnect(); } catch (e) {}
};
window.PolarState = State;
window.PolarH10Device = h10;

})();

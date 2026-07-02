/*
 * aetheria-bus.js — tiny synchronous event bus for Aetheria sensors
 * ------------------------------------------------------------------
 * The sensor drivers (sensor-base.js, polar-h10.js) are written against a
 * `bus` with .publish(topic, payload). This is that bus: a minimal
 * publish/subscribe hub so ES-module drivers and the classic-script app can
 * talk without importing each other.
 *
 * Topics in use:
 *   'Aetheria_RR'    { rr_ms, hr_bpm, source }          — heart beat / R-R
 *   'Aetheria_State' { type:'sensor_status'|'log', ... } — lifecycle + logs
 *
 * Pure, dependency-free. Exposes window.AetheriaBus (and module.exports).
 */
(function (global) {
  'use strict';

  function EventBus() {
    this._subs = Object.create(null);
  }

  EventBus.prototype.subscribe = function (topic, cb) {
    if (!this._subs[topic]) this._subs[topic] = [];
    this._subs[topic].push(cb);
    var subs = this._subs[topic];
    return function unsubscribe() {
      var i = subs.indexOf(cb);
      if (i !== -1) subs.splice(i, 1);
    };
  };

  EventBus.prototype.publish = function (topic, payload) {
    var subs = this._subs[topic];
    if (!subs) return;
    // iterate a copy so a handler that (un)subscribes mid-dispatch is safe
    var snapshot = subs.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try { snapshot[i](payload); }
      catch (e) { if (global.console) console.error('AetheriaBus handler error on "' + topic + '":', e); }
    }
  };

  // A single shared instance is what the app wires against.
  var bus = new EventBus();
  bus.EventBus = EventBus; // constructor exposed for tests / extra buses

  global.AetheriaBus = bus;
  if (typeof module !== 'undefined' && module.exports) module.exports = bus;

})(typeof globalThis !== 'undefined' ? globalThis : this);

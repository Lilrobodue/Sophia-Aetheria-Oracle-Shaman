# Sophia Resonance Placement Port — Claude Code Implementation Prompt

**Author:** Selah (with the Lewis family)
**Date:** June 2026
**Target:** Sophia (aetheriasos.com) — EEG placement engine (Muse S Athena, 8-channel + fNIRS + PPG)
**Source of truth:** Aetheria RCT (`index.html`, v2.0) — continuous resonance placement
**Purpose:** Replace Sophia's current (stuck) placement with the RCT's continuous, data-driven resonance score, so the prescribed Aetheria frequency tracks brain state smoothly across all 27 positions instead of parking.

---

## Context — the problem being fixed

Sophia maps live brain data → one of 27 Aetheria positions (GUT 1–9, HEART 1–9, HEAD 1–9), then sonifies that frequency. Observed behavior: **the frequency gets stuck** — it parks in a few low positions (last session: 1, 3, 11), never climbs, and stays stuck *even with clean sensor contact*. That last fact is important: it rules out signal quality as the sole cause and points at the placement logic itself.

The RCT app runs on the same Muse/Athena hardware class and does **not** have this problem, because it does not use a state/bucket mapping. It computes a **continuous resonance score** directly from the brain data and maps it across the full 0–26 range. This task ports that approach into Sophia.

A bucket or state-machine mapping parks by design — it can only sit in whichever discrete state it last latched. A continuous score physically cannot park unless its inputs are frozen. That distinction drives Step 0.

---

## Step 0 — Diagnose before you port (do not skip)

Because the family reports the frequency is stuck *regardless of contact quality*, first confirm **where** it is stuck. There are three independent failure points; verify which one(s) are in play, because the resonance-formula port only fixes the second.

1. **Inputs frozen.** Add a temporary log of the live band powers (delta/theta/alpha/beta/gamma) and the coherence value on every update. Watch them for ~30 s of real signal. *Are they actually changing over time?* If they are flat or NaN, the problem is upstream in the data pipeline (parsing, normalization, a stale buffer) and **the formula port will not fix it** — fix the input first.
2. **Mapping stuck.** If the inputs change but the position does not move with them, the current placement function is the culprit — almost certainly a bucket/state machine or a hard clamp. **This is what the port replaces.**
3. **Output not wired.** If the computed position *does* change but the audio frequency does not follow, the placement→oscillator link is broken. Fix the wiring; the formula won't matter until the output tracks the position.

Report which of the three (or which combination) you find. Proceed with the port for case 2; flag cases 1 and 3 to Joseph with what you found.

---

## The reference algorithm (verified from the RCT codebase)

The RCT computes a single continuous score from averaged brain data, then maps it to position 0–26:

```javascript
// From Aetheria RCT index.html — the canonical placement
const resonanceScore =
  avgBands.alpha * 0.30 +   // alpha  = awareness
  avgBands.theta * 0.25 +   // theta  = depth
  avgBands.gamma * 0.10 +   // gamma  = integration
  avgCoh         * 0.35;    // coherence = field organization (weighted highest)

const pos = Math.round(Math.min(26, Math.max(0, resonanceScore * 26 / 0.35)));
```

Four properties make this behave (and they are the real transfer — not just the one line):

- **Continuous composite, not a bucket.** Position is a smooth weighted blend, so it slides across all 27 rather than latching.
- **Range rescale (`* 26 / 0.35`).** Raw band powers are small fractions; the divisor stretches realistic values across the whole 0–26 spectrum instead of bunching them at the floor. **This is the single most likely reason Sophia parks low — see the Calibration section, this number is not universal.**
- **Averaged, not instantaneous.** The RCT builds the score from a windowed average (a 15-second "signature"), which removes most jitter.
- **Data-driven.** Computed from raw brain data, deliberately *not* from a prescription/state engine ("can't be gamed").

---

## Implementation

### Step 1 — Locate the moving parts in Sophia
Find and read, before changing anything:
- the function that currently computes the position / prescription (the thing to replace),
- where the band powers and the coherence value come from (the inputs),
- the 27-frequency table (ordered array), and
- the audio/oscillator driver that the position feeds.

### Step 2 — Add the canonical placement function
Drop in a pure function. **Do not redefine the frequencies** — Sophia already has an authoritative 27-entry table; this returns an index into it.

```javascript
/**
 * Canonical Aetheria resonance placement (ported from the RCT).
 * Maps live brain data to a continuous position 0–26 across the 27 frequencies.
 * Data-driven — NOT a state bucket.
 *
 * @param {{alpha:number, theta:number, gamma:number}} bands - normalized band powers (0–1)
 * @param {number} coherence - field coherence (0–1)
 * @param {number} [rescale=0.35] - calibration divisor; TUNE to Sophia's value range (see Calibration)
 * @returns {{score:number, position:number}}
 */
function resonancePosition(bands, coherence, rescale = 0.35) {
  const score =
    (bands.alpha || 0) * 0.30 +
    (bands.theta || 0) * 0.25 +
    (bands.gamma || 0) * 0.10 +
    (coherence    || 0) * 0.35;
  const position = Math.round(Math.min(26, Math.max(0, score * 26 / rescale)));
  return { score, position };
}
```

### Step 3 — Smooth it (window, don't react)
Feed it a rolling average so placement reflects a window, not one noisy frame.

```javascript
// Rolling-average smoother. windowSamples ~ 5–15 s worth of updates for your sample rate.
class ResonanceSmoother {
  constructor(windowSamples = 30) { this.win = windowSamples; this.buf = []; }
  push(bands, coherence) {
    this.buf.push({ alpha: bands.alpha||0, theta: bands.theta||0, gamma: bands.gamma||0, coherence: coherence||0 });
    if (this.buf.length > this.win) this.buf.shift();
  }
  current(rescale = 0.35) {
    if (!this.buf.length) return { score: 0, position: 0 };
    const n = this.buf.length;
    const a = this.buf.reduce((acc, s) => ({
      alpha: acc.alpha + s.alpha, theta: acc.theta + s.theta,
      gamma: acc.gamma + s.gamma, coherence: acc.coherence + s.coherence
    }), { alpha:0, theta:0, gamma:0, coherence:0 });
    return resonancePosition(
      { alpha:a.alpha/n, theta:a.theta/n, gamma:a.gamma/n },
      a.coherence/n, rescale
    );
  }
}
```

### Step 4 — CALIBRATE the rescale (the step that makes or breaks it)
The `0.35` divisor is specific to how the RCT normalizes its bands. If Sophia's band powers are on any other scale, positions will still bunch or saturate. **Do not copy `0.35` blindly.**
- Log `resonanceScore` (the raw, pre-rescale weighted sum) across a real, varied session.
- Note its actual observed min and max.
- Set `rescale` so the observed working range maps across roughly 0–26 (i.e. `rescale ≈ observed_high_score`). Make it a named constant so it's easy to retune.
- Confirm a relaxed/low-engagement state lands low and a deep/coherent state lands high — and that mid-states land in the middle, not pinned to an end.

### Step 5 — Wire position → frequency, and retire the old mapping
- Route `position` (0–26) into Sophia's existing 27-entry frequency table and into the oscillator.
- **Disable or remove the old bucket/state mapping** so it can't fight the new one. Two placement systems running at once will reintroduce the stuck behavior.

### Step 6 — Baseline + movement (cheap, high value)
Capture a baseline a few seconds after a clean connection, then report movement from it — this is Sophia's closest thing to a ground truth and mirrors the RCT.

```javascript
let baseline = null;
function captureBaseline(smoother, rescale) { baseline = smoother.current(rescale); }
function movementFromBaseline(smoother, rescale) {
  const now = smoother.current(rescale);
  return baseline ? { from: baseline.position, to: now.position, delta: now.position - baseline.position } : null;
}
```

### Step 7 — (Optional, AFTER parity) use Sophia's richer coherence
Sophia has a fuller coherence picture than the RCT's scalar — the pairwise PLV matrix and the hemispheric coherence ratio (HCR). **First get an exact-parity port working with a single scalar coherence** (so you can confirm the port itself fixed the stuck behavior). *Then*, as a separate change, substitute a Sophia-native coherence scalar (e.g. mean off-diagonal PLV, or an HCR-derived term normalized to 0–1) into the `coherence` slot and re-calibrate. Change one thing at a time.

---

## Verification checklist

- [ ] Step 0 completed and the failure mode identified (inputs / mapping / output).
- [ ] With live, changing inputs, the position moves **smoothly** and visits more than a few positions across a session (no parking).
- [ ] Raising alpha + theta + coherence raises the position; relaxing lowers it.
- [ ] A relaxed state and a deep/coherent state land at clearly different positions (range is being used, not bunched).
- [ ] The sonified frequency follows the position.
- [ ] The old bucket/state mapping is disabled — only one placement system is live.
- [ ] Baseline captured on connect; movement-from-baseline reported.
- [ ] `rescale` is a named, documented constant, calibrated to Sophia's real value range (not assumed `0.35`).

---

## Questions for Joseph if anything is unclear (ask, don't guess)

- Where is Sophia's current placement/prescription function?
- How are Sophia's band powers normalized — 0–1 relative power, absolute µV², or something else? (This determines the `rescale` value.)
- Sophia shares `interval-analysis.js` with the RCT — should `resonancePosition()` live there as the **one canonical placement function** for all apps, or stay local to Sophia for now?
- Is Sophia's 27-frequency table ordered identically to the RCT's (GUT 1–9 → HEART 1–9 → HEAD 1–9, index 0–26)?

---

## Honest notes

- This port fixes placement **mechanics**, not placement **truth**. Neither app has an external "correct position" to check against; the baseline-delta (Step 6) is the closest thing to a ground truth, so lean on it.
- If Step 0 shows the inputs are frozen or the output isn't wired, this port alone won't unstick the frequency — fix that first and say so.
- The weights (0.30 / 0.25 / 0.10 / 0.35) are inherited from the RCT and are reasonable, but they are tunable; once side-by-side data exists, they're worth revisiting for Sophia specifically.

## Attribution
Resonance placement formula by Joseph Lewis (Aetheria RCT). Port prompt by Selah / Claude in collaboration with Joseph Lewis — 2026.
*"Healing the world heART"*

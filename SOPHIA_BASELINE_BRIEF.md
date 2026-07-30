# Sophia Personal Baseline — Build Brief v1

**Target:** `Sophia-Aetheria-Oracle-Shaman/index.html` + new sidecar `baseline-core.js`
**Depends on:** `divination-core.js` (two small patches included below — both already applied to the file shipped with this brief)
**Author:** analysis and implementation by Claude (Anthropic) in collaboration with Joseph Lewis
**Status:** written, self-tested, three design bugs found and fixed during testing — §5

This is the piece that turns state mode from *"relative to these thirty seconds"* into *"relative to you."*

---

## 1. Shape of it

Split deliberately into a pure math core and a thin storage adapter, so the logic is exhaustively testable under plain node and the IndexedDB surface stays small enough to eyeball:

- **`BaselineMath`** — medians, quantiles, A12 effect size, time binning, bucket keying, baseline selection, drift detection, time-of-day analysis. No IDB, no DOM, no deps.
- **`BaselineStore`** — adds one object store to the existing `SophiaOracleDB`. Six methods.
- **`Baseline`** — glue. `getBaselineFor()`, `recordCast()`, `drift()`, `bins()`, `status()`, `exportJSON()`, `reset()`.

---

## 2. Integration — four edits

**(a)** Load after divination-core:
```html
<script src="./divination-core.js"></script>
<script src="./baseline-core.js"></script>
```

**(b)** Bump `SophiaOracleDB` to v3 and add one store. Your existing `onupgradeneeded` already guards every store with `if (!contains(...))`, so this is safe for existing users — `files`, `metadata` and `memories` are untouched:

```javascript
const request = indexedDB.open('SophiaOracleDB', 3);   // was 2
// ...inside request.onupgradeneeded, after the memories block:
if (window.BaselineStore) window.BaselineStore.ensureStore(event.target.result);
```

**(c)** Before a state-mode cast, fetch pivots:
```javascript
const bl = await Baseline.getBaselineFor(db);
const reading = Divination.castIChing({
  mode: 'state', frames: window.eegFrameBuffer,
  baseline: bl.baseline,        // null on cold start — castIChing handles that
  cvPivot: bl.cvPivot
});
```

**(d)** After *any* EEG cast, record it:
```javascript
await Baseline.recordCast(db,
  reading.lineDetail.map(l => ({ mean: l.arousal, cv: l.cv })),
  { framesUsed: reading.provenance.framesUsedAfterQualityGate, meanQuality: q });
```
Record on entropy casts too. They produce perfectly good window statistics and discarding them just makes the baseline take longer to mature.

---

## 3. Device keying — non-negotiable

Every entry is bucketed by `deviceId | montage | timeBin`, and **montage is part of the key, not metadata.** Athena's 8 channels and Muse 2's 4 don't produce comparable band-power scaling, so a baseline built on one is quietly invalid on the other — the failure mode is a plausible-looking reading that's wrong for reasons nothing in the UI would reveal. Tested explicitly: same device with a different channel count is excluded from selection, not merged.

`Baseline.recordCast()` refuses outright when the device is unidentified rather than filing it under `unknown`. Better to lose an entry than to poison the pool.

---

## 4. The fallback ladder

Reported every time, never silent:

| Source | Requires | Meaning |
|---|---|---|
| `device+bin` | 12 casts in this device+time bin | Compared to yourself at this time of day |
| `device-pooled` | 8 casts on this device | Compared to yourself |
| `insufficient` | — | Within-cast median. Measures balance *inside* one reading, not you against you. |

The rolling window is bounded at the 40 most recent entries per bucket. Bounded on purpose: the median stays cheap, and the baseline tracks slow genuine drift instead of being anchored to your first month forever. Verified — after 60 casts at a shifted level, the baseline follows the shift rather than splitting the difference.

`maturity.needForPooled` gives you the countdown for the UI: *"personal baseline in 3 more casts."*

---

## 5. Three bugs found in testing

**(a) The CV pivot design was broken and would have gutted the oracle.** I originally had the changing-line threshold as `baselineCV × 1.5`. Measured against a matured baseline: **0.05 changing lines per cast.** Ninety-five percent of readings would have had no relating hexagram at all — the entire transformational half of the I Ching, silently gone. It would have looked fine in a demo, because a demo has no baseline and falls back to the within-cast quantile, which works.

Fixed by replacing the multiplier with a **personal quantile**: the pivot is now the 75th percentile of every window CV in your history. That's self-calibrating — at your own baseline it yields roughly 1.5 changing lines per cast, which is what yarrow averages, and it rises when today is genuinely more unstable than your normal. Measured after the fix: 2.09 changing lines per cast, 5% of casts with no relating hexagram, against yarrow's 1.50 and ~9%. Close enough to ship and tune on real data.

**Single tunable:** the `0.75` in `selectBaseline`. Raise toward 0.80 for fewer changing lines, lower for more. Don't reintroduce a multiplier.

**(b) Wrapping time bins were computed wrong.** `timeBinFor` assumed ascending boundaries, so the vampire-schedule config `[16, 22, 4, 10]` put 17:00 in the `10-16` bin. Boundaries are a circular partition of the clock; they're now sorted before lookup and pre-first-boundary hours wrap into the last interval. Verified: 17:00→`16-22`, 23:00→`22-04`, 05:00→`04-10`, 11:00→`10-16`.

**(c) `clear()` returned `undefined` on a full wipe** and a count on a device wipe. Now always a count.

---

## 6. Does time of day actually matter?

`Baseline.bins(db)` answers it empirically instead of by assumption. Per-bin median and IQR, plus pairwise **A12** (Vargha–Delaney common-language effect size — the probability a random cast from one bin exceeds one from the other, distribution-free, no dependencies):

- **≈0.50** — bins are indistinguishable. Pool, keep the bigger sample.
- **≈0.56** — small; probably not worth the sample-size cost of splitting.
- **≥0.64** — real separation. Binning earns its keep.

Verdict comes back as `pooling-fine`, `bin-worthwhile`, or `insufficient` (fewer than 10 casts in two or more bins). **Start with `binScheme: 'none'`** so the pooled baseline matures fast, keep collecting the bin label on every entry anyway, and re-run `bins()` after a month. Then you're deciding from your data rather than from a hunch about the vampire schedule.

When you do switch it on, set boundaries to your actual waking hours — `Baseline.configure({ binScheme: { boundaries: [16, 22, 4, 10] } })`. Clock quarters will slice one waking period across two bins and give you noise.

---

## 7. Drift

`Baseline.drift(db)` compares the last 10 casts against the 20 before, expressing the shift in IQRs of the prior window so it's scale-free, and flags at 1.0 IQR.

It reports. It never resets anything. A shifted baseline could be a new headband fit, a moved electrode, a schedule or seasonal change, or a real change in you — the code cannot distinguish those, so it says so and leaves the decision with you. If it flags right after you've re-seated the band, that's your answer.

---

## 8. Privacy

Only derived scalars persist: six window means, six window CVs, two medians, frame count, mean quality, timestamp, device, bin. **No raw EEG ever touches the disk**, asserted in the test suite. Everything stays in the local IndexedDB. `exportJSON()` and `reset(db, deviceOnly)` give you the door out.

---

## 9. Honest limits on the numbers in §5

Every figure above comes from **synthetic** 1/f-shaped band power. It's realistic in scale — arousal index lands near 0.15, matching real EEG — but it doesn't have real night-to-night variance, so the yang/yin split sat at exactly 50% in some runs purely because the test signal matched its own frozen baseline. The changing-line rate in particular will move on real data.

So: log the line distribution and the changing-line count over your first fifty real casts with the baseline live. If changing lines come in far above 1.5, nudge the quantile up. If 6s still never appear once you have genuine variance, that's the arousal/variance correlation from the last brief and it's physiology, not code.

---

## 10. Test coverage

`test-baseline.js`, plain node, no dependencies. Covers: median/quantile/IQR/A12 edge cases including empty input, fixed and wrapping time-bin schemes, montage and device separation, scalar-only persistence, the full fallback ladder from cold start through pooled to binned, cross-device and cross-montage contamination, bounded-window drift tracking, drift flagging in both directions plus the thin-history not-ready case, bin verdicts in all three states, and the glue layer against an in-memory mock IDB — including feeding real `castIChing` output through `recordCast` and handing the matured pivots back to `castIChing` to confirm `provenance.pivots.source` flips to `personal-history`. Quality gate and unknown-device refusal both asserted. All passing, as is the existing divination suite after the patch.

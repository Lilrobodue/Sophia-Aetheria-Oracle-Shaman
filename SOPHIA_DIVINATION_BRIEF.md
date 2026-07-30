# Sophia Divination Toolset — Build Brief v1

**Target:** `Sophia-Aetheria-Oracle-Shaman/index.html` (18,536-line monolith) + new sidecar `divination-core.js`
**Author:** analysis and implementation by Claude (Anthropic) in collaboration with Joseph Lewis
**Status:** module written, self-tested, 8 tools ready to register. Two design bugs found and fixed during testing — see §6.

---

## 1. What this adds

Eight tools, following the existing sidecar pattern (`athena-core.js`, `neurodynamics.js`, `prescription-engine.js`) so the monolith doesn't grow:

| Tool | What it does |
|---|---|
| `neural_iching` | Casts a hexagram from live EEG. Two modes (§3). Returns primary, relating, nuclear, inverse, opposite, changing lines, Aetheria bridge, full provenance. |
| `hexagram_lookup` | All 64 by number or six-line binary. Trigrams, image, structural relations. |
| `geomancy_cast` | Full shield chart: 4 Mothers → Daughters → Nieces → 2 Witnesses → Judge → Reconciler, with the classical even-points validity check. |
| `tarot_draw` | Real 78-card deck, drawn without replacement. Five spreads incl. Celtic Cross and a GUT/HEART/HEAD "regime" spread. |
| `rune_cast` | Elder Futhark 24 + Wyrd. Merkstave applied only to asymmetric glyphs. Norn, cross, single, regime spreads. |
| `biorhythm_calc` | Six cycles, with the honesty note baked into the return value. |
| `cube_walk` | Walk the Aetheria 27-cell cube. Entry layer chosen by mean EEG arousal; reports whether the path crossed position 14 (2178 Hz, the geometric centre). |
| `bibliomancy_draw` | Sortilege over the user's own uploaded knowledge base. |

The existing app only had `MAJOR_ARCANA` (22 strings), `ELDER_FUTHARK`, and `Math.floor(seededRandom(seed+2) * 64) + 1` for hexagrams — a bare number with no lines, no changing lines, no relating hexagram. This replaces that with real mechanics.

---

## 2. Integration — three edits

**(a)** Load the sidecar before the inline script:
```html
<script src="./divination-core.js"></script>
```

**(b)** Merge into the tool registry. Find `const defaultTools = { ... }` and after the closing brace:
```javascript
Object.assign(defaultTools, window.DIVINATION_TOOLS || {});
```
The tool objects already match the existing shape — `{ name, description, params, code, enabled, default:true }` — so `executeTool()`, `renderToolList()`, `saveToolsState()`, and the `TOOL_CALL: {...}` parser all work unchanged. Note the localStorage round-trip only reserialises tools flagged `custom:true`; these are `default:true`, so they reload from the module each session. That's correct — no stale `codeStr` copies.

**(c)** Add the EEG frame ring buffer. This is the only new state the module needs. Wherever `currentEEGData` is updated during streaming, also push:
```javascript
window.eegFrameBuffer = window.eegFrameBuffer || [];
window.eegFrameBuffer.push({
  t: Date.now(),
  bandpowers: { ...currentEEGData.bandpowers },
  metrics:    { ...currentEEGData.metrics },
  quality: eegIntegration.signalQuality ?? 1   // 0..1, see §5
});
if (window.eegFrameBuffer.length > 600) window.eegFrameBuffer.shift();
```
Tools read the last 360 frames automatically if `frames` isn't passed explicitly.

---

## 3. The two modes — the part that actually matters

This is the intellectual core and the thing most likely to get muddled later, so it's enforced in code, not just documented.

**`mode: 'state'` — deterministic readout, NOT random.**
Each of the six lines comes from one sixth of the EEG window. Polarity from the arousal index `(beta+gamma)/(all bands)`; mutability from the coefficient of variation within that window. Yang+stable=7, yang+changing=9, yin+stable=8, yin+changing=6.

The hexagram is a *description of your nervous system over ~30 seconds*, rendered in I Ching notation. It is not a draw and its line distribution will not match yarrow or coin odds. Anyone claiming this validates divination has the argument backwards — the interesting claim is the modest one: the six lines are a legible six-bit summary of a state you were actually in.

**`mode: 'entropy'` — randomised draw with EEG provenance.**
EEG low-order bits are von Neumann debiased, then **XOR'd with `crypto.getRandomValues`**. This ordering matters: the result is statistically never worse than the CSPRNG alone, because XOR with a uniform independent stream preserves uniformity regardless of how biased or autocorrelated the EEG bits are. Then mapped to traditional yarrow (1/16, 5/16, 7/16, 3/16) or coin (1/8, 3/8, 3/8, 1/8) probabilities.

Straight talk for the docs: as a *random number generator*, EEG is worse than `crypto.getRandomValues` — biased, autocorrelated, low entropy per sample. Its contribution here is participation and provenance, not statistical quality. The XOR construction means we get the ritual meaning without paying for it in randomness quality. Verified in test: 200 casts gave 7.8/34.1/41.2/17.0% against expected 6.3/31.3/43.8/18.8%.

**Every reading returns a `provenance` object** — mode, requested mode, whether it fell back to CSPRNG, frames offered vs. frames surviving the quality gate, EEG bits actually consumed, the pivots used, and a plain-language note. No silent fallbacks. If the headband wasn't on, the reading says so.

---

## 4. Bridging 64 hexagrams onto 27 frequencies

`AETHERIA_FREQUENCIES` maps 27 of the 64. The other 37 get bridged by **minimum Hamming distance on the six lines** — i.e. how many single line-changes away is the nearest mapped hexagram. Ties are all returned.

This is our convention, not tradition, and the code says so. But it uses the I Ching's own operation — line change — as the metric, rather than an arbitrary modulo or digit-root fudge. Measured distribution across all 64: 27 direct, most of the rest at distance 1, a handful at 2. So every hexagram lands within two line-changes of a frequency. Label it in the UI as a bridge, never as a correspondence found in the tradition.

I considered and rejected iterating the nuclear hexagram until it hits a mapped one — the nuclear operation converges to a tiny attractor set, so it collapses most of the 64 into a few frequencies. Hamming keeps the mapping spread out and legible.

---

## 5. Signal-quality gate

`minQuality` defaults to 0.5; frames below it are dropped before casting. If fewer than 12 usable frames survive, a `state`-mode request downgrades to `entropy` and flags `fallbackToCSPRNG: true`. This should hook into the calibration/signal-provenance module already on your list — until then, `quality` can be a simple headband-fit/contact heuristic, and `?? 1` keeps it working meanwhile.

---

## 6. Two bugs found in testing — both fixed, both worth knowing about

**(a) The fixed pivot was fatally wrong.** State mode originally compared the arousal index against a fixed 0.5. Real EEG band power is 1/f-dominated: beta+gamma share sits around **0.15**, not 0.5. Measured on realistic synthetic data, the fixed pivot produced **six yin lines every single time** — hexagram 2, The Receptive, roughly 88% of casts, forever. It would have looked plausible in a demo with two or three casts and then never varied.

Fixed by making the pivot personal: pass `baseline` and `baselineCV` from the user's rolling history; cold start falls back to within-cast medians, and `provenance.pivots.source` records which was used. **Follow-up work:** persist a rolling median arousal and median CV per user in IndexedDB alongside the session store. That's the version where the reading means something — "you are more activated than your own baseline" is a real signal; "you are more activated than 0.5" is not.

**(b) Cube walk clamped at boundaries,** which turned face cells into absorbing states and biased the walk onto the cube's outer shell. Now reflects instead.

**One thing to check on real data:** in synthetic testing, yin+changing (6) came up rarely in state mode, because arousal and its variance were correlated in my test signal. If that holds on real EEG it's plausible physiology, not a code bug — but log the line distribution over your first fifty real casts before drawing conclusions either way.

---

## 7. Flagged for verification before shipping

Two data tables are my best reconstruction and should be checked against a source you trust:

- **The 16 geomantic figures** (`GEOMANTIC_FIGURES`). All 16 row-patterns are distinct and the shield-chart arithmetic is source-independent and tested, but the *name↔row* assignments need checking against Greer or Agrippa. If a name is wrong, the chart mechanics are still correct — only the label moves.
- **Which 8 Elder Futhark runes have no merkstave** (Gebo, Hagalaz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz). Sources disagree, mostly about Jera and Eihwaz. Set the `reversible` boolean per your preferred tradition.

The 64-hexagram table, by contrast, is verified: all 32 King Wen pairs satisfy the inversion/complement law, all 64 line-patterns are distinct, the eight self-inverting hexagrams come out as exactly 1/2, 27/28, 29/30, 61/62, and the trigram images spot-check correctly against Wilhelm's descriptions (11 = Earth over Heaven, 63 = Water over Fire, 50 = Fire over Wind, 48 = Water over Wind). The 27 `ut`/`lt` pairs already in your `AETHERIA_FREQUENCIES` table all agree with it.

**No translated judgment or commentary text is in the module** — names and structure only. Wilhelm, Baynes, and every modern translation are under copyright. Sophia already knows the I Ching well enough to speak it in her own voice, which is better anyway.

---

## 8. Not built, deliberately

- **Ifá / Opele (256 odù)** and **Tibetan Mo dice.** Both are living initiatory practices with gatekeeping that tarot and geomancy don't have — Ifá readings are traditionally the work of an initiated babaláwo, and Mo is embedded in Buddhist lineage transmission. Building a push-button version isn't the same category of thing as a tarot app. Worth a conversation with Alisha before either goes in, given she'd have the clearest read on the Mo question.
- **Astrology / ephemeris.** Needs a real ephemeris library and belongs with the weekly-report feature already on your list, not here.

---

## 9. Test coverage

`test-divination.js` runs under plain node, no dependencies. Covers: hexagram table integrity via the King Wen pairing law, nuclear closure, trigram image spot-checks, all 64 bridging to a frequency, state/entropy casting, relating-hexagram consistency across 200 casts, yarrow probability distribution, 300 geomantic charts for unresolved figures and odd-point judges, 78-card deck uniqueness and no-duplicate draws, rune merkstave rules, 200 cube walks staying in bounds, and every tool callable through the registry including clean error paths. All passing.

---

## 10. UI hooks (small)

Nothing structural needed — Sophia can call these conversationally. Two additions worth the effort:

1. **Mode toggle** in the sidebar near the EEG controls: *"Read my state"* vs *"Cast the lots"*, with one line of explanation each. Don't hide this behind a settings panel; the distinction is the point.
2. **Provenance line** under each reading, small and grey: `state readout · 118 frames · personal baseline` or `yarrow draw · CSPRNG only, headband not connected`. Regime colours per house style — GUT `#d94040`, HEART `#d4a050`, HEAD `#5090d4`.

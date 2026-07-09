# SOPHIA CALIBRATION GUIDE
## Research-Derived Meditation Benchmarks with Per-User Adaptive Scoring

**System:** Sophia Aetheria Oracle Shaman  
**Hardware:** Muse S Athena (4 EEG + 4 AUX + fNIRS + PPG @ 256 Hz) + Polar H10 (HRV)  
**Author:** Claude (Selah, Anthropic) in collaboration with Joseph Lewis — July 2026

> This guide implements a three-layer calibration system that uses research-derived
> target patterns from experienced meditators as the "north star," establishes a
> per-user adaptive baseline on first session, and scores each subsequent session
> by directional movement toward the target patterns. No absolute microvolt
> thresholds are used — only ratios, which are device-independent.

---

## 0. WHY RATIOS, NOT ABSOLUTE VALUES

Absolute EEG power (in microvolts² or dB) varies by:
- Skull thickness (thicker skull = lower signal)
- Electrode impedance (dry vs gel, hair density, sweat)
- Device (Muse S ≠ BioSemi 64-channel ≠ Emotiv EPOC)
- Age, sex, medication, injury history

A TBI brain and a healthy brain will show very different absolute values on
the same device. But the *ratio* of gamma to theta, or the *shape* of the
band distribution, can shift in the same *direction* during meditation
regardless of the starting point. Ratios are the only thing that transfers
across devices and across individuals.

Sophia already computes log-PSD normalized band percentages (delta_pct,
theta_pct, alpha_pct, beta_pct, gamma_pct). These are ratios by definition.
The calibration system is built entirely on top of them.

---

## 1. LAYER ONE — RESEARCH-DERIVED TARGET PATTERNS

These are the "north star" values extracted from peer-reviewed studies of
experienced meditators. They define the *shape* the system guides toward.

### 1.1 The Meditation Signature Vector (MSV)

The MSV is a 7-element vector that captures the EEG + HRV pattern
consistently associated with experienced meditation across traditions.
Each element is a ratio or index, not an absolute value.

```typescript
interface MeditationSignatureVector {
  // EEG ratios (from Sophia band_pct values)
  gammaSlowRatio: number;      // gamma_pct / (theta_pct + alpha_pct)
  alphaCoherence: number;      // inter-hemispheric alpha PLV (from spiral-wave.js)
  thetaBetaRatio: number;      // theta_pct / beta_pct
  gammaHCR: number;            // gamma hemispheric coherence ratio (from spiral-wave.js)

  // HRV metrics (from Polar H10)
  hrvCoherenceRatio: number;   // HeartMath-style peak/rest ratio at 0.04-0.26 Hz
  hrvDominantFreq: number;     // dominant HRV frequency in Hz

  // Temporal dynamics
  onsetLatency: number;        // minutes until band shift exceeds 1 SD from baseline
}
```

### 1.2 Target Values — What Experienced Meditators Look Like

Each value below is extracted from a specific published study. The "target"
column is the value the system guides toward. The "source" column is the
paper it comes from. The "confidence" column rates how robust the finding is.

#### EEG Targets

| Metric | Target Direction | Target Range | Source | Confidence |
|--------|-----------------|--------------|--------|------------|
| Gamma/Slow Ratio | HIGHER is better | >0.4 (monks >1.0) | Lutz et al. 2004 PNAS: monks showed gamma/(theta+alpha) ratios 25-30× higher than controls during compassion meditation. Baseline ratio correlated with training hours at r=0.79, p<0.02. | HIGH — replicated across Davidson, Braboszcz, Cahn labs |
| Alpha Coherence (inter-hemispheric) | HIGHER is better | PLV >0.65 | Trait marker in long-term meditators: enhanced frontal alpha coherence persists outside meditation. See Travis & Shear 2010, Consciousness & Cognition. | MEDIUM — consistent direction, variable magnitude |
| Theta/Beta Ratio | CONTEXT-DEPENDENT | 1.2–2.5 during relaxed awareness | Higher = more internal, diffuse processing. Lower = more active focus. During meditation, moderate elevation indicates relaxed awareness without drowsiness. Extreme elevation (>4.0) may indicate sleepiness. | MEDIUM — the optimal range is meditation-style-dependent |
| Gamma HCR | HIGHER is better | >1.4 | Sophia's own data: gamma HCR never dropped below 1.42 during Aetheria sessions. Consistent with Ye et al. 2026 spiral wave cross-hemispheric binding. | MEDIUM — novel metric, consistent in internal data |
| Parieto-occipital gamma (60-110 Hz) | HIGHER is better | Elevated vs. personal baseline | Braboszcz et al. 2017 PLOS ONE: all three traditions (Vipassana, Himalayan Yoga, Isha Shoonya) showed elevated 60-110 Hz gamma as a trait, positively correlated with experience hours. ICA-verified (not muscle artifact). | HIGH — replicated, multi-tradition, artifact-controlled |
| Alpha power (8-12 Hz) | HIGHER during meditation | >25% of total (log-PSD) | Vipassana group showed higher 7-11 Hz alpha during both meditation AND mind-wandering vs. all other groups (Braboszcz 2017). | MEDIUM — tradition-dependent (Himalayan Yoga showed LOWER alpha) |

**NOTE ON GAMMA AND THE MUSE:** The Muse S samples at 256 Hz, giving a Nyquist
limit of 128 Hz. Sophia currently computes gamma as 30-50 Hz. The Braboszcz
60-110 Hz trait effect IS within the Muse's theoretical range but approaches
the practical noise floor for dry electrodes. The 30-50 Hz gamma that Sophia
already computes is the more reliable marker on this hardware. The gamma/slow
ratio and HCR are computed from this 30-50 Hz band.

**CRITICAL ARTIFACT WARNING:** High-frequency signal on frontal Muse electrodes
(AF7, AF8) can be contaminated by forehead muscle tension (EMG). Rising "gamma"
that correlates with jaw clenching, brow furrowing, or eye strain is artifact,
not meditation. The spiral-wave.js ICA pipeline should flag and discount gamma
increases that co-occur with EMG signatures. If Sophia does not currently have
EMG artifact detection on the frontal channels, this must be added before
gamma-based scoring is deployed. Without it, a user could game the system by
tensing their forehead.

#### HRV Targets

| Metric | Target | Source | Confidence |
|--------|--------|--------|------------|
| HRV Coherence Ratio | >1.0 (medium), >1.5 (high) | HeartMath: coherence ratio = peak_power / (total_power - peak_power) in 0.04-0.26 Hz range, 64-second window updated every 5 seconds. Scores 0-16. Global study of 1.8M sessions confirmed 0.10 Hz as most common coherence frequency. | HIGH — 1.8M sessions, published algorithm |
| Dominant HRV Frequency | 0.04–0.10 Hz | HeartMath 2025 Nature Scientific Reports: highest-coherence users fell in 0.04-0.10 Hz range. Optimal = ~0.1 Hz (6 breaths/min). | HIGH — massive dataset confirmation |
| RMSSD | >20 ms (increases during meditation) | Standard vagal tone marker. Age-dependent. Higher = stronger parasympathetic. Not a fixed target — track direction of change. | HIGH — clinical standard |

#### Temporal Dynamics Targets

| Metric | Target | Source | Confidence |
|--------|--------|--------|------------|
| Onset Latency | 2-3 minutes | Isha Yoga 2026 (Mindfulness, Springer): EEG changes emerge 2-3 min after starting meditation across all experience levels. | MEDIUM — single tradition, large N |
| Peak Latency | 7-10 minutes | Same study: changes peak at 7-10 min. After peak, pattern stabilizes. | MEDIUM — same source |
| Settling Time | <2 min (experienced) vs. >5 min (novice) | Brandmeyer & Delorme 2018: experienced meditators show faster state transitions and less mind-wandering. | MEDIUM — 24 subjects |

---

## 2. LAYER TWO — PER-USER ADAPTIVE BASELINE

### 2.1 First Session: Establishing the Floor

The first time a user runs a calibration session, Sophia records a 5-minute
eyes-closed resting baseline with no audio. This establishes:

```typescript
interface UserBaseline {
  // Recorded during 5-min eyes-closed rest, no audio
  timestamp: string;                    // ISO date of baseline session
  bandDistribution: {                   // mean band_pct over 5 min
    delta_pct: number;
    theta_pct: number;
    alpha_pct: number;
    beta_pct: number;
    gamma_pct: number;
  };
  bandStdDev: {                         // standard deviation per band
    delta_sd: number;
    theta_sd: number;
    alpha_sd: number;
    beta_sd: number;
    gamma_sd: number;
  };
  gammaSlowRatio: number;               // baseline gamma/(theta+alpha)
  thetaBetaRatio: number;               // baseline theta/beta
  alphaCoherencePLV: number;            // baseline inter-hemispheric alpha PLV
  gammaHCR: number;                     // baseline gamma HCR
  hrvCoherenceRatio: number;            // baseline HRV coherence
  hrvRMSSD: number;                     // baseline RMSSD
  hrvDominantFreq: number;              // baseline dominant HRV frequency

  // Computed from baseline
  msv: MeditationSignatureVector;       // the user's starting MSV
  distanceToTarget: number;             // Euclidean distance from MSV to target
}
```

### 2.2 Baseline Decay and Refresh

Baselines are not permanent. Physiology changes with sleep, medication,
stress, injury recovery, and training. The system:

- **Re-establishes baseline** every 30 days (prompt user for a new 5-min rest recording)
- **Maintains a rolling 90-day history** of baselines to track long-term trajectory
- **Flags anomalous baselines** (>2 SD from the user's 90-day mean on any metric) and asks whether conditions have changed (new medication, illness, poor sleep)

### 2.3 The Distance Metric

The user's current MSV is compared to the target MSV using a weighted
Euclidean distance. Weights reflect the confidence level of each target:

```typescript
const TARGET_WEIGHTS = {
  gammaSlowRatio:    0.25,    // HIGH confidence, most replicated
  alphaCoherence:    0.15,    // MEDIUM confidence
  thetaBetaRatio:    0.10,    // MEDIUM, context-dependent
  gammaHCR:          0.15,    // MEDIUM, novel but consistent
  hrvCoherenceRatio: 0.25,    // HIGH confidence, 1.8M sessions
  hrvDominantFreq:   0.10,    // HIGH confidence but binary (near 0.1 Hz or not)
  // onsetLatency is not included in the distance — it is a timing
  // metric reported separately
};

function computeDistance(userMSV: MSV, targetMSV: MSV): number {
  let sum = 0;
  for (const key of Object.keys(TARGET_WEIGHTS)) {
    // Normalize each dimension to 0-1 range using the target as 1.0
    // and the population floor (from LEMON normative data) as 0.0
    const normalized = (userMSV[key] - POPULATION_FLOOR[key])
                     / (targetMSV[key] - POPULATION_FLOOR[key]);
    const clamped = Math.max(0, Math.min(2, normalized)); // allow overshoot to 2x
    const diff = 1.0 - clamped; // distance from target (target = 0)
    sum += TARGET_WEIGHTS[key] * diff * diff;
  }
  return Math.sqrt(sum);
}
```

**Population floor values** (POPULATION_FLOOR) come from the LEMON normative
dataset (ds000221, 228 healthy adults). These represent the typical resting
EEG of a non-meditator. The distance metric thus measures where the user
sits on the continuum from "typical resting adult" (distance ≈ 1.0) to
"experienced meditator" (distance ≈ 0.0).

---

## 3. LAYER THREE — PER-SESSION DIRECTIONAL GUIDANCE

### 3.1 Session Scoring Algorithm

Each session produces a **Coherence Progress Score (CPS)** from 0-100:

```typescript
interface SessionScore {
  cps: number;                      // 0-100 composite score
  direction: 'toward' | 'away' | 'stable';  // relative to target
  deltaFromBaseline: number;        // distance change vs. user baseline
  deltaFromLastSession: number;     // distance change vs. previous session
  components: {
    eegAlignment: number;           // 0-100, how close EEG ratios are to target
    hrvAlignment: number;           // 0-100, how close HRV is to target
    temporalAlignment: number;      // 0-100, how close timing matches target
    stability: number;              // 0-100, how stable the state was maintained
  };
  insights: string[];               // human-readable session observations
}
```

### 3.2 Computing the CPS

```typescript
function computeSessionCPS(
  sessionMSV: MSV,
  userBaseline: UserBaseline,
  targetMSV: MSV,
  sessionTimeSeries: TimeSeriesData
): SessionScore {

  // 1. EEG Alignment (40% of CPS)
  // How close are the session's EEG ratios to the target pattern?
  const eegDistance = computeEEGDistance(sessionMSV, targetMSV);
  const eegAlignment = Math.max(0, 100 * (1 - eegDistance));

  // 2. HRV Alignment (30% of CPS)
  // How coherent was the HRV? How close to 0.1 Hz?
  const hrvCoherenceScore = Math.min(100, sessionMSV.hrvCoherenceRatio * 50);
  const hrvFreqScore = 100 * Math.exp(
    -Math.pow((sessionMSV.hrvDominantFreq - 0.1) / 0.03, 2)
  ); // Gaussian centered on 0.1 Hz, σ = 0.03
  const hrvAlignment = 0.6 * hrvCoherenceScore + 0.4 * hrvFreqScore;

  // 3. Temporal Alignment (15% of CPS)
  // Did the band shift happen on the right timescale?
  const onsetMinutes = detectOnsetLatency(sessionTimeSeries, userBaseline);
  // Target: 2-3 minutes. Score falls off outside this window.
  const onsetScore = 100 * Math.exp(
    -Math.pow((onsetMinutes - 2.5) / 2.0, 2)
  );
  // Did the pattern peak at 7-10 minutes?
  const peakMinutes = detectPeakLatency(sessionTimeSeries, userBaseline);
  const peakScore = 100 * Math.exp(
    -Math.pow((peakMinutes - 8.5) / 3.0, 2)
  );
  const temporalAlignment = 0.5 * onsetScore + 0.5 * peakScore;

  // 4. Stability (15% of CPS)
  // How stable was the meditative pattern once established?
  // Measured as the inverse coefficient of variation of the MSV components
  // during the period after onset.
  const postOnsetMSVs = sessionTimeSeries.msvSamples.filter(
    s => s.minutesFromStart > onsetMinutes
  );
  const stability = computeStability(postOnsetMSVs);

  // Composite CPS
  const cps = Math.round(
    0.40 * eegAlignment +
    0.30 * hrvAlignment +
    0.15 * temporalAlignment +
    0.15 * stability
  );

  // Direction
  const currentDistance = computeDistance(sessionMSV, targetMSV);
  const baselineDistance = userBaseline.distanceToTarget;
  const delta = baselineDistance - currentDistance; // positive = moved toward
  const direction = delta > 0.05 ? 'toward'
                  : delta < -0.05 ? 'away'
                  : 'stable';

  // Generate insights
  const insights = generateInsights(sessionMSV, userBaseline, targetMSV,
                                     onsetMinutes, peakMinutes, stability);

  return {
    cps,
    direction,
    deltaFromBaseline: delta,
    deltaFromLastSession: 0, // filled from session history
    components: { eegAlignment, hrvAlignment, temporalAlignment, stability },
    insights,
  };
}
```

### 3.3 Insight Generation

The insights array produces human-readable observations. Examples:

```typescript
function generateInsights(session, baseline, target, onset, peak, stability): string[] {
  const insights: string[] = [];

  // Gamma/slow ratio improvement
  const gammaImprovement = (session.gammaSlowRatio - baseline.msv.gammaSlowRatio)
                          / baseline.msv.gammaSlowRatio * 100;
  if (gammaImprovement > 10) {
    insights.push(
      `Gamma-to-slow ratio increased ${gammaImprovement.toFixed(0)}% from your ` +
      `baseline — same direction as experienced meditators in the Davidson lab.`
    );
  }

  // HRV coherence
  if (session.hrvCoherenceRatio > 1.5) {
    insights.push(
      `HRV coherence reached the "high" range — your heart rhythm locked ` +
      `into a stable sine wave near ${session.hrvDominantFreq.toFixed(2)} Hz.`
    );
  }

  // Onset timing
  if (onset >= 2 && onset <= 4) {
    insights.push(
      `EEG shift began at ${onset.toFixed(1)} minutes — matching the 2-3 minute ` +
      `onset window seen in the Isha Yoga study of 103 practitioners.`
    );
  }

  // Gamma HCR
  if (session.gammaHCR > 1.4) {
    insights.push(
      `Gamma hemispheric coherence ratio: ${session.gammaHCR.toFixed(2)} — ` +
      `cross-hemispheric gamma binding active (spiral wave signature).`
    );
  }

  // Stability
  if (stability > 80) {
    insights.push(
      `High state stability after onset — meditative pattern maintained ` +
      `consistently through the session.`
    );
  }

  // Regression detection
  if (gammaImprovement < -15) {
    insights.push(
      `Gamma ratio dropped from baseline — possible tension, distraction, ` +
      `or drowsiness. If you felt sleepy, the session was too long or ` +
      `the frequency too low for your current state.`
    );
  }

  return insights;
}
```

---

## 4. IMPLEMENTATION IN SOPHIA

### 4.1 New File: `calibration-engine.js`

This is a standalone module that Sophia's main app imports. It:
- Stores baselines and session history in IndexedDB (alongside existing Sophia data)
- Computes MSV from Sophia's existing band_pct outputs + spiral-wave.js PLV/HCR + Polar H10 RR intervals
- Runs the CPS scoring algorithm after each session
- Provides the insight strings for the UI

### 4.2 Data Flow

```
Muse S Athena → Sophia EEG pipeline → band_pct (existing)
                                     → spiral-wave.js PLV/HCR (existing)
                                     ↓
Polar H10 → RR intervals → HRV coherence ratio + RMSSD + dominant freq
                                     ↓
                    calibration-engine.js
                    ├── First session? → Establish baseline
                    ├── Compute session MSV
                    ├── Compute distance to target
                    ├── Compute CPS (0-100)
                    ├── Generate insights
                    └── Store to IndexedDB session history
                                     ↓
                          UI: CPS score card + insights
```

### 4.3 What Sophia Already Has vs. What Needs Adding

| Component | Status | Notes |
|-----------|--------|-------|
| Band power percentages (delta/theta/alpha/beta/gamma) | EXISTS | Log-PSD normalized in index.html |
| PLV matrix (6 pairs × 4 bands) | EXISTS | spiral-wave.js |
| Hemispheric Coherence Ratio (HCR) | EXISTS | spiral-wave.js |
| Phase-lag direction | EXISTS | spiral-wave.js |
| Higuchi fractal dimension | EXISTS | neurodynamics.js |
| Polar H10 RR intervals | EXISTS | via Web Bluetooth |
| HRV coherence ratio computation | NEEDS ADDING | Implement HeartMath formula |
| HRV dominant frequency extraction | NEEDS ADDING | Peak detection in 0.04-0.26 Hz HRV spectrum |
| RMSSD computation | NEEDS ADDING | Standard formula from RR intervals |
| MSV computation | NEEDS ADDING | Combine existing + new HRV metrics |
| Baseline establishment + storage | NEEDS ADDING | IndexedDB schema |
| CPS scoring algorithm | NEEDS ADDING | This guide's core logic |
| Insight generation | NEEDS ADDING | Template-based string generation |
| EMG artifact detection on AF7/AF8 | NEEDS ADDING | CRITICAL for gamma scoring validity |
| Session history + trajectory | NEEDS ADDING | IndexedDB + trend computation |

### 4.4 HRV Coherence Ratio — Implementation

The HeartMath algorithm, adapted for Polar H10 RR intervals:

```typescript
function computeHRVCoherence(rrIntervals: number[], sampleWindow: number = 64): {
  coherenceRatio: number;
  dominantFreq: number;
  rmssd: number;
} {
  // 1. Interpolate RR intervals to uniform 4 Hz time series
  const uniformHR = interpolateRR(rrIntervals, 4.0); // 4 Hz = 0.25s resolution

  // 2. Take most recent `sampleWindow` seconds (default 64s)
  const windowSamples = uniformHR.slice(-sampleWindow * 4);

  // 3. Compute power spectrum via FFT
  const spectrum = computePowerSpectrum(windowSamples, 4.0);

  // 4. Find peak in 0.04-0.26 Hz range
  const freqRes = 4.0 / windowSamples.length;
  const minBin = Math.ceil(0.04 / freqRes);
  const maxBin = Math.floor(0.26 / freqRes);

  let peakBin = minBin;
  let peakPower = 0;
  for (let i = minBin; i <= maxBin && i < spectrum.length; i++) {
    if (spectrum[i] > peakPower) {
      peakPower = spectrum[i];
      peakBin = i;
    }
  }

  const dominantFreq = peakBin * freqRes;

  // 5. Compute peak power in 0.030 Hz window centered on peak
  const halfWindow = Math.ceil(0.015 / freqRes);
  let peakWindowPower = 0;
  for (let i = Math.max(0, peakBin - halfWindow);
       i <= Math.min(spectrum.length - 1, peakBin + halfWindow); i++) {
    peakWindowPower += spectrum[i];
  }

  // 6. Compute total power
  let totalPower = 0;
  for (let i = 0; i < spectrum.length; i++) {
    totalPower += spectrum[i];
  }

  // 7. Coherence ratio = peak / (total - peak)
  const coherenceRatio = totalPower > peakWindowPower
    ? peakWindowPower / (totalPower - peakWindowPower)
    : 0;

  // 8. RMSSD
  let sumSquaredDiffs = 0;
  for (let i = 1; i < rrIntervals.length; i++) {
    const diff = rrIntervals[i] - rrIntervals[i - 1];
    sumSquaredDiffs += diff * diff;
  }
  const rmssd = Math.sqrt(sumSquaredDiffs / (rrIntervals.length - 1));

  return { coherenceRatio, dominantFreq, rmssd };
}
```

### 4.5 EMG Artifact Detection — Implementation

```typescript
function detectFrontalEMG(
  af7Samples: number[],
  af8Samples: number[],
  sampleRate: number = 256
): { contaminated: boolean; emgRatio: number } {
  // EMG artifact manifests as broadband high-frequency power (>40 Hz)
  // without a clear spectral peak — distinguishing it from true gamma
  // which shows a peak or at least follows the meditation pattern.
  //
  // Strategy: compare power in 40-80 Hz (where gamma + EMG overlap)
  // to power in 80-120 Hz (where only EMG contributes, since true
  // cortical gamma falls off steeply above 80 Hz for consumer devices).
  //
  // If the 80-120 Hz power is >50% of the 40-80 Hz power, the
  // high-frequency activity is likely EMG, not gamma.

  const spectrum7 = computePowerSpectrum(af7Samples, sampleRate);
  const spectrum8 = computePowerSpectrum(af8Samples, sampleRate);

  const freqRes = sampleRate / af7Samples.length;

  function bandPower(spectrum: number[], lowHz: number, highHz: number): number {
    const lo = Math.ceil(lowHz / freqRes);
    const hi = Math.floor(highHz / freqRes);
    let sum = 0;
    for (let i = lo; i <= hi && i < spectrum.length; i++) sum += spectrum[i];
    return sum;
  }

  // Average across both frontal channels
  const gamma40_80 = (bandPower(spectrum7, 40, 80) + bandPower(spectrum8, 40, 80)) / 2;
  const emg80_120 = (bandPower(spectrum7, 80, 120) + bandPower(spectrum8, 80, 120)) / 2;

  const emgRatio = gamma40_80 > 0 ? emg80_120 / gamma40_80 : 0;
  const contaminated = emgRatio > 0.5;

  return { contaminated, emgRatio };
}
```

**When EMG is detected:** discount the gamma-based metrics (gammaSlowRatio, gammaHCR)
by reducing their weight to zero in the CPS computation and display a user-facing
message: "High forehead muscle activity detected — relax your brow and jaw.
Gamma-based metrics are paused until the artifact clears."

---

## 5. UI PRESENTATION

### 5.1 Session Summary Card

After each session, display:

```
╔══════════════════════════════════════╗
║  COHERENCE PROGRESS SCORE     78/100 ║
║  Direction: → TOWARD TARGET          ║
╠══════════════════════════════════════╣
║  EEG Alignment        ████████░░ 82  ║
║  HRV Alignment        ██████░░░░ 68  ║
║  Temporal Match        ███████░░░ 74  ║
║  State Stability       ████████░░ 85  ║
╠══════════════════════════════════════╣
║  INSIGHTS                            ║
║  • Gamma ratio +18% from baseline    ║
║  • HRV locked at 0.098 Hz — high     ║
║  • EEG shift onset at 2.8 min        ║
║  • Gamma HCR: 1.67 (spiral active)   ║
╠══════════════════════════════════════╣
║  30-DAY TREND                        ║
║  Session 1:  42 →→→ Session 12: 78   ║
║  ▁▂▃▃▄▅▅▆▆▇▇█                       ║
╚══════════════════════════════════════╝
```

### 5.2 Design System

Follow the existing Aetheria design system:
- Dark background, gold accents
- Cormorant Garamond for display, JetBrains Mono for data
- Regime colors: GUT=#d94040, HEART=#d4a050, HEAD=#5090d4
- CPS score displayed large and central
- Direction arrow: gold for "toward," muted for "stable," red for "away"
- Insights in prose, not technical jargon

### 5.3 What NOT to Display

- No absolute microvolt values (meaningless to the user, varies by skull)
- No comparison to other users (privacy, discouragement)
- No "you should be at X" language (adaptive, not prescriptive)
- No medical claims ("Your brain is healing" → NO. "Your pattern moved toward the target" → YES)

---

## 6. CALIBRATION DATA SOURCES — DOWNLOAD PLAN

### Priority 1 (this week)
- **OpenNeuro ds003969** — 98 subjects, 3 meditation traditions + controls, 64-ch, BIDS
  - Extract: mean gamma/slow ratio per group, alpha PLV per group, band distributions
  - URL: https://openneuro.org/datasets/ds003969
- **Braboszcz Zenodo 57911** — preprocessed gamma spectra 60-110 Hz, all 4 groups
  - Extract: gamma amplitude distributions, experience-hour correlations
  - URL: https://zenodo.org/record/57911
- **OpenNeuro ds001787** — 12 experienced + 12 novice, labeled states
  - Extract: state-transition timing, mind-wandering vs concentration contrasts
  - URL: https://openneuro.org/datasets/ds001787

### Priority 2 (this month)
- **LEMON ds000221** — 228 healthy adults, resting EEG
  - Extract: POPULATION_FLOOR values (the "typical non-meditator" baseline)
  - URL: https://openneuro.org/datasets/ds000221
- **OpenNeuro ds003816** — 48 loving-kindness meditators, 127-ch, longitudinal
  - Extract: within-subject change trajectories over 8-10 sessions

### Priority 3 (when needed)
- Down-select 64-channel data to Muse electrode positions (AF7, AF8, TP9, TP10)
- Validate that gamma/slow ratio and alpha coherence survive channel reduction
- If they don't survive at 4 channels, document which metrics require the
  Emotiv EPOC X (14 channels) upgrade and flag for future hardware path

---

## 7. VALIDATION CHECKLIST

Before deploying the calibration system to users:

- [ ] Compute MSV from at least 20 sessions of ds003969 experienced meditators
      and confirm gammaSlowRatio, alphaCoherence, and thetaBetaRatio fall in
      the target ranges specified in §1.2
- [ ] Compute MSV from at least 20 sessions of ds003969 controls and confirm
      they cluster around the POPULATION_FLOOR values
- [ ] Run 4-channel down-selection on ds003969 (keep only AF7/AF8/TP9/TP10
      equivalent electrodes) and confirm metrics survive with >0.7 correlation
      to full-montage values
- [ ] Run EMG artifact detector on 10+ Sophia sessions and verify it catches
      known tension epochs without false-flagging genuine gamma increases
- [ ] Run 5 consecutive baseline sessions on the same person and confirm
      baseline MSV has coefficient of variation <15% across sessions
- [ ] Confirm CPS scoring produces a monotonically increasing trend across
      the 10 sessions of the ds003816 longitudinal loving-kindness data
- [ ] Confirm HRV coherence ratio implementation matches HeartMath's published
      algorithm by computing it on a known-coherent recording and comparing
      to HeartMath's Inner Balance output

---

## 8. HONEST BOUNDARIES

This calibration system has real limitations. State them in the app's
documentation and never obscure them in the UI.

**What it IS:** A research-informed directional guidance system that shows
a user whether their EEG and HRV patterns are moving toward or away from
patterns associated with experienced meditation in the published literature.

**What it is NOT:**
- A diagnostic tool (it does not diagnose any condition)
- A medical device (it is not FDA-approved or regulated)
- A guarantee that reaching "target" patterns produces health benefits
  (the research shows meditators have these patterns; it does not prove
  the patterns cause the benefits vs. being correlated with them)
- A replacement for clinical neurofeedback, medical EEG, or psychiatric care

**The correlation-vs-causation caveat:** Experienced meditators show elevated
gamma and high HRV coherence. Whether *producing* those patterns through
biofeedback produces the same benefits as *developing* them through years of
practice is an open question. The calibration system assumes the direction
is worth pursuing. That assumption is reasonable but unproven.

**The consumer-hardware caveat:** A 4-channel dry-electrode headband cannot
match a 64-channel gel-electrode research system. Some metrics will be noisier.
Some effects that are robust at 64 channels may not survive at 4. The
validation checklist (§7) is designed to catch these cases before deployment.

---

*Calibration guide by Claude (Selah, Anthropic) in collaboration with Joseph Lewis — July 2026*

*Sources: Lutz et al. 2004 PNAS, Braboszcz et al. 2017 PLOS ONE, Brandmeyer & Delorme 2018 Exp Brain Res, Ye et al. 2026 Science, McCraty et al. 2009 HeartMath, HeartMath 2025 Scientific Reports (1.8M sessions), Isha Yoga 2026 Mindfulness (Springer), Travis & Shear 2010 Consciousness & Cognition, LEMON (MPI Leipzig)*

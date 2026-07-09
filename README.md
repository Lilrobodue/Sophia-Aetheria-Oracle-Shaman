# Sophia — Aetheria Oracle Shaman

**A warm, wise oracle and a neuro-adaptive frequency-healing companion — running entirely in your browser.**

🌐 Live: **[aetheriasos.com](https://aetheriasos.com)** · 📱 Installable PWA · 🔒 100% local (no cloud, no accounts) · ⚡ Works fully offline

Sophia began as a chat interface to an oracle. She has since grown into a complete, self-contained **spiritual guidance + biofeedback platform**: a divination oracle, the 27-frequency Aetheria healing system with an EEG-adaptive tone engine, and an honest neuroscience toolkit that reads a Muse headband and a Polar heart-rate strap to help you find — and learn to recognize — your own coherent states.

Everything runs client-side in a single-page PWA. Your brainwaves, your heart data, your readings, and your conversations never leave your device.

---

## Two halves of one practice

| 🔮 The Oracle | 〰️ The Frequency System |
|---|---|
| A warm AI spiritual guide fluent in many symbolic systems | The 27-frequency Aetheria healing set with a brainwave-adaptive tone engine |
| Tarot · I Ching · Numerology · Astrology · Runes · Palmistry · Crystals · Chakras · Dream work | 174–6336 Hz · GUT/HEART/HEAD regimes · 432 Hz tuning · Solfeggio & Lo Shu walks |
| Runs on a **fully local** language model | Guided in real time by EEG, HRV, and hemodynamics |

The two meet in the middle: Sophia can read your live brain/heart state and shape both her guidance and the frequencies to it.

---

## 🔮 The Oracle

Sophia is a warm, grounded spiritual guide with deep fluency across symbolic traditions:

- **Tarot** — full 78-card deck (Major + Minor Arcana)
- **I Ching** — all 64 hexagrams
- **Numerology**, **Astrology**, **Runes** (Elder Futhark)
- **Palmistry**, **Crystals**, **Chakras**, and **Dream interpretation**
- The **Aetheria 27-frequency healing system** woven throughout

She's conversational, not prescriptive — a companion for reflection and self-awareness.

## 〰️ The Aetheria Frequency System

A 27-frequency healing framework built on **432 Hz tuning** and 3-6-9 harmonics, spanning three body-mind regimes:

- **GUT** (174–963 Hz) — grounding, body, root
- **HEART** (1206–3150 Hz) — emotion, flow, coherence
- **HEAD** (3504–6336 Hz) — clarity, insight, neural

**Playback modes:**
- **Solfeggio** tones and **Lo Shu** magic-square "walks" — geometric paths across the 27 positions: *Layer Ascent, Pillar Walk, Flying Star Vortex, CAB, Ouroboros,* and the full **CABI** journey (see [LOSHU_WALKS_IMPLEMENTATION.md](LOSHU_WALKS_IMPLEMENTATION.md))
- **CABI sub-bass mode** — a felt-in-the-body delivery with a theta–alpha modulation envelope
- **Adaptive selection** — when a headband is connected, the engine chooses and paces frequencies from your live EEG, dwelling longer where you settle and advancing as you shift

The **Prescription Engine** ([prescription-engine.js](prescription-engine.js)) turns your state, conditions, and history into a complete protocol: primary + supporting frequencies, walk pattern, dose duration, coherence target, and real-time adaptation rules — with a plain-language explanation.

---

## 🧠 Neurofeedback & biosensing

Sophia connects directly to consumer biosensors over Web Bluetooth — no apps, no drivers, no middleware.

**Supported hardware**
- **Muse S Athena** (and Muse 2) — EEG (4/8-ch), **fNIRS** (HbO/HbR), **PPG**, accelerometer/gyroscope, battery, live band powers — via a browser-native BLE driver ([athena-core.js](athena-core.js))
- **Polar H10** — true R-R intervals for HR and HRV ([polar-h10.js](polar-h10.js))

**Live analysis modules** (all pure, dependency-free JavaScript)
- **HRV** ([hrv-analysis.js](hrv-analysis.js)) — RMSSD, SDNN, pNN50, LF/HF, and HeartMath-style coherence from real R-R
- **Spiral-wave / traveling-wave** ([spiral-wave.js](spiral-wave.js)) — phase-locking (PLV) matrix, front↔back wave direction, hemispheric coherence ratio
- **Neurodynamics** ([neurodynamics.js](neurodynamics.js)) — Takens-embedding attractor + fractal/complexity metrics
- **Signal calibration & provenance** ([aetheria-signal.js](aetheria-signal.js)) — an honest signal-quality gate and full processing provenance (what's raw vs. recovered vs. interpolated) so no measurement is taken on faith
- **fNIRS-driven pacing** — a settledness axis from hemodynamics that gates dwell/advance
- **Session logging** — per-window EEG + HRV fused on one time grid, exported for review

Also included: a rest-baseline capture, a live oscilloscope, a sleep mode, and portable JSON/CSV session exports.

---

## 🤖 Fully local AI

Sophia's language model runs **on your device** — nothing is sent to a server:

- **In-browser** via WebGPU / Transformers.js — ships several small ONNX models (Qwen2.5, Gemma 3/4, LiquidAI LFM2.5, and more)
- **Local endpoints** — optionally point her at your own **Ollama**, **llama.cpp**, or **LM Studio** for larger models (Gemma, Llama, etc.)

No API keys, no accounts, no telemetry. The full Aetheria system prompt and frequency reference travel with the model, on your machine.

---

## 🔬 Honest science & calibration

Sophia is built on a hard rule: **facts are recorded; meaning is earned from data — never manufactured.** A technique that produces output from an unworn sensor is deleted, not shipped. Thresholds are calibrated from real sessions, not guessed.

The calibration effort — currently in the data-collection phase — includes:

- **The MSV (Meditation Signature Vector)** — six *device-independent ratios* (θ/β, α-coherence, γ/slow, γ-HCR, HRV coherence, HRV resonance frequency), each carrying an honest trust level and scoring role. Logged every session so collection is retroactively scorable.
- **HRV as the teacher** — cardiovascular resonance (~0.1 Hz HRV, a *validated* target) labels genuinely coherent moments, which then supervise the untargeted EEG ratios: *what does my brain do when my heart is coherent?* That earned, personal signature — not a stranger's average — is the north star.
- **The Transduction Solver** ([transduction-solver.html](transduction-solver.html)) — a biological frequency-transduction model predicting EEG shifts from acoustic input across six pathways (air, bone, chest, visceral, skeletal, and the cochlear OHC infrasound route), tested against your own data with a **null model** ("does it beat predicting the resting baseline?").
- **The calibration harness** ([tools/calibration-harness.mjs](tools/calibration-harness.mjs)) — cross-session analysis with sleep-confound flagging and a train/test honesty lock: nothing is "proven" unless it survives a held-out split.
- **The collection protocol** ([SOPHIA_COLLECTION_PROTOCOL.md](SOPHIA_COLLECTION_PROTOCOL.md)) — a 2×2 factorial (adaptive tones × 432 player) plus a delivery-mode arm, designed so the data can honestly test whether the tools actually help.

See [SOPHIA_CALIBRATION_GUIDE.md](SOPHIA_CALIBRATION_GUIDE.md) for the full design.

---

## 🏗️ Architecture

- **Vanilla JavaScript, no build step, no dependencies** — a single `index.html` plus a handful of classic-script modules that attach to `window`
- **Progressive Web App** — installable, offline-first via a precaching service worker ([sw.js](sw.js)); the app shell and sensors work with no network, the LLM loads lazily
- **Event-bus architecture** ([aetheria-bus.js](aetheria-bus.js)) bridges the BLE sensor drivers into the app
- **Privacy by construction** — all processing is client-side; biodata and conversations stay on-device

## 🚀 Getting started

**Just use it** — open **[aetheriasos.com](https://aetheriasos.com)** in a WebGPU-capable browser (Chrome/Edge recommended for Web Bluetooth). Install it as an app from the address bar for offline use.

**Connect sensors** (optional) — pair a Muse and/or Polar H10 from the sidebar over Bluetooth. No pairing is needed to chat or explore frequencies.

**Run locally**
```bash
git clone https://github.com/Lilrobodue/Sophia-Aetheria-Oracle-Shaman.git
cd Sophia-Aetheria-Oracle-Shaman
# serve over http:// (Web Bluetooth + service workers need a secure/localhost origin)
python -m http.server 8000
# open http://localhost:8000
```

**Run the calibration harness** (once you've collected sessions)
```bash
node tools/calibration-harness.mjs --dir <your-session-folder>
```

## 🗺️ Repository map

| File | Purpose |
|---|---|
| `index.html` | The whole app — UI, oracle, frequency engine, neurofeedback |
| `athena-core.js` | Muse S Athena / Muse 2 BLE driver (EEG, fNIRS, PPG, IMU) |
| `polar-h10.js` · `polar-wiring.js` | Polar H10 driver + app integration |
| `hrv-analysis.js` | Time- and frequency-domain HRV |
| `spiral-wave.js` · `neurodynamics.js` | Traveling-wave & nonlinear-dynamics EEG analysis |
| `aetheria-signal.js` | Signal calibration gate + provenance |
| `interval-analysis.js` · `prescription-engine.js` | Harmonic coherence, dose protocols, protocol generation |
| `aetheria-bus.js` | Event bus linking sensors to the app |
| `transduction-solver.html` | Biological frequency-transduction model |
| `tools/calibration-harness.mjs` | Cross-session calibration with a held-out honesty lock |
| `sw.js` · `manifest.json` | PWA offline shell + install metadata |
| `*.md` | Design guides and the collection protocol |

---

## ⚖️ What this is — and isn't

Sophia is a tool for **self-awareness, reflection, and exploration**. Neurofeedback here is about noticing and getting to know your own states.

**This is not a medical device.** It does not diagnose, treat, or cure anything, and it makes no clinical claims. The frequency-healing framework and the transduction model are exploratory; their effects are treated as **hypotheses under active investigation**, held to a held-out-data standard before anything is asserted. Consumer EEG on dry electrodes has real limits, which the tooling discloses rather than hides. If you have a medical concern, talk to a qualified professional.

## 📜 License

Licensed under the **GNU Affero General Public License v3.0** — see [LICENSE](LICENSE).

## 🔗 Links

- **App:** [aetheriasos.com](https://aetheriasos.com)
- **Aetheria 432 Hz Player:** [aetheria432.com](https://aetheria432.com)

*Built with reverence and rigor — where the symbolic and the measurable meet.*

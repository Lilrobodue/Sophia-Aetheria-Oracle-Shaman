# Sophia Runtime Investigation — WebGPU Crash & Dependency Bump

**Target:** `Sophia-Aetheria-Oracle-Shaman/index.html` — worker source in `createInferenceWorkerSource()`
**Symptom:** WebGPU crashes on inference (not on load) on Android. Gemma 3 1B never loaded on any phone.
**Author:** analysis by Claude (Anthropic) in collaboration with Joseph Lewis — August 2026

**This is a diagnostic brief, not a change list.** Phases A–B are measurement. Do not skip to the bump — if the dual-runtime hypothesis is right, bumping alone won't fix it and you'll have changed two things at once with no way to attribute the result.

---

## 1. The finding

Transformers.js **v4 replaced the entire WebGPU backend** — JSEP (a JavaScript-shimmed execution provider) was swapped for a native WebGPU runtime rewritten in C++, developed jointly with the ONNX Runtime team and tested across ~200 architectures. Merged Feb 9, 2026 in PR #1382.

That PR explicitly closes the exact bugs Sophia is hitting:

| Issue | What it is |
|---|---|
| **#1205** | Android Chrome WebGPU crash — `"A valid external Instance reference no longer exists"` on `mapAsync`. **This is the literal string `isWebGPUDeviceLost()` matches on.** |
| **#1469** | `[WebGPU] JSEP crashes when running Gemma 3 (1b-it)` — the reason we removed `lite` |
| #1320 | Kokoro on Android WebGPU producing corrupted output |
| #1317 | WebGPU broken with q8 decoders |
| #1365, #952 | `RangeError: Array buffer allocation failed` |
| #1154 | Text-generation pipeline memory spike |

Sophia is already on `@huggingface/transformers@4.1.0`, so it *has* the native EP. The crash persists anyway. That's the puzzle this brief exists to solve.

## 2. Primary hypothesis: two ONNX runtimes in one worker

The worker imports **two independent ORT stacks**:

```js
import { pipeline, ... } from '.../@huggingface/transformers@4.1.0';   // bundles native WebGPU EP
import * as ort from '.../onnxruntime-web@1.23.2/dist/ort.all.bundle.min.mjs';  // JSEP era
```

The standalone `onnxruntime-web@1.23.2` exists solely for the `VLModel` 3-session loader (LFM2.5-VL's repo ships `embed_images` / `decoder` where Transformers.js's Llava class expects `vision_encoder` / `decoder_model_merged`). It predates the native EP.

Why this is suspect:
- Both stacks initialise WebGPU and request a `GPUDevice` in the same worker scope.
- `ort.env` is global mutable state. `ort.env.wasm.numThreads = 1` is set on the standalone instance; whether that leaks into or conflicts with the bundled runtime's config is not obvious from the outside.
- The failure is **on inference, not on load** — consistent with two runtimes coexisting fine until one actually dispatches compute.
- An independent report of the same symptom class was resolved precisely by moving off a JSEP ORT build onto a native-WebGPU-EP build (referencing this same PR and upstream ONNX Runtime issue #25227).

Not proven. That's what Phase B is for.

---

## 3. Phase A — instrument before changing anything

Cheap, no behaviour change, and it produces the evidence for everything downstream.

**A1. Capture the real device-lost reason.** Chrome 135+ ships descriptive reason codes on `GPUDevice.lost`. Sophia currently infers GPU death by regex-matching error strings, which is guesswork. Hook the actual promise wherever the device is first obtained:

```js
device.lost.then(info => {
    console.error('[worker] GPUDevice lost —', info.reason, '|', info.message);
    self.postMessage({ type: 'gpuLost', payload: { reason: info.reason, message: info.message } });
});
```
`reason` distinguishes a driver timeout from memory exhaustion from an explicit destroy. Those are three different fixes and right now you can't tell them apart.

**A2. Log which runtime is live.** At worker start, log `ort.env.versions` for the standalone instance and, if reachable, the bundled one. Confirm whether `globalThis.ort` is being clobbered by one or the other.

**A3. Log allocation at inference time, not load time.** The crash is on generate, which is when the KV cache allocates. Log `contextLength`, `maxTokens`, and — if available — `navigator.storage.estimate()` plus any WebGPU adapter limits, immediately before the first dispatch.

**Capture a baseline on the ROG Phone before touching code.** Three runs, one model (`agent-lite`, WebGPU), same prompt. Record: loads or not, crashes or not, `device.lost.reason`, tokens generated before death. That baseline is what every later phase is compared against — without it you're guessing whether things improved.

---

## 4. Phase B — the isolation test (the decisive one)

**Goal: determine whether the standalone ORT import is the cause.** Do this on a branch. It temporarily breaks the vision model; that's fine and expected.

1. Comment out the `import * as ort from 'onnxruntime-web@1.23.2'` line.
2. Comment out the entire `VLModel` class and the `'lfm2-vision'` branches in `onmessage`.
3. Comment out the `ort.env.wasm.numThreads = 1` line (it will throw without the import).
4. Remove `agent-vision` from the dropdown so it can't be selected.
5. Run the **same three-run protocol from Phase A** on the ROG Phone with `agent-lite`.

**Interpretation, decided in advance so the result isn't rationalised after the fact:**

- **Crash gone** → hypothesis confirmed. Proceed to Phase D; the goal becomes eliminating the second runtime permanently.
- **Crash unchanged** → hypothesis dead. Say so plainly in the commit message, don't quietly drop it. Move to Phase C, and if that also fails, the Adreno driver report (LiteRT issue #8065, which found the defect sits below the WebGPU API in Dawn's Vulkan backend or the driver itself) becomes the leading explanation — meaning WebGPU on that phone is not fixable from Sophia's side and the llama-server path is the answer.
- **Crash changed character** (different reason code, later in generation, intermittent) → partial contribution. Note the specifics; likely memory pressure with a second contributor.

---

## 5. Phase C — bump to 4.2.0

Only after Phase B has produced a result. `4.2.0` is current; Sophia is on `4.1.0`.

Bump **one dependency at a time**, in its own commit, re-testing every load path between. The existing pin comment already says this and it's correct — preserve that discipline and update the comment with the new rationale rather than deleting it.

Two v4 gotchas that will bite during testing:

**Logging is quieter now.** v4 hides ONNX Runtime WebGPU warnings by default. Set `env.logLevel = LogLevel.DEBUG` while testing (import `LogLevel` alongside `env`) or you'll lose the diagnostics you just added in Phase A. Revert to `WARNING` before shipping.

**Error strings may have changed.** The `unhandledrejection` regex — `/mapAsync|GPUBuffer|external Instance|device is lost|webgpu/i` — was written against JSEP's error text. The native C++ EP may phrase failures differently, which would cause silent infinite spinners (the exact failure that handler exists to prevent). Deliberately trigger a GPU failure after the bump and confirm the handler still catches it.

---

## 6. Phase D — try deleting the custom VL loader

Only if Phase B implicated the second runtime.

The pin comment says 4.1.0 was "first version registering `lfm2_vl`" — but registration was never the problem. The problem is that the HF repo ships components under Liquid's names while the Llava class expects its own, and the external-data references baked into each `.onnx` graph end up misaligned. Check whether v4.2.0 resolves the naming, then try:

```js
pipeline('image-text-to-text', 'LiquidAI/LFM2.5-VL-1.6B-ONNX',
         { dtype: { embed_images: 'fp16', decoder: 'q4' }, device: 'webgpu' })
```

If it loads and generates correctly, delete `VLModel` (~300 lines), delete the standalone ORT import, and the dual-runtime problem is gone permanently. That's the best available outcome here.

If it still fails, the second runtime has to stay — in which case bump it to a native-WebGPU-EP build rather than leaving it on 1.23.2, and accept that the vision model may need `agent-vision` gated behind a warning on mobile.

---

## 7. Phase E — re-test and possibly re-add Gemma 3

`lite` is already removed. Do **not** revert that commit — re-add it cleanly as a new entry if and only if it earns the slot.

Test `onnx-community/gemma-3-1b-it-ONNX` on the Z13 first (WebGPU, q4f16), then the ROG Phone. Issue #1469 is closed by the runtime Sophia is now running, so this is a genuine re-test, not wishful thinking.

- **Works on both** → re-add to Warm Voice, and restore it as the `getBestWasmModel()` target and the mobile downgrade target, reversing the §1 concessions in the previous brief. That gets back the only WASM-safe model above 0.5B.
- **Works on desktop only** → re-add with `webgpuOnly: true`, but leave `tiny` as the recovery model.
- **Still fails** → leave it deleted, and update the tombstone comment in `LOCAL_MODELS` to record that it was re-tested against transformers.js v4.x and still failed. That's a much stronger note than the current one and stops anyone re-litigating it later.

---

## 8. Commit sequence

```
1. diag: log GPUDevice.lost reason + runtime versions   (Phase A, ships regardless)
2. test: isolate standalone ORT import                  (Phase B, branch — may not merge)
3. deps: bump transformers.js 4.1.0 → 4.2.0             (Phase C)
4. refactor: drop custom VLModel loader                 (Phase D, only if B+C allow)
5. models: re-add Gemma 3 1B                            (Phase E, only if it passes)
```

Phase A ships regardless of outcome — better diagnostics are worth keeping either way.

---

## 9. Record the results

Whatever happens, write the outcome of each phase into the code as a comment, including the negative results. The current pin comment is a good example of the form: it says what was tested and why the version was chosen. Extend it rather than replacing it.

A negative result here is genuinely valuable — "we tested the dual-runtime hypothesis on 2026-08-XX, isolating the standalone ORT import changed nothing, crash persists on Adreno 830" saves the next person a day and points at the driver-level explanation instead.

---

## 10. Implementation log

### 2026-08-12 — Phase A shipped, Phase B armed, Phase C found already done

**Correction to §1.** The brief says Sophia is on `@huggingface/transformers@4.1.0`. It is on **4.2.0** — that bump landed earlier for an unrelated reason (the `tools` option on `TextGenerationPipeline`, PR #1655). So **Phase C is already complete** and cannot be credited with fixing or failing to fix anything. Every v4 improvement the brief cites — the native C++ WebGPU EP from PR #1382, closing #1205 and #1469 — is already in the shipping build, and the crash persists anyway. The pin comment in `createInferenceWorkerSource()` records this.

The standalone `onnxruntime-web@1.23.2` import is untouched and *is* still JSEP-era, so the dual-runtime hypothesis stands exactly as written.

**Phase A — shipped (v82).** All measurement, no behaviour change:

| Brief | What was built | Where it shows up |
|---|---|---|
| A1 | `navigator.gpu.requestAdapter` / `requestDevice` are wrapped in the worker, so every `GPUDevice` is hooked at creation — `device.lost` with the real `reason` code, plus `uncapturederror` | `gpuDeviceLost`, `gpuUncapturedError` |
| A2 | Runtime census at worker start *and* after load: both ORT versions, and `bundled.env === ort.env` — one boolean that answers "one runtime or two" | `runtimeCensus.sameOrtEnv` |
| A2+ | Each GPU device request is attributed to the bundle that made it by reading the CDN URL out of the call stack, and devices are counted — **a second `GPUDevice` in one worker is the hypothesis, confirmed** | `gpuDeviceCreated.requester`, `.deviceIndex` |
| A3 | Pre-dispatch snapshot: prompt size, `max_new_tokens`, adapter limits, GPU vendor/architecture, storage estimate (first generation only — it walks quota accounting and this runs on the path to every reply) | `preDispatch` |
| A3+ | Tokens streamed in the current generation, reported on both success and failure — "how far did it get before it died" | `tokensThisGen` |

Two additions the brief implies but doesn't name:

- **Unmatched rejections are now recorded too.** §5 warns the native EP may reword its errors, which would slip past the `unhandledrejection` regex and hang the UI forever. Every rejection that does *not* match is logged as `unhandledRejectionUnmatched` with its full text, so the phrasing that got away is in the export instead of lost.
- **`env.logLevel = LogLevel.WARNING`**, per §5. v4 defaults to `ERROR`, which hides ORT's WebGPU warnings. `?verboseWorker=1` raises it to `DEBUG` for a session.

**Reading the results off a phone.** The device that crashes has no devtools attached, so a `console.log` there is a measurement nobody can read. **Settings → Local Model → 🩺 Copy runtime diagnostics** puts the whole session — UA, device memory, adapter, every event above — on the clipboard as JSON. `window.sophiaRuntimeDiag()` does the same in a desktop console.

**Phase B — armed, not yet run.** Deviation from §4, deliberately: the brief says do it on a branch, but the device under test is a phone and WebGPU needs a secure context, so a branch means a deploy — a second variable in an experiment whose entire point is changing one thing. Instead the same build runs both arms:

```
?ortIsolation=1     isolation ON  — standalone ORT import and its ort.env line are
                                    stripped from the worker source at spawn time
?ortIsolation=0     isolation OFF — byte-identical worker source to before this change
```

The choice sticks in `localStorage` so relaunching from the home screen (which drops the query string) can't silently flip the arm mid-test, and an amber banner in the model card says which arm is live. `agent-vision` is disabled while isolation is on, in the picker and again at load — it is the only model that uses the standalone runtime.

`test-worker-source.js` applies the *real* isolation regexes to the *real* worker source and asserts they still match. Without that, an edit that quietly stopped matching would make the isolation arm run identically to the control and report "hypothesis dead" — a false negative that would be believed.

**`test-worker-diag.mjs` is new.** It runs the worker under stub runtimes and a fake WebGPU that can be made to lose its device on demand, and asserts the measurements actually come out — a probe that silently never fires looks exactly like a device that never lost its GPU, which is the wrong conclusion drawn from real-looking evidence. It also caught a genuine harness gap: both test files were checking the *raw* template-literal text rather than the string the browser builds, so escape sequences were being validated in a form that never runs. Both now evaluate it the way the browser does.

### 2026-08-12, later — first measurements from the ROG Phone (Adreno 8xx, Chrome 151)

Two runs on `agent-lite` / WebGPU, isolation OFF. **The primary hypothesis did not survive them, and the failure turned out to be something the app was actively misreporting.**

| | Run 1 | Run 2 |
|---|---|---|
| Prompt | ~1427 tokens | ~1885 tokens (2 more tools) |
| Load | 2158 ms | 1897 ms |
| Result | **147 tokens, clean** | **died at 25 s, 0 tokens** |
| `gpuDevices` | 1 | 1 |

#### §2 dual-runtime hypothesis — not supported. Say it plainly.

Both runs created **exactly one `GPUDevice`** in the worker. The only `requestAdapter` chain that resolves to a named bundle is transformers.js's own init (`gd.init → I2 → Od` inside `@huggingface/transformers@4.2.0`). The standalone `onnxruntime-web@1.23.2` is loaded but never asked for a device — which fits, since it is `VLModel`'s dependency and `VLModel` only runs when `agent-vision` is selected.

**Phase B is therefore demoted, not run.** The census answered the question that Phase B existed to answer, more cheaply and without breaking the vision model. The `?ortIsolation=1` arm stays in the build as a cross-check if a later capture ever shows a second device; it is no longer the next step. Phase D (delete `VLModel`) loses its motivation with it — the second runtime is not costing GPU state, only download and memory.

#### What is actually happening

```
vkQueueSubmit failed with VK_ERROR_DEVICE_LOST
  at CheckVkSuccessImpl (third_party/dawn/src/dawn/native/vulkan/VulkanError.cpp:104)
```

then, downstream of an already-dead device:

```
onnxruntime/core/providers/webgpu/buffer_manager.cc:553 — Failed to execute 'mapAsync' on 'GPUBuffer'
```

Three things follow:

1. **The native EP is genuinely what's running** — that ORT path is the C++ WebGPU EP, not JSEP. So this is not a stale-runtime problem. §1's premise holds; its conclusion doesn't.
2. **It is a timeout, not memory.** `maxBufferSize` was 2 GB, no allocation failed anywhere in the capture, and the device survived 25 seconds of work before the driver took it. `VK_ERROR_DEVICE_LOST` on `vkQueueSubmit` after a long submission is the classic Adreno watchdog kill. This is the brief's own fallback explanation (§4, LiteRT #8065 — the defect sits below the WebGPU API in Dawn's Vulkan backend or the driver), now with direct evidence.
3. **It scales with the prompt, not the answer.** Run 2 died in the *prefill*, before emitting a single token, on a prompt 32% larger than the one that worked. Generation length and KV-cache growth are not implicated — which also means the disposal work from v76 is not what's failing here.

#### Fixed as a result

**The app was calling this an out-of-memory.** `isGpuExhaustion()` matches `mapAsync`, the mapAsync error arrives after the device is already gone, so every driver abort was reported as "The GPU ran out of memory" and the advice was Force WASM. That sends someone to the slow path over what is really a prompt-length problem.

There is now a `gpuFailureCause()` that prefers the `GPUDevice.lost` record — the primary event — over whatever the runtime throws afterwards, and separates `driver-abort` from a genuine `oom`. Recovery is unchanged (the session is dead either way); only the diagnosis and the advice change. Failures now also carry `phase` (prefill vs decode) and `msSinceDispatch`.

#### Instrument gaps the capture exposed, now closed

- `requester` came back **"unknown"** for the call that actually created the device: ORT's WebGPU EP asks from inside its compiled wasm module through a glue blob, so no CDN URL survives in the stack. Now named as such — and settled from the other end by a probe on `ort.InferenceSession.create`, since `VLModel` is the standalone runtime's only caller. **If `standaloneOrtSessions` is 0 while a device exists, the device is transformers.js's.**
- `sameOrtEnv` came back **null** both times: `env.backends.onnx` is not where transformers.js v4 keeps its ORT handle. Rather than guess the new path, the census now reports the keys of `env.backends` so the next capture says where to look.
- A **lone backslash inside the worker template literal** is eaten when the page evaluates it — `/wasm:\/\/wasm/` shipped as `/wasm://wasm/`, a syntax error invisible in the file. Same class as the stray-backtick bug. `test-worker-source.js` now rejects any un-doubled backslash in the literal.

### 2026-08-12, batch 2 — the mechanism, settled

| Prompt | Tools | Result | GPU time |
|---|---|---|---|
| ~1885 tok | 8 | **died in prefill** | 24.73 s |
| ~934 tok | 5 | 215 tokens, clean | **39.32 s** |

**It reproduced exactly.** The same ~1885-token prompt died at 24.73 s, against 25.2 s the day's first time — half a second apart. Thermal flakiness does not repeat to within 2%. This is deterministic, and a deterministic failure is a predictable one.

**And the second row settles what kind of limit it is.** That generation did *more* total GPU work than either crash — 39.3 seconds against ~25 — and finished comfortably. So it is not cumulative time, not heat, and not a session-lifetime budget. It is **how long a single submission may run before the driver reclaims the device**. Prefill is one enormous dispatch; decode is hundreds of small ones. That is exactly why decode never dies and prefill always does.

Open question 1 (determinism) is answered: yes. Question 3 (`max_new_tokens`) is answered without needing the run: the 934-token prompt asked for the same 1024 and sailed through, so the output ceiling is irrelevant to this failure and `localGenerationCap()` should not be touched for it.

#### The remaining instrument gaps, closed by these captures

- `requester` on the device-creating call now reads **"ONNX Runtime wasm EP (glue blob)"** rather than "unknown", and `standaloneOrtSessions` stayed **0** through every run — including the ones that crashed. Combined with `gpuDevices: 1`, the standalone runtime is confirmed inert on text-only paths. **The dual-runtime hypothesis is now closed, not merely unsupported.**
- `sameOrtEnv` was null again, but the capture printed the shape and gave the answer away: `env.backends.onnx` has keys `wasm, webgl, webgpu, versions, logLevel, setLogLevel` — it *is* the bundled runtime's env object in v4, not the ORT module. The census now compares it to `ort.env` directly and also flags whether `numThreads = 1` leaked across.
- **Tool schemas were not being counted.** They arrive beside the messages and are rendered into the prompt by the chat template, so the GPU prefills them like any other text — but `promptChars` only summed message content. Every capture under-reported the real prompt. Now `toolCount`, `toolChars` and a corrected `approxPromptTokens` are recorded, which matters when the quantity being measured *is* a prefill-size ceiling.

#### Acted on: the device measures its own ceiling

A hard-coded token cap would be wrong — the number belongs to one phone, one driver, one model, one quantisation, and no two devices will share it. So Sophia now keeps a **prefill ledger** in `localStorage`, keyed by model *and* backend:

- every completed generation records the prompt size that **worked** (`maxOk`);
- every driver abort *during prefill* records the size that **killed it** (`minFail`);
- `localPromptBudget()` clamps to `maxOk` — but only once a failure exists to justify it. **No failures on record → no clamp at all**, so a healthy device is never restricted by someone else's crash.
- a size that once worked but now kills is discarded rather than trusted.

The history trimmer can shrink messages, but it cannot drop tools — those are the user's choice. So when a prompt reaches a size that has already killed this device, Sophia says so *before* spending 25 seconds finding out again, and names the lever that actually moves: the tool list, with its token cost spelled out.

`test-prefill-ledger.mjs` covers the rules, including the ones that are easy to get subtly wrong: no-evidence-no-clamp, stale optimism, per-backend isolation, and a floor that stops absurd evidence starving the prompt entirely.

### 2026-08-12, batch 3 — `agent-qwen-mini`, and the prompt-size story falls over

| Prompt | Result | GPU time | Out |
|---|---|---|---|
| ~582 tok | **died in prefill** | **464 s** (7m 44s) | 0 |
| ~678 tok | 592 tokens, clean | 269.6 s | 592 |

**A larger prompt succeeded where a smaller one had just killed the device.** Prompt size does not decide this — not for this model, and so not as a general rule. Anything that clamped or warned at 582 tokens would have been nagging about a size demonstrably capable of producing a 592-token answer.

That is a real defect in what v84 was about to ship, caught by the data before it reached anyone, and it is fixed: the ledger now recognises **contradicted evidence**. Where a prompt larger than the recorded failure has since completed, both the clamp and the warning stand down entirely. The failure stays on the record for diagnostics; nothing acts on it. Better to protect nobody than to be confidently wrong.

Nor is it a fixed wall-clock budget. All six runs on this phone:

| Model | Prompt | Result | ms |
|---|---|---|---|
| agent-lite q4 | 1427 | ✅ | 16 700 |
| agent-lite q4 | 934 | ✅ | 39 323 |
| agent-lite q4 | 1885 | ❌ | 25 249 |
| agent-lite q4 | 1885 | ❌ | 24 734 |
| qwen-mini q4f16 | 582 | ❌ | 464 229 |
| qwen-mini q4f16 | 678 | ✅ | 269 595 |

One run survived 269 s; another died at 25 s. No duration threshold separates them either.

#### The one invariant that has held six times out of six

**Every failure happened before the first token, and nothing has ever died after it.** Prefill — and whatever precedes it — is the entire window of risk. Decode has never once failed, at any length, on any model. The worker now times that boundary explicitly (`msToFirstToken`, and its absence on failure) instead of reasoning about total generation time, which mixes the dangerous part with the safe part.

#### Leading explanation now: first-run shader compilation

464 seconds is far too long for a 582-token prefill on a 0.8B model. That run was the **first this device had ever done with `agent-qwen-mini`**; the second — with Chrome's shader cache warm — completed a *larger* prompt in *less* time. First-run WebGPU pipeline compilation on Adreno is slow enough to plausibly cost hundreds of seconds, and it sits exactly where every failure sits: before the first token.

This is a hypothesis, not a result. `?verboseWorker=1` now captures ONNX Runtime's own DEBUG output into the diagnostics export (verbose mode only, capped at 300 lines) — if it is compiling shaders for seven minutes, that log will say so in as many words. The ledger also counts completed `runs` per model+backend, so a first-of-its-kind run is identifiable after the fact.

### 2026-08-12, batch 4 — `agent-lite` warm, 1519 tokens, 8 tools: **clean**, 325 tokens in 67.3 s

Which narrows `agent-lite` to **1519 ✅ … 1885 ❌**, and — read against the clock — separates the two failure modes for good:

```
17:22  agent-lite  1427  OK      <- shader cache warm from here on
17:31  agent-lite  1885  FAIL
18:16  agent-lite  1885  FAIL
18:22  agent-lite   934  OK
18:52  qwen-mini    582  FAIL    <- first run of this model on this device
19:02  qwen-mini    678  OK
19:26  agent-lite  1519  OK
```

**`agent-lite` had already completed a generation before both of its failures**, and completed two more around them. Shader compilation cannot explain a failure that repeats 45 minutes apart on a warm cache while smaller prompts sail through. That is a genuine prefill-size wall.

`qwen-mini` is the opposite shape: a first-ever run costing 464 s, then a *larger* prompt succeeding once warm.

#### So: two mechanisms, one invariant

There are two ways to exhaust the driver's patience — a prompt too large to prefill in one go, and a first run that spends minutes compiling shaders — and only one thing they share: **both spend too long before the first token.**

This is what the per-model ledger was for, and batch 4 validates the design without a change:

| Model | Evidence | Ledger's verdict |
|---|---|---|
| `agent-lite\|webgpu` | maxOk 1519, minFail 1885 | **clamp to 1519** — a real, earned ceiling |
| `agent-qwen-mini\|webgpu` | maxOk 678, minFail 582 | **contradicted — stand down**, no clamp, no warning |

Both answers are correct, and neither is a number anyone chose. Failure records now also carry `firstEverRun`, so the two modes stay distinguishable in future exports.

### Still open

1. **Test the compile hypothesis.** Pick a model never yet run on the phone (`reason-lite`), load it with `?verboseWorker=1`, send a short prompt, export.
2. **If confirmed, add a warm-up.**
3. **Where exactly is `agent-lite`'s wall?** Bracketed 1519–1885.
4. **Phase E** (re-test Gemma 3 1B on Z13, then ROG) — untouched, can run whenever. `lite` stays deleted until it earns the slot.
5. Phase B (`?ortIsolation=1`) — **closed by measurement.**

---

## 11. 2026-08-12, batch 5 (v84) — **the answer**

`reason-lite`, never run on this device before:

| Prompt | Result | Time to first token |
|---|---|---|
| ~949 tok | 656 tokens, clean | **13 998 ms** |
| ~1949 tok | **died in prefill** | never — killed at 25 881 ms |

The first row is the measurement every earlier batch was missing: a prefill **rate**, 14.75 ms/token, from a run that worked. Apply it to every LFM2.5-1.2B-q4 run this phone has ever done:

| Prompt | Predicted prefill | Actual |
|---|---|---|
| 934 | 13.8 s | ✅ |
| 949 | 14.0 s | ✅ |
| 1427 | 21.0 s | ✅ |
| 1519 | 22.4 s | ✅ |
| 1885 | **27.8 s** | ❌ killed at 25.25 s |
| 1949 | **28.7 s** | ❌ killed at 25.88 s |

**Every success predicts under 22.5 s. Every failure predicts over 27.5 s. All three deaths landed between 24.73 and 25.88 s.**

> **This device kills a GPU submission that runs longer than about 25 seconds.**

Token counts were only ever a proxy for that, and one that breaks across models — precisely what qwen-mini's 582-token failure against agent-lite's 1519-token success was. Time explains every run in the investigation, across three models, with no exceptions.

### It also kills the shader-compilation hypothesis

This was `reason-lite`'s **first ever run** on the device, and its first token arrived in **14 seconds — not 464**. First-run compilation is not a meaningful cost on the ordinary text-generation path. `qwen-mini`'s 464 s stands alone and remains unexplained; note it is the only model here on the `qwen35-vision` path (`AutoProcessor` + vision tower), a much heavier first-run setup. Recorded as an open anomaly rather than folded into the general theory. The `?verboseWorker=1` capture built for this test stays — it is how that anomaly gets read.

### The ledger is now built on time

The two quantities generalise differently, so they are stored differently:

| | Belongs to | Measured from |
|---|---|---|
| **kill threshold** | the **device** — 24.7, 25.2, 25.9 s across two models | `msSinceDispatch` on a driver abort |
| **prefill rate** | the **model** (size, quant, backend) | `msToFirstToken` on runs that worked |

So a model that has **never crashed here is protected on its first oversized prompt** — it inherits the device's demonstrated patience and applies its own measured rate. Token counting could never do that.

Two thresholds, because they do different jobs and the data supports both without inventing either:

- **Clamping** the prompt budget is cheap and invisible (it trims history), so it aims at the longest prefill this device has actually **completed**.
- **Warning** the user interrupts them, so it fires only at a duration that has actually **killed** a submission here.

The true limit lies between those two numbers, and neither is a constant anyone chose. The one remaining judgement call is documented at `PREFILL_SAFETY` and applies only to a device that has lost a GPU but has no successful prefill timing to compare against.

The warning now speaks in seconds, because that is what the device limits and what a person can act on: *"this prompt needs about 29 seconds of GPU work before Sophia can say a word, and this phone's driver has given up at 25."*

### Also fixed by this batch

- `firstEverRun` reported `false` for a genuine first run — the counter was incremented before the flag was computed. Caught in batch 5's own export.
- `standaloneNumThreadsLeaked` was an **inference dressed as a fact**: the bundled runtime's `numThreads` went from undefined to 1 after load, which looks like our `ort.env.wasm.numThreads = 1` leaking across — but transformers.js sets its own to 1 in a worker without cross-origin isolation, which looks identical. Replaced with `sameWasmConfig`, an object-identity test, with the inferred value kept beside it and labelled as such.
- The census finally reads: bundled ORT is **1.24.0-dev / web 1.26.0-dev**, standalone is **1.23.2**, `sameOrtEnv: false`. Two runtimes confirmed — and `standaloneOrtSessions` still 0, so the second one still never runs anything.

---

## 12. 2026-08-12, batch 6 (v85) — the prediction holds; the protection didn't fire

`agent-lite`, 1898 tokens: **died in prefill at 25 255 ms**. Predicted 1898 × 14.75 = 28.0 s against a ~25 s limit — the model called it exactly. Seventh run, seventh time the theory holds.

But the ledger did nothing to stop it, and the export says precisely why. Two defects, both found by the data rather than by reading the code.

**1. `msToFirstToken` never reached the page.** It went into the diag record but was left out of the `genDone` *message*, so `recordPrefillOutcome(..., payload.msToFirstToken)` received `undefined` on every single successful run. The ledger has therefore never learned a rate — visible in batch 6's own export as `"ms": null` against a `genDone` that plainly had a first-token time of 90 279 ms. The entire time-based model was disconnected from its only input. One missing line.

**2. A model whose only history is a crash got no protection at all.** Both ceilings required a *success*: the size-based one needs `maxOk`, the time-based one needs a rate measured from a completed run. `agent-lite` had failed twice and still had neither, so nothing could clamp and nothing could warn.

That second one is a design gap, not a slip, and it has a principled fix: **a prefill that was still running when the driver killed it bounds the rate from below** — it had not finished 1898 tokens in 25 273 ms, so the model is at least that slow. Weaker than a measurement, and flagged as `rateIsLowerBound` everywhere it is used, but real information. Applied to batch 6's own numbers it yields a ceiling of ~1518 tokens — inside the 1519 ✅ / 1885 ❌ bracket the device actually demonstrated.

Also fixed: `msToFirstToken` now uses `-1` for "not measured", so a genuine 0 ms reading can never be mistaken for an absent one.

### What the ledger looked like going in

```
reason-lite|webgpu   maxOk 949, minFail 1949     ← recorded under v84: no rate
tiny|wasm            maxOk 1949
(no __device entry)                              ← device kill time is v85+
(no agent-lite entry)                            ← its failures predate the ledger
```

Nothing to protect with. The v83–v84 history is not recoverable, so the first few generations on v86 are the ledger's real first light.

### Still open

1. **Does the protection actually fire now?** The confirmation is a *non-event*: on v86, `agent-lite` at ~1900 tokens should be trimmed or warned rather than killing the device. It needs one completed generation on that model first to learn a rate — or, failing that, it now derives a bound from the crash it already had.
2. **`qwen-mini`'s 464 s.** The only run in the investigation that time-per-token cannot explain, and the only one on the `qwen35-vision` path. One repeat with `?verboseWorker=1` would show what those minutes went on.
3. **Phase E** (re-test Gemma 3 1B on Z13, then ROG) — untouched, can run whenever. `lite` stays deleted until it earns the slot.
4. Phase B (`?ortIsolation=1`) — **closed by measurement.** Retained as a cross-check only.

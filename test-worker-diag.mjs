/* test-worker-diag.mjs — SOPHIA_RUNTIME_BRIEF Phase A instrument check.
 *
 * test-worker-source.js proves the worker PARSES and that the diagnostic code
 * is present. That is not the same as it FIRING. The whole value of Phase A is
 * that the baseline runs on the ROG Phone produce trustworthy data, and a probe
 * that silently never fires would look exactly like a device that never lost
 * its GPU — the wrong conclusion, drawn from real-looking evidence.
 *
 * So this extracts the worker source, swaps the two CDN imports for local stubs,
 * runs it under a fake WebGPU that can be made to lose its device on demand, and
 * asserts the measurements actually come out.
 *
 * Plain node, no dependencies:  node test-worker-diag.mjs                     */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

// ── Extract the worker source (same contract as test-worker-source.js) ──────
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const BT = String.fromCharCode(96);
const fnAt = html.indexOf('function createInferenceWorkerSource()');
const open = html.indexOf('return ' + BT, fnAt);
const start = open + ('return ' + BT).length;
let end = -1;
for (let i = start; i < html.length; i++) {
  if (html[i] === '\\') { i++; continue; }
  if (html[i] === BT) { end = i; break; }
}
const rawSrc = html.slice(start, end);
// Evaluate the template literal exactly as the browser does — escape sequences
// inside it mean different things to a raw slice than to the string that
// actually runs, and it is the latter this harness must exercise.
let src = new Function('return ' + BT + rawSrc + BT)();
ok(src.length > 40000, 'extracted the whole worker');

// ── Stub the two runtimes ───────────────────────────────────────────────────
// Deliberately two DIFFERENT env objects, mirroring the real arrangement the
// dual-runtime hypothesis is about — so the census has something true to find.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophia-diag-'));
const write = (name, body) => { fs.writeFileSync(path.join(dir, name), body); return './' + name; };

// The stub filenames carry the CDN package names on purpose: the worker works
// out WHICH runtime asked for a GPU device by looking for those names in the
// call stack, and that attribution is the core evidence for the hypothesis.
write('transformers-stub.mjs', `
export async function initWebGPU() {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter.requestDevice();
}
export const LogLevel = Object.freeze({ DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, NONE: 50 });
export const env = {
    allowLocalModels: true, useBrowserCache: false, logLevel: LogLevel.ERROR,
    backends: { onnx: { env: { versions: { common: '1.24.0-bundled', web: '1.24.0-bundled' }, wasm: { numThreads: 4 } } } },
};
export class TextStreamer {
    constructor(tokenizer, opts) { this.tokenizer = tokenizer; this._cb = (opts || {}).callback_function; }
}
export async function pipeline(task, modelId, opts) {
    if (opts && opts.progress_callback) opts.progress_callback({ status: 'progress', progress: 50 });
    const fn = async (messages, o) => {
        globalThis.__PIPE_CALLS__.push({ messages, o });
        if (globalThis.__PIPE_THROW__) throw new Error(globalThis.__PIPE_THROW__);
        if (o && o.streamer && o.streamer._cb) { o.streamer._cb('one'); o.streamer._cb('two'); o.streamer._cb('three'); }
        return [{ generated_text: 'onetwothree' }];
    };
    fn.tokenizer = { name: 'stub' };
    return fn;
}
export const AutoProcessor = { from_pretrained: async () => ({}) };
export const AutoTokenizer = { from_pretrained: async () => ({}) };
export class Gemma4ForConditionalGeneration {}
export class Qwen3_5ForConditionalGeneration {}
export class RawImage {}
export async function read_audio() { return new Float32Array(0); }
`);

write('onnxruntime-web-stub.mjs', `
export async function initWebGPU() {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter.requestDevice();
}
export const env = { versions: { common: '1.23.2', web: '1.23.2' }, wasm: { numThreads: 4 }, webgpu: {} };
export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
export const InferenceSession = { create: async () => ({ run: async () => ({}), release: async () => {} }) };
`);

src = src
  .replace(/^import \{([\s\S]*?)\} from 'https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers[^']*';$/m,
           "import {$1} from './transformers-stub.mjs';")
  .replace(/^import \* as ort from 'https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web[^']*';$/m,
           "import * as ort from './onnxruntime-web-stub.mjs';");
ok(!/cdn\.jsdelivr\.net/.test(src), 'both CDN imports were stubbed out');

// ── Fake worker globals ─────────────────────────────────────────────────────
const posted = [];
const listeners = {};
const fakeSelf = {
  postMessage(msg) {
    // A real Worker structured-clones. Anything that would throw here is a
    // measurement that silently never arrives.
    try { structuredClone(msg); } catch (e) { ok(false, 'postMessage payload is not cloneable: ' + JSON.stringify(msg && msg.type) + ' — ' + e.message); }
    posted.push(msg);
  },
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
};

let lostResolve;
const makeDevice = (limits) => {
  const handlers = [];
  return {
    limits,
    lost: new Promise((res) => { lostResolve = res; }),
    addEventListener(type, fn) { if (type === 'uncapturederror') handlers.push(fn); },
    _fireUncaptured(err) { handlers.forEach((h) => h({ error: err })); },
    destroy() {},
  };
};

let deviceA, deviceB;
const fakeAdapter = {
  info: { vendor: 'qualcomm', architecture: 'adreno-830', device: '', description: 'Adreno (TM) 830' },
  limits: { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupStorageSize: 16384 },
  async requestDevice() {
    if (!deviceA) { deviceA = makeDevice(this.limits); return deviceA; }
    deviceB = makeDevice(this.limits);
    return deviceB;
  },
};
const fakeGpu = { async requestAdapter() { return fakeAdapter; } };

globalThis.self = fakeSelf;
globalThis.__PIPE_CALLS__ = [];
globalThis.__PIPE_THROW__ = null;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    gpu: fakeGpu,
    storage: { estimate: async () => ({ usage: 3_221_225_472, quota: 8_589_934_592 }) },
    userAgent: 'node-test',
  },
});

const workerPath = write('worker.mjs', src);
const diagOf = (event) => posted.filter((m) => m.type === 'diag' && m.payload.event === event);
const settle = () => new Promise((r) => setTimeout(r, 0));

console.log('--- the worker loads under stubs ---');
await import(pathToFileURL(path.join(dir, path.basename(workerPath))).href);
await settle();

console.log('--- A2: the runtime census runs at worker start ---');
const census = diagOf('runtimeCensus');
ok(census.length === 1, 'one census at start, got ' + census.length);
const c0 = census[0] && census[0].payload;
ok(c0 && c0.when === 'worker-start', 'it is labelled worker-start');
ok(c0 && c0.standalone && c0.standalone.versions.common === '1.23.2',
   'it reads the standalone runtime version');
ok(c0 && c0.bundled && c0.bundled.versions.common === '1.24.0-bundled',
   'and the version bundled inside transformers.js');
ok(c0 && c0.sameOrtEnv === false,
   'and reports two independent ORT env objects — the dual-runtime question, answered');
ok(diagOf('gpuProbeInstalled').length === 1, 'the GPU probe installed itself');

console.log('--- Phase C: log level ships at WARNING, not v4 default ERROR ---');
const tjs = await import(pathToFileURL(path.join(dir, 'transformers-stub.mjs')).href);
ok(tjs.env.logLevel === tjs.LogLevel.WARNING, 'env.logLevel === WARNING at load, got ' + tjs.env.logLevel);
ok(tjs.env.allowLocalModels === false && tjs.env.useBrowserCache === true, 'the existing env contract is untouched');

console.log('--- A1: the device is intercepted where the runtime creates it ---');
const adapter = await navigator.gpu.requestAdapter();
ok(diagOf('gpuRequestAdapter').length === 1, 'requestAdapter is observed');
ok(diagOf('gpuAdapterInfo').length === 1, 'adapter info is captured');
const info = diagOf('gpuAdapterInfo')[0].payload;
ok(info.vendor === 'qualcomm' && info.architecture === 'adreno-830',
   'including vendor/architecture — the Adreno driver question needs this on the record');
ok(diagOf('gpuAdapterLimits').length === 1, 'adapter limits are captured');

const dev = await adapter.requestDevice();
await settle();
const created = diagOf('gpuDeviceCreated');
ok(created.length === 1, 'the device creation is observed');
ok(created[0].payload.deviceIndex === 1, 'counted as device 1');
ok(created[0].payload.limits.maxBufferSize === 268435456, 'with the real device limits');

console.log('--- A1: an uncaptured GPU error is recorded ---');
dev._fireUncaptured({ message: 'Buffer allocation failed' });
await settle();
const unc = diagOf('gpuUncapturedError');
ok(unc.length === 1, 'uncapturederror reaches the log');
ok(unc[0].payload.message === 'Buffer allocation failed', 'with its message');

console.log('--- the dual-runtime smoking gun is detectable AND attributable ---');
// Requested from inside the standalone-ORT stub, so the call stack is the real
// article: this is the shape the evidence takes if the hypothesis is true.
const ortStub = await import(pathToFileURL(path.join(dir, 'onnxruntime-web-stub.mjs')).href);
await ortStub.initWebGPU();
await settle();
const created2 = diagOf('gpuDeviceCreated');
ok(created2.length === 2, 'a second GPUDevice is counted separately');
ok(created2[1].payload.deviceIndex === 2, 'as device 2');
ok(/SECOND GPUDevice/.test(created2[1].payload.note || ''), 'and flagged in the record itself');
ok((created2[1].payload.stack || '').length > 0,
   'the call stack is captured — an escape-mangled split would silently empty this');
ok(/onnxruntime-web/.test(created2[1].payload.requester || ''),
   'and blamed on the standalone runtime, got: ' + created2[1].payload.requester);

await tjs.initWebGPU();
await settle();
const created3 = diagOf('gpuDeviceCreated');
ok(created3.length === 3, 'a third device is counted');
ok(/transformers/.test(created3[2].payload.requester || ''),
   'and blamed on transformers.js, got: ' + created3[2].payload.requester);

console.log('--- load / generate: A3 fires on the path to a real answer ---');
await fakeSelf.onmessage({ data: { type: 'load', payload: {
  modelId: 'stub/model', modelType: 'text-generation', dtype: 'q4', device: 'webgpu', verboseLogs: true } } });
await settle();
ok(diagOf('loadStart').length === 1, 'the load is recorded');
ok(tjs.env.logLevel === tjs.LogLevel.DEBUG, 'verboseLogs raises ORT logging to DEBUG on request');
ok(diagOf('loadDone').length === 1, 'and so is the finish');
ok(typeof diagOf('loadDone')[0].payload.ms === 'number', 'with how long it took');
ok(diagOf('runtimeCensus').length === 2, 're-censused after load, when transformers.js has bound its ORT');
ok(posted.some((m) => m.type === 'loaded'), 'the page still gets its loaded message');

await fakeSelf.onmessage({ data: { type: 'generate', payload: {
  messages: [{ role: 'user', content: 'a'.repeat(400) }], max_new_tokens: 384, temperature: 0.7 } } });
await settle();
const pre = diagOf('preDispatch');
ok(pre.length === 1, 'the pre-dispatch snapshot fires');
ok(pre[0].payload.approxPromptTokens === 100, 'sized from the actual prompt, got ' + pre[0].payload.approxPromptTokens);
ok(pre[0].payload.maxNewTokens === 384, 'and carries the token ceiling');
ok(pre[0].payload.storageUsedMB === 3072, 'with the storage estimate on the first generation');
ok(pre[0].payload.gpuDevices === 3, 'and how many GPU devices are live, got ' + pre[0].payload.gpuDevices);
ok(pre[0].payload.adapter && pre[0].payload.adapter.architecture === 'adreno-830', 'and which GPU');

const done = posted.filter((m) => m.type === 'genDone');
ok(done.length === 1, 'the generation completes');
ok(done[0].payload.tokensThisGen === 3, 'reporting how many tokens it produced, got ' + done[0].payload.tokensThisGen);

// Second generation: the estimate must NOT be taken again (it walks the quota
// accounting, and this runs on the path to every reply).
await fakeSelf.onmessage({ data: { type: 'generate', payload: {
  messages: [{ role: 'user', content: 'hi' }], max_new_tokens: 64 } } });
await settle();
ok(diagOf('preDispatch').length === 2, 'the snapshot fires on the second generation too');
ok(diagOf('preDispatch')[1].payload.storageUsedMB === undefined,
   'but the storage estimate is taken once per load, not once per reply');

console.log('--- A1: device loss reports a REASON, not a matched string ---');
// Verbatim from the ROG Phone capture of 2026-08-12 — the point of this harness
// is that the pipeline handles what the device actually produces, not a stand-in.
const REAL_VULKAN_LOSS = 'vkQueueSubmit failed with VK_ERROR_DEVICE_LOST\n' +
  ' - While handling unexpected error type DeviceLost when allowed errors are Validation.\n' +
  ' at CheckVkSuccessImpl (../../third_party/dawn/src/dawn/native/vulkan/VulkanError.cpp:104)\n';
lostResolve({ reason: 'unknown', message: REAL_VULKAN_LOSS });
await settle();
const lost = posted.filter((m) => m.type === 'gpuLost');
ok(lost.length === 1, 'the page is told the device died');
ok(lost[0].payload.reason === 'unknown',
   'with the reason code — which on Adreno is "unknown", so the MESSAGE is the evidence');
ok(/VK_ERROR_DEVICE_LOST/.test(lost[0].payload.message), 'and the driver message that names the real fault');
ok(lost[0].payload.generations === 2, 'after how many generations');
ok(typeof lost[0].payload.tokensThisGen === 'number', 'and how far into the current one');
ok(lost[0].payload.phase === 'idle', 'a loss between generations is marked idle, not blamed on one');
ok(diagOf('gpuDeviceLost').length === 1, 'and it lands in the diagnostics record too');

console.log('--- why it died: a driver abort is not an out-of-memory ---');
// The failure the ROG Phone actually produced on 2026-08-12: the device dies
// with a Vulkan error, and the runtime then reports the mapAsync it could no
// longer complete. Before this, the mapAsync alone made the app tell the user
// the GPU was out of memory — sending them to Force WASM over what the evidence
// says is a prompt-length timeout.
globalThis.__PIPE_THROW__ = "failed to call OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: " +
  "onnxruntime/core/providers/webgpu/buffer_manager.cc:553 ... Failed to download data from buffer: " +
  "Failed to execute 'mapAsync' on 'GPUBuffer'";
await fakeSelf.onmessage({ data: { type: 'generate', payload: {
  messages: [{ role: 'user', content: 'x'.repeat(7538) }], max_new_tokens: 1024 } } });
await settle();
const errs = posted.filter((m) => m.type === 'genError');
ok(errs.length === 1, 'the failure reaches the page');
ok(errs[0].oom === true, 'still flagged as a dead session, so recovery is unchanged');
ok(errs[0].cause === 'driver-abort',
   'but the CAUSE is the Vulkan device loss, not memory, got: ' + errs[0].cause);
ok(errs[0].phase === 'prefill', 'and it is known to have died in the prefill, got: ' + errs[0].phase);
ok(typeof errs[0].msSinceDispatch === 'number', 'with a time-to-failure to compare against a good run');
const failed = diagOf('genFailed');
ok(failed[0].payload.deviceLoss && /VK_ERROR_DEVICE_LOST/.test(failed[0].payload.deviceLoss.message),
   'the device-lost record is attached to the failure that followed it');

// A real allocation failure must still read as one, even with the earlier
// device loss on the record — otherwise the fix swaps one wrong answer for another.
globalThis.__PIPE_THROW__ = 'Failed to allocate buffer: failed to allocate 2400 MB';
await fakeSelf.onmessage({ data: { type: 'generate', payload: {
  messages: [{ role: 'user', content: 'x' }], max_new_tokens: 64 } } });
await settle();
const errs2 = posted.filter((m) => m.type === 'genError');
ok(errs2[1].cause === 'oom', 'a genuine allocation failure still classifies as oom, got: ' + errs2[1].cause);
globalThis.__PIPE_THROW__ = null;

console.log('--- is the standalone runtime doing anything at all? ---');
// The first capture showed exactly ONE GPUDevice, requested from a wasm glue
// blob that names neither bundle. This answers it from the other end: VLModel is
// the only caller of the standalone InferenceSession, so a count of 0 means the
// standalone import never ran a thing.
ok(diagOf('standaloneOrtProbeInstalled').length === 1, 'the standalone-session probe installed');
ok(census[0].payload.standaloneOrtSessions === 0, 'and starts at zero');
await ortStub.InferenceSession.create();
await settle();
const sessions = diagOf('standaloneOrtSession');
ok(sessions.length === 1, 'a session created on the standalone runtime is counted');
ok(sessions[0].payload.count === 1, 'with a running total');

console.log('--- the census reports what it CAN see when the shape is unknown ---');
// env.backends.onnx is not where transformers.js v4 keeps its ORT — the real
// capture returned null for sameOrtEnv twice. The census now says what IS there.
ok(Array.isArray(census[0].payload.backendKeys), 'the census enumerates env.backends');

console.log('--- unhandled rejections are classified, both ways ---');
const rejectionHandlers = listeners['unhandledrejection'] || [];
ok(rejectionHandlers.length === 1, 'the worker installs an unhandledrejection handler');
let prevented = 0;
rejectionHandlers[0]({ reason: new Error('GPUBuffer mapAsync failed'), preventDefault() { prevented++; } });
rejectionHandlers[0]({ reason: new Error('something else entirely'), preventDefault() { prevented++; } });
await settle();
ok(prevented === 1, 'only the WebGPU-shaped one is converted');
ok(diagOf('unhandledRejectionMatched').length === 1, 'the matched one is recorded');
ok(diagOf('unhandledRejectionUnmatched').length === 1,
   'and so is the UNMATCHED one — a native-EP rewording would otherwise hang the UI silently');

console.log('--- unload resets the counters ---');
await fakeSelf.onmessage({ data: { type: 'unload' } });
await settle();
ok(posted.some((m) => m.type === 'unloaded'), 'unload still completes');
ok(diagOf('unloaded').length === 1, 'and is recorded');

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n  ' + posted.filter((m) => m.type === 'diag').length + ' diagnostic events captured in this run');
console.log(fail === 0 ? '\nALL WORKER DIAGNOSTIC TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

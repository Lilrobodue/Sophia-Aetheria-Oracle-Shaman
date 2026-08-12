/* test-worker-source.js — the inference worker is built as a TEMPLATE LITERAL
 * inside index.html, so neither the browser nor `node --check index.html` ever
 * validates it until a user loads a model. A single stray backtick in a comment
 * silently truncates the whole worker. This extracts it, parses it as a real
 * module, and asserts the GPU-memory contract holds.
 * Plain node, no dependencies:  node test-worker-source.js                    */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

console.log('--- extraction ---');
const fnAt = html.indexOf('function createInferenceWorkerSource()');
ok(fnAt > 0, 'createInferenceWorkerSource exists');
const open = html.indexOf('return `', fnAt);
ok(open > fnAt, 'it returns a template literal');
const start = open + 'return `'.length;
let end = -1;
for (let i = start; i < html.length; i++) {
  if (html[i] === '\\') { i++; continue; }
  if (html[i] === '`') { end = i; break; }
}
ok(end > start, 'the literal is terminated');
const raw = html.slice(start, end);

// The bug this file exists for: a backtick inside the literal ends it early, so
// everything after becomes page code and the worker is truncated. The extracted
// text should therefore contain none, and should be big enough to be the whole
// worker rather than a fragment ending at a stray one. These two checks are the
// reason the raw text is scanned rather than evaluated.
ok(raw.indexOf('`') === -1, 'no stray backtick inside the worker source');
ok(!/\$\{/.test(raw), 'no ${} interpolation — page state must not leak into the worker');
ok(raw.length > 40000, 'the extracted worker is the whole thing, got ' + raw.length + ' chars');

// Sibling of the stray-backtick bug, and it bit for real on 2026-08-12: a single
// backslash inside this template literal is EATEN when the page evaluates it, so
// /wasm:\/\/wasm/ ships as /wasm://wasm/ — a syntax error that no amount of
// reading the file would reveal, because the file looks correct. Any backslash
// meant for the worker must be written doubled.
const BS = String.fromCharCode(92);
raw.split('\n').forEach((line, i) => {
  const withoutPairs = line.split(BS + BS).join('');
  ok(!withoutPairs.includes(BS),
     'line ' + (i + 1) + ' of the worker has a lone backslash (double it): ' + line.trim().slice(0, 90));
});

// Everything below tests the string the BROWSER builds, not the text on disk.
// They differ: an escape sequence in the file (\\n) is one thing to a raw slice
// and another once the template literal is evaluated, and it is the evaluated
// form that actually runs. Checking the raw text would pass a worker that is
// broken in the browser — which is the same class of bug as the stray backtick.
let src = raw;
try {
  src = new Function('return `' + raw + '`')();
} catch (e) {
  ok(false, 'the template literal evaluates the way the browser evaluates it: ' + e.message);
}
console.log('  worker source: ' + src.split('\n').length + ' lines, ' +
            src.length + ' chars (raw ' + raw.length + ')');
ok(/self\.onmessage/.test(src), 'it installs a message handler');
ok(/type === 'unload'/.test(src), 'and reaches the unload branch at the very end');

console.log('--- it parses as a module ---');
{
  const tmp = path.join(os.tmpdir(), 'sophia-worker-check-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, src);
  let parsed = true, err = '';
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    parsed = false;
    err = String((e.stderr && e.stderr.toString()) || e.message).split('\n').slice(0, 4).join(' | ');
  }
  fs.unlinkSync(tmp);
  ok(parsed, 'worker source is valid module syntax: ' + err);
}

console.log('--- GPU memory contract ---');
// An ORT tensor on WebGPU owns a GPUBuffer; dropping the JS reference does not
// free it. These are the places that must dispose, or a phone GPU dies on the
// second or third generation while the first looks fine.
ok(/function disposeTensor\(/.test(src), 'disposeTensor helper exists');
ok(/typeof t\.dispose === 'function'/.test(src), 'it uses the tensor disposer when present');
ok(/if \(!t \|\| t === keep\) return;/.test(src), 'and never disposes a tensor still held');

const updateCache = src.slice(src.indexOf('updateCache(cache, outputs)'), src.indexOf('freeCache(cache)'));
ok(updateCache.length > 100, 'updateCache found');
ok(/disposeTensor\(previous, cache\[k\]\)/.test(updateCache),
   'the KV swap disposes the tensor it replaces — this runs once PER TOKEN');
ok(/if \(!kept\.has\(name\)\) disposeTensor\(outputs\[name\]\)/.test(updateCache),
   'and unkept outputs (logits) are disposed too');

ok(/freeCache\(cache\) \{/.test(src), 'freeCache exists');
ok(/} finally \{\s*\n\s*this\.freeCache\(cache\);/.test(src),
   'the decode loop frees its cache in a finally, so an aborted generation leaks nothing');
ok(/disposeTensor\(currentEmbeds, next\)/.test(src), 'per-token embeddings are disposed');
ok(/disposeTensor\(am\)/.test(src), 'the per-step attention mask is disposed');
ok(/disposeTensor\(sequences\)/.test(src), 'the vision path disposes its output sequences');
ok(/for \(const k of Object\.keys\(inputs\)\) disposeTensor\(inputs\[k\]\)/.test(src),
   'and its processed inputs (the big image tensors)');
ok(/disposeTensor\(out\)/.test(src), 'the text pipeline disposes its result');

console.log('--- unload really releases ---');
const unload = src.slice(src.indexOf("type === 'unload'"));
ok(/pipe\.dispose\?\.\(\)/.test(unload) || /pipe\.model\?\.dispose/.test(unload),
   'unload disposes the pipeline, not just the reference');
ok(/model\.dispose\?\.\(\)/.test(unload), 'unload disposes the model');
ok(/vlModel\.dispose\(\)/.test(unload), 'unload disposes the VL sessions');
ok(/genCount = 0/.test(unload), 'and resets the generation counter');

console.log('--- GPU exhaustion is reported, not swallowed ---');
ok(/function isGpuExhaustion\(/.test(src), 'GPU exhaustion is classified');
['out of memory', 'device is lost', 'failed to allocate', 'mapAsync'].forEach(pat =>
  ok(src.includes(pat), 'classifier covers "' + pat + '"'));
ok(/type: 'genError', payload: msg, oom, cause, generations: genCount,/.test(src),
   'genError carries the oom flag, WHY it died, and the generation count');
ok(/tokensThisGen, msSinceDispatch, promptTokens: lastPromptTokens,/.test(src),
   'plus how far it got, how long it took, and how big the prompt was');
ok(/phase: tokensThisGen === 0 \? 'prefill' : 'decode'/.test(src),
   'and whether it died in the prefill or the decode — different limits');
// The distinction the first ROG Phone capture forced: a Vulkan driver abort was
// being reported to the user as an out-of-memory, which points at the wrong fix.
ok(/function gpuFailureCause\(/.test(src), 'GPU failures are classified by cause, not just detected');
ok(/VK_ERROR_DEVICE_LOST/.test(src), 'including the Vulkan device-lost signature seen on Adreno');
ok(/lastDeviceLoss = \{ reason: payload\.reason/.test(src),
   'and the GPUDevice.lost record is kept, because the error thrown after it is downstream of it');
ok(/if \(\/out of memory\|failed to allocate\|allocation failed\|exceeds the limit\|createBuffer\/i\.test\(s\)\) return 'oom'/.test(src),
   'a genuine allocation failure still classifies as oom');
ok(/genCount\+\+/.test(src), 'generations are counted so a leak is visible');
ok(/payload: \{ generations: genCount, tokensThisGen: tokensThisGen, promptTokens: lastPromptTokens \}/.test(src),
   'and reported on success, with the prompt size that survived');

// Page side: the flag has to survive the postMessage hop and be acted on.
ok(/handleWorkerMessage\(type, payload, e\.data\)/.test(html),
   'the page forwards the raw message so the oom flag is not dropped');
ok(/if \(meta && meta\.oom\)/.test(html), 'and the page acts on GPU exhaustion');
ok(/localInference\.gpuExhausted = false;/.test(html), 'a fresh load clears the flag');

console.log('--- runtime diagnostics (SOPHIA_RUNTIME_BRIEF Phase A) ---');
// A1 — the device-lost reason has to come from GPUDevice.lost, not from a regex
// over error text. Nothing hands us the device, so the probe is the only route.
ok(/function installGpuProbe\(/.test(src), 'the GPU probe exists');
ok(/gpu\.requestAdapter = async function/.test(src), 'it intercepts requestAdapter');
ok(/adapter\.requestDevice = async function/.test(src), 'and requestDevice, which is where the device appears');
ok(/device\.lost\.then\(/.test(src), 'it subscribes to GPUDevice.lost');
ok(/type: 'gpuLost'/.test(src), 'and reports the loss to the page');
ok(/reason: String\(info\.reason/.test(src), 'carrying the real reason code');
ok(/uncapturederror/.test(src), 'uncaptured GPU errors are captured too');
ok(/gpuDeviceCount/.test(src), 'GPUDevices are counted — a second one is the dual-runtime evidence');

// A2 — one runtime or two. sameOrtEnv is the whole question in one boolean.
ok(/function runtimeCensus\(/.test(src), 'the runtime census exists');
ok(/runtimeCensus\('worker-start'\)/.test(src), 'it runs at worker start');
ok(/runtimeCensus\('after-load'\)/.test(src), 'and again after load, when TJs has bound its ORT');
// The first capture proved env.backends.onnx IS the bundled env object in v4
// (keys: wasm, webgl, webgpu, versions, logLevel), not the ORT module.
ok(/out\.sameOrtEnv = \(bundledEnv === ort\.env\)/.test(src),
   'it compares the bundled and standalone ORT env objects directly');
ok(/out\.sameWasmConfig = !!\(bundledEnv\.wasm && ort\.env\.wasm && bundledEnv\.wasm === ort\.env\.wasm\)/.test(src),
   'and tests shared mutable state by identity rather than inferring it from a matching value');
// Tool schemas are rendered into the prompt by the chat template, so they are
// part of the prefill being measured.
ok(/toolChars = tools\.length \? JSON\.stringify\(tools\)\.length : 0/.test(src),
   'the prefill measurement counts tool schemas, not just message text');
ok(/approxPromptTokens: Math\.round\(totalChars \/ 4\)/.test(src),
   'and the headline prompt size is the total the GPU actually sees');

// A3 — the crash is on generate, so the numbers must be taken at dispatch.
ok(/async function preDispatchSnapshot\(/.test(src), 'the pre-dispatch snapshot exists');
ok((src.match(/await preDispatchSnapshot\(/g) || []).length === 3,
   'and runs in all three generate paths');
ok(/navigator\.storage\.estimate\(\)/.test(src), 'it records the storage estimate');
ok(/tokensThisGen\+\+/.test(src), 'tokens are counted so "how far did it get" is answerable');
ok((src.match(/tokensThisGen\+\+/g) || []).length === 3, 'in all three streaming callbacks');

// Diagnostics must not become a second failure mode: an unpostable record is
// dropped, never thrown, and a phone with no devtools still gets the data.
ok(/try \{ self\.postMessage\(\{ type: 'diag', payload: rec \}\); \} catch/.test(src),
   'a diag record that will not structured-clone is dropped, not thrown');
ok(/if \(payload\.verboseLogs\)/.test(src), 'log level is raised only when the page asks');
ok(/env\.logLevel = LogLevel\.WARNING/.test(src),
   'and ships at WARNING — v4 defaults to ERROR, which hides ORT WebGPU warnings');

console.log('--- Phase B: the isolation transform actually bites ---');
// The decisive experiment removes the standalone ORT import from this source at
// spawn time. If the regexes ever stop matching, the isolation arm would run
// IDENTICALLY to the control and report "hypothesis dead" — a false negative
// that would be believed. So apply the real edits to the real source here.
const editsAt = html.indexOf('const ORT_ISOLATION_EDITS = [');
ok(editsAt > 0, 'ORT_ISOLATION_EDITS exists on the page');
const editsEnd = html.indexOf('];', editsAt);
let EDITS = [];
try {
  EDITS = eval(html.slice(html.indexOf('[', editsAt), editsEnd + 1));
} catch (e) { ok(false, 'ORT_ISOLATION_EDITS parses: ' + e.message); }
ok(EDITS.length === 2, 'it has both edits, got ' + EDITS.length);

let isolated = src;
EDITS.forEach((e) => {
  ok(e.find.test(isolated), 'edit still matches the worker source: ' + e.note);
  isolated = isolated.replace(e.find, '// [ort-isolation] removed — ' + e.note);
});
ok(!/^import \* as ort from/m.test(isolated), 'isolated source has no standalone ORT import');
ok(!/^ort\.env\./m.test(isolated), 'and no top-level ort.env mutation left to throw');
ok(/^\s*const session = await ort\.InferenceSession\.create/m.test(isolated),
   'VLModel still references ort internally — which is why the load path must guard');
ok(/typeof ort === 'undefined'/.test(isolated),
   'and the lfm2-vision load branch guards on the import being gone');

console.log('--- and the isolated source still parses ---');
{
  const tmp = path.join(os.tmpdir(), 'sophia-worker-isolated-' + process.pid + '.mjs');
  fs.writeFileSync(tmp, isolated);
  let parsed = true, err = '';
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    parsed = false;
    err = String((e.stderr && e.stderr.toString()) || e.message).split('\n').slice(0, 4).join(' | ');
  }
  fs.unlinkSync(tmp);
  ok(parsed, 'isolated worker source is valid module syntax: ' + err);
}

// Page side: the arm has to be selectable on a phone and visible while it runs.
ok(/function isOrtIsolationEnabled\(/.test(html), 'the page can select the isolation arm');
ok(/ortIsolation/.test(html) && /localStorage\.setItem\(ORT_ISOLATION_KEY/.test(html),
   'and it survives a home-screen relaunch that drops the query string');
ok(/if \(isOrtIsolationEnabled\(\)\) src = applyOrtIsolation\(src\)/.test(html),
   'spawnInferenceWorker applies it');
ok(/function copyRuntimeDiagnostics\(/.test(html), 'diagnostics can be exported without devtools');
ok(/if \(type === 'diag'\)/.test(html) && /if \(type === 'gpuLost'\)/.test(html),
   'the page records both diag and gpuLost messages');
ok(/p\.reason !== 'destroyed'/.test(html),
   'an ordinary unload is not reported to the user as a crash');

console.log(fail === 0 ? '\nALL WORKER SOURCE TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

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
const src = html.slice(start, end);
console.log('  worker source: ' + src.split('\n').length + ' lines, ' + src.length + ' chars');

// The bug this file exists for: a backtick inside the literal ends it early, so
// everything after becomes page code and the worker is truncated. The extracted
// text should therefore contain none, and should be big enough to be the whole
// worker rather than a fragment ending at a stray one.
ok(src.indexOf('`') === -1, 'no stray backtick inside the worker source');
ok(!/\$\{/.test(src), 'no ${} interpolation — page state must not leak into the worker');
ok(src.length > 40000, 'the extracted worker is the whole thing, got ' + src.length + ' chars');
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
ok(/postMessage\(\{ type: 'genError', payload: msg, oom, generations: genCount \}\)/.test(src),
   'genError carries the oom flag and the generation count');
ok(/genCount\+\+/.test(src), 'generations are counted so a leak is visible');
ok(/type: 'genDone', payload: \{ generations: genCount \}/.test(src), 'and reported on success');

// Page side: the flag has to survive the postMessage hop and be acted on.
ok(/handleWorkerMessage\(type, payload, e\.data\)/.test(html),
   'the page forwards the raw message so the oom flag is not dropped');
ok(/if \(meta && meta\.oom\)/.test(html), 'and the page acts on GPU exhaustion');
ok(/localInference\.gpuExhausted = false;/.test(html), 'a fresh load clears the flag');

console.log(fail === 0 ? '\nALL WORKER SOURCE TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

/* test-manual-cast.js — every button in the Manual Cast panel must reach a real
 * tool. Plain node:  node test-manual-cast.js
 *
 * This exists because of a shipped bug: qimen_chart registers into
 * window.QIMEN_TOOLS, manualCast() looked only in window.DIVINATION_TOOLS, and
 * the ⛩ button answered "Divination module not loaded". Unit tests passed the
 * whole time — they called the tool's code() directly and never walked the path
 * a finger takes. So this walks that path: read the buttons out of the page,
 * resolve each through the app's own resolver, and call it.
 *
 * Add a sidecar registry? Add it to MANUAL_TOOL_REGISTRIES and this stays green.
 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
const i0 = html.indexOf('<script>', html.indexOf('<body>'));
const js = html.slice(html.indexOf('>', i0) + 1, html.indexOf('</script>', i0));

function grabFn(name) {
  const i = js.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('index.html no longer defines ' + name);
  let depth = 0, started = false;
  for (let k = i; k < js.length; k++) {
    if (js[k] === '{') { depth++; started = true; }
    else if (js[k] === '}') { depth--; if (started && depth === 0) return js.slice(i, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
// Brace/bracket-match from the '=' so an object literal and an array literal are
// both captured exactly — counting to the first '};' picked up a later block.
function grabConst(decl) {
  const i = js.indexOf(decl);
  if (i < 0) throw new Error('index.html no longer declares ' + decl);
  const eq = js.indexOf('=', i);
  let open = -1, close = '';
  for (let k = eq; k < js.length; k++) {
    if (js[k] === '{') { open = k; close = '}'; break; }
    if (js[k] === '[') { open = k; close = ']'; break; }
    if (js[k] === '\n') break;
  }
  if (open < 0) return js.slice(i, js.indexOf('\n', i));
  const openCh = close === '}' ? '{' : '[';
  let depth = 0;
  for (let k = open; k < js.length; k++) {
    if (js[k] === openCh) depth++;
    else if (js[k] === close) { depth--; if (depth === 0) return js.slice(i, k + 1) + ';'; }
  }
  throw new Error('unbalanced literal for ' + decl);
}

const { DIVINATION_TOOLS } = require('./divination-core.js');
const { QIMEN_TOOLS } = require('./qimen-core.js');

const ctx = { console, Object, Array, String, Number, Math, JSON,
              window: { DIVINATION_TOOLS, QIMEN_TOOLS }, out: {} };
ctx.global = ctx;
vm.createContext(ctx);
vm.runInContext([
  grabConst('const MANUAL_CASTS'),
  grabConst('const MANUAL_TOOL_REGISTRIES'),
  grabFn('manualToolFor'),
  'out.MANUAL_CASTS = MANUAL_CASTS; out.manualToolFor = manualToolFor;' +
  'out.REGISTRIES = MANUAL_TOOL_REGISTRIES;',
].join('\n'), ctx);

const { MANUAL_CASTS, manualToolFor, REGISTRIES } = ctx.out;

let fail = 0, count = 0;
const ok = (c, m) => { count++; if (!c) { console.log('  FAIL: ' + m); fail++; } };

// The buttons a finger can actually press, read out of the markup.
const buttons = [...html.matchAll(/onclick="manualCast\('(\w+)'\)"/g)].map(m => m[1]);
console.log('--- buttons found in the panel ---');
console.log('  ' + buttons.join(', '));
ok(buttons.length >= 7, 'the panel still has its full row of oracles');

console.log('--- each resolves and runs ---');
for (const kind of buttons) {
  const spec = MANUAL_CASTS[kind];
  ok(!!spec, `${kind}: has a MANUAL_CASTS entry`);
  if (!spec) continue;
  ok(!!spec.label, `${kind}: has a label for the tray`);

  if (spec.native) {
    // Async ESM tool — reached through window.SophiaAgent.runToolDirect, which
    // needs a browser. Assert the contract rather than the call.
    ok(!manualToolFor(spec.tool),
       `${kind}: native tool '${spec.tool}' is deliberately absent from the sync registries`);
    continue;
  }

  const tool = manualToolFor(spec.tool);
  ok(!!tool, `${kind}: '${spec.tool}' resolves through manualToolFor`);
  if (!tool) continue;
  ok(typeof tool.code === 'function', `${kind}: exposes a callable code()`);

  const params = kind === 'biorhythm' ? { birthDate: '1985-04-12' } : {};
  let res;
  try { res = tool.code(params); } catch (e) { res = { success: false, error: e.message }; }
  // bibliomancy legitimately reports an empty knowledge base; that is not a failure.
  const softFail = kind === 'bibliomancy';
  ok(res && (res.success !== false || softFail),
     `${kind}: code() returns a result${res && res.error ? ' (' + res.error + ')' : ''}`);
}

console.log('--- registry coverage ---');
ok(REGISTRIES.includes('DIVINATION_TOOLS'), 'DIVINATION_TOOLS is searched');
ok(REGISTRIES.includes('QIMEN_TOOLS'), 'QIMEN_TOOLS is searched');
// Anything a sidecar registers should be reachable, or knowingly left off the row.
const registered = [...Object.keys(DIVINATION_TOOLS), ...Object.keys(QIMEN_TOOLS)];
const wired = new Set(Object.values(MANUAL_CASTS).map(s => s.tool));
const unwired = registered.filter(n => !wired.has(n));
console.log('  registered but not on the manual row: ' + (unwired.join(', ') || 'none'));
ok(unwired.every(n => n === 'hexagram_lookup'),
   'the only unwired tool is hexagram_lookup (a reference lookup, not a cast)');

console.log('');
console.log(fail ? `${fail} of ${count} FAILED` : `ALL ${count} MANUAL CAST TESTS PASSED`);
process.exit(fail ? 1 : 0);

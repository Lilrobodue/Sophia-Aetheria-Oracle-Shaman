// Every tool × every model family's trained tool-call dialect.
//
// Sophia advertises tools differently per family and each model answers in the
// format it was trained on, regardless of what the prompt asked for. That gives
// three dialects on the wire:
//
//   TOOL_CALL: {...}                             prompted — Gemma 4, Bonsai, Qwen 0.5B
//   <|tool_call_start|>[name(args)]<|…_end|>     LFM2.5 family
//   <tool_call>{"name","arguments"}</tool_call>  Qwen3.5 / Hermes lineage
//
// Both parsers must handle all three for every tool in the registry: the one in
// index.html's processResponse (ordinary chat) and agent-core's parseToolCall
// (the agentic loop). Tool names and parameter schemas are scraped from source
// rather than hand-listed, so a tool added later is covered automatically.
//
// Run: node test-toolcall-dialects.mjs

import fs from 'node:fs';
import * as core from './agent-core.js';

const html = fs.readFileSync('index.html', 'utf8').split('\r').join('');
const divination = fs.readFileSync('divination-core.js', 'utf8').split('\r').join('');

/* ── Load the shipped parsers out of index.html ─────────────────────────── */

function between(startSig, endSig) {
    const i = html.indexOf(startSig);
    if (i < 0) throw new Error('start not found: ' + startSig);
    const j = html.indexOf(endSig, i);
    if (j < 0) throw new Error('end not found: ' + endSig);
    return html.slice(i, j + endSig.length);
}

// Module scope is strict, so eval'd declarations don't leak; build one
// sloppy-mode Function body from the shipped sources instead.
const parsers = new Function([
    between('function extractToolCalls(text) {', 'return calls;\n            }'),
    between('function extractNativeToolCalls(text) {', 'return calls;\n            }'),
    between('function salvageNativeCall(inner, raw) {', 'return { tool: name[1], params, raw };\n            }'),
    between('function extractHermesToolCalls(text) {', 'return calls;\n            }'),
    between('function splitTopLevel(s, sep) {', 'return out;\n            }'),
    between('function parsePyLiteral(src) {', 'return value(); } catch (e) { return src; }\n            }'),
    between('function normalizeToolParams(params) {', 'return params;\n            }'),
    'const unparsedToolBlocks = [];',
    'const console = { warn() {} };',
    `return {
        extractToolCalls, extractNativeToolCalls, extractHermesToolCalls,
        parsePyLiteral, normalizeToolParams, unparsedToolBlocks,
    };`,
].join('\n'))();

// Mirrors how processResponse combines the dialects.
function parseAll(text) {
    parsers.unparsedToolBlocks.length = 0;
    const out = [];
    for (const c of parsers.extractToolCalls(text)) {
        const j = parsers.parsePyLiteral(c.json);
        if (j && typeof j === 'object' && (j.tool || j.name)) {
            out.push({
                tool: j.tool || j.name,
                params: j.params ?? j.arguments ?? j.parameters ?? j.args ?? {},
            });
        }
    }
    for (const c of parsers.extractNativeToolCalls(text)) out.push({ tool: c.tool, params: c.params });
    for (const c of parsers.extractHermesToolCalls(text)) out.push({ tool: c.tool, params: c.params });
    return out.map(c => ({ tool: c.tool, params: parsers.normalizeToolParams(c.params) }));
}

/* ── Scrape the tool registry from source ──────────────────────────────── */

// divination-core.js:  toolName: { name: 'toolName', ... params: { a: {...}, b: {...} } }
// index.html:          tools.x = { name: 'x', ... params: { a: {...} } }
function scrapeTools(src, label) {
    const found = [];
    const re = /name:\s*'([a-z][A-Za-z0-9_]*)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const after = src.slice(m.index, m.index + 2600);
        const p = /params:\s*\{/.exec(after);
        if (!p) continue;
        // Balanced scan for the params object so nested schemas stay whole.
        let depth = 0, end = -1;
        const start = m.index + p.index + p[0].length - 1;
        for (let i = start; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end === -1) continue;
        const body = src.slice(start + 1, end);
        const keys = [...body.matchAll(/(?:^|[{,])\s*([A-Za-z_]\w*)\s*:\s*\{/g)].map(k => k[1]);
        found.push({ name: m[1], keys, source: label });
    }
    return found;
}

const tools = [
    ...scrapeTools(divination, 'divination-core.js'),
    ...scrapeTools(html, 'index.html'),
].filter((t, i, a) => a.findIndex(x => x.name === t.name) === i);

/* ── Dialect emitters ──────────────────────────────────────────────────── */

const pyValue = (v) => typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'`
    : typeof v === 'boolean' ? (v ? 'True' : 'False')
    : String(v);

const DIALECTS = [
    {
        family: 'prompted (Gemma 4 / Bonsai / Qwen 0.5B)',
        emit: (name, args) => `TOOL_CALL: ${JSON.stringify({ tool: name, params: args })}`,
    },
    {
        family: 'prompted, Python quoting',
        emit: (name, args) => "TOOL_CALL: {'tool': '" + name + "', 'params': {" +
            Object.entries(args).map(([k, v]) => `'${k}': ${pyValue(v)}`).join(', ') + '}}',
    },
    {
        family: 'LFM2.5 native',
        emit: (name, args) => '<|tool_call_start|>[' + name + '(' +
            Object.entries(args).map(([k, v]) => `${k}=${pyValue(v)}`).join(', ') +
            ')]<|tool_call_end|>',
    },
    {
        family: 'LFM2.5 native, JSON-valued args',
        emit: (name, args) => '<|tool_call_start|>[' + name + '(' +
            Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ') +
            ')]<|tool_call_end|>',
    },
    {
        family: 'LFM2.5 fused/malformed (observed live)',
        emit: (name, args) => '<|tool_call_start|>[TOOL_CALL_tool_name=\'' + name + '\', parameters={' +
            Object.entries(args).map(([k, v]) => `'${k}': ${pyValue(v)}`).join(', ') +
            '})]<|tool_call_end|>',
    },
    {
        family: 'LFM2.5 params-wrapped',
        emit: (name, args) => '<|tool_call_start|>[' + name + '(params=' + JSON.stringify(args) +
            ')]<|tool_call_end|>',
    },
    {
        family: 'Qwen3.5 / Hermes native',
        emit: (name, args) => '<tool_call>' + JSON.stringify({ name, arguments: args }) + '</tool_call>',
    },
    {
        family: 'Qwen3.5 / Hermes, Python quoting',
        emit: (name, args) => "<tool_call>{'name': '" + name + "', 'arguments': {" +
            Object.entries(args).map(([k, v]) => `'${k}': ${pyValue(v)}`).join(', ') + '}}</tool_call>',
    },
];

/* ── Run the matrix ────────────────────────────────────────────────────── */

let pass = 0, fail = 0;
const failures = [];
const t = (name, cond) => { if (cond) { pass++; } else { fail++; failures.push(name); } };

// A representative argument set per tool, from its own declared parameter names,
// exercising a string, a boolean and a number.
function sampleArgs(keys) {
    const args = {};
    if (keys[0]) args[keys[0]] = 'a value, with a comma';
    if (keys[1]) args[keys[1]] = true;
    if (keys[2]) args[keys[2]] = 7;
    return args;
}

console.log(`Registry: ${tools.length} tools · ${DIALECTS.length} dialects · 2 parsers\n`);
for (const t of tools) {
    console.log(`  ${t.name.padEnd(22)} ${t.keys.join(', ') || '(no params)'}`);
}
console.log();

for (const tool of tools) {
    const args = sampleArgs(tool.keys);
    for (const d of DIALECTS) {
        const text = d.emit(tool.name, args);
        const label = `${tool.name} · ${d.family}`;

        const got = parseAll(text);
        t(`chat: ${label} — one call`, got.length === 1);
        t(`chat: ${label} — name`, got[0] && got[0].tool === tool.name);
        for (const [k, v] of Object.entries(args)) {
            t(`chat: ${label} — arg ${k}`, got[0] && got[0].params && got[0].params[k] === v);
        }

        const c = core.parseToolCall(text);
        t(`agent: ${label} — name`, c && c.name === tool.name);
        for (const [k, v] of Object.entries(args)) {
            t(`agent: ${label} — arg ${k}`, c && c.args && c.args[k] === v);
        }
        t(`agent: ${label} — markup stripped from answer`,
            !/<\|tool_call_start\|>|<tool_call>/.test(core.stripScaffold('Here you go. ' + text)));
    }
}

// Prose with no tool call must stay inert in every parser.
const prose = "Let's sit with that for a moment. What does the Wunjo rune stir in you?";
t('prose: no calls in chat parser', parseAll(prose).length === 0);
t('prose: no call in agent parser', core.parseToolCall(prose) === null);
t('prose: untouched by stripScaffold', core.stripScaffold(prose) === prose);

// Unparseable markup is collected for removal, not shown to the user.
parseAll('<|tool_call_start|>[???]<|tool_call_end|>');
t('unparseable native block is collected for stripping', parsers.unparsedToolBlocks.length === 1);

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
    console.log('\nFailures:');
    for (const f of failures.slice(0, 40)) console.log('  - ' + f);
    if (failures.length > 40) console.log(`  …and ${failures.length - 40} more`);
    process.exit(1);
}
console.log('\nALL TOOL-CALL DIALECT TESTS PASSED');

// agent-core.js — engine-agnostic tool-use loop (manual function calling)
// No external deps. ES module. Runs on the MAIN thread; inference is delegated
// to a worker via the injected llmCall.
//
// Design notes (Sophia-specific):
//  - transformers.js exposes no structured `tool_calls` object, so tools are
//    described in the prompt and the model emits a call as TEXT that we parse.
//  - The loop fires several sequential generate() calls per turn — the caller's
//    llmCall MUST delegate to the inference Web Worker so the UI stays responsive.
//  - Tiny/ternary models are weak at multi-step tool use; keep maxSteps low.

export class ToolRegistry {
  constructor() { this.tools = new Map(); }

  register(tool) {
    for (const k of ['name', 'description', 'parameters', 'execute'])
      if (!(k in tool)) throw new Error(`Tool missing "${k}"`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get size() { return this.tools.size; }

  // Rendered into the system prompt so the model knows what it can call.
  instructions() {
    const specs = [...this.tools.values()].map(t =>
      `- ${t.name}: ${t.description}\n    args: ${JSON.stringify((t.parameters && t.parameters.properties) || {})}`
    ).join('\n');
    return [
      'You have tools. To call one, reply with ONLY this JSON on its own line, nothing else:',
      '{"tool": "<name>", "args": { ... }}',
      '(TOOL_CALL: {"tool":"<name>","params":{ ... }} is also accepted.)',
      'If no tool is needed, reply normally to the user in your own voice.',
      'After a TOOL_RESULT, either call another tool or give your final answer.',
      'Available tools:',
      specs
    ].join('\n');
  }

  async execute(name, args, ctx = {}) {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool "${name}".`;
    const required = (tool.parameters && tool.parameters.required) || [];
    // Small models often pass the value directly, e.g. {"tool":"web_search",
    // "args":"climate news"}. When args is a bare scalar and the tool has exactly
    // one required param, key it under that param; otherwise fall back to {}.
    // (A raw `req in scalar` would throw a TypeError on the string/number.)
    let a = args;
    if (a === null || a === undefined || typeof a !== 'object') {
      a = (required.length === 1 && a !== null && a !== undefined && a !== '')
        ? { [required[0]]: a }
        : {};
    }
    for (const req of required)
      if (!(req in a)) return `Error: ${name} missing arg "${req}".`;
    return await tool.execute(a, ctx);
  }
}

// Normalize one parsed JSON value into a {name, args} call, or null. Accepts both
// the prompted {"tool","args"} shape AND LFM2.5's trained-native {"name",
// "arguments"} shape (incl. a single-element array wrapper [{...}]). The name-form
// requires an arguments-like key so plain {"name": ...} prose isn't misread.
function toCall(value) {
  const o = Array.isArray(value) ? value[0] : value;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.tool === 'string' && o.tool)
    return { name: o.tool, args: o.args ?? o.arguments ?? o.params ?? {} };
  if (typeof o.name === 'string' && o.name &&
      (o.arguments !== undefined || o.parameters !== undefined || o.args !== undefined))
    return { name: o.name, args: o.arguments ?? o.parameters ?? o.args ?? {} };
  return null;
}

// Scan text for every top-level balanced {...} object. String-aware so nested
// objects (e.g. {"tool":"web_search","args":{"query":"x"}}) are captured whole —
// a naive /\{[\s\S]*?\}/ stops at the first inner brace and yields invalid JSON.
export function findBalancedObjects(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { out.push(text.slice(i, j + 1)); i = j; break; } }
    }
  }
  return out;
}

// Extract a {name, args} tool call from model text. Accepts fenced JSON, a bare
// JSON object/array, the TOOL_CALL: prefix the LFM2.5 models are prompted with,
// and LFM2.5's native name/arguments shape (see toCall). args may arrive under
// args | arguments | params | parameters, or as a bare scalar (handled downstream).
export function parseToolCall(text) {
  if (!text) return null;
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([[{][\s\S]*?[\]}])\s*```/);
  if (fenced) candidates.push(fenced[1]);
  for (const obj of findBalancedObjects(text)) candidates.push(obj);
  for (const c of candidates) {
    try {
      const call = toCall(JSON.parse(c));
      if (call) return call;
    } catch { /* try next candidate */ }
  }
  return null;
}

// If the model both answered and leaked scaffold JSON, strip the blob so the final
// answer reads clean. Removes fenced json, tool-call objects, TOOL_CALL:, and an
// empty [] left behind when an array-wrapped call is removed.
export function stripScaffold(text) {
  if (!text) return text;
  let out = text.replace(/```(?:json)?\s*[[{][\s\S]*?[\]}]\s*```/g, '');
  for (const obj of findBalancedObjects(out)) {
    try { if (toCall(JSON.parse(obj))) out = out.split(obj).join(''); } catch { /* keep non-call JSON */ }
  }
  return out.replace(/TOOL_CALL:\s*/g, '').replace(/\[\s*\]/g, '').trim();
}

function ensureSystemTools(convo, registry) {
  const block = registry.instructions();
  const sys = convo.find(m => m.role === 'system');
  if (sys) sys.content += `\n\n${block}`;
  else convo.unshift({ role: 'system', content: block });
}

/**
 * runAgent — generate → parse for a tool call → execute + feed result back → repeat
 *            until the model gives a plain answer or maxSteps is hit.
 * @param messages  Sophia's system+history array (mutated copies only)
 * @param registry  ToolRegistry
 * @param llmCall   async ({messages}) => ({ content })   // worker round-trip
 * @param maxSteps  default 3 (in-browser inference is slow; keep it tight)
 * @param ctx       passed to tool.execute (e.g. { sensorState })
 * @param onEvent   ({type, ...}) for UI status
 * @returns { final, convo }
 */
export async function runAgent({ messages, registry, llmCall, maxSteps = 3, ctx = {}, onEvent }) {
  const convo = messages.map(m => ({ ...m }));
  if (registry && registry.size > 0) ensureSystemTools(convo, registry);

  let toolResultPending = false;   // a tool ran but its result hasn't been answered yet

  for (let step = 0; step < maxSteps; step++) {
    onEvent?.({ type: 'step', step });
    const { content } = await llmCall({ messages: convo });
    const call = parseToolCall(content);

    if (!call) { onEvent?.({ type: 'final' }); return { final: stripScaffold(content) || content, convo }; }

    convo.push({ role: 'assistant', content });               // record the tool-call turn
    onEvent?.({ type: 'tool_start', name: call.name, args: call.args });

    let result;
    try { result = await registry.execute(call.name, call.args, ctx); }
    catch (e) { result = `Error running ${call.name}: ${e.message}`; }

    onEvent?.({ type: 'tool_end', name: call.name, result });
    // Feed back as a plain user turn — small-model chat templates handle this
    // far more reliably than a dedicated `tool` role.
    convo.push({
      role: 'user',
      content: `TOOL_RESULT (${call.name}):\n${typeof result === 'string' ? result : JSON.stringify(result)}\n\nUse this to answer in your own voice, or call another tool.`
    });
    toolResultPending = true;
  }

  // The loop hit maxSteps with a tool result still unanswered (common on tiny
  // models capped at 1 step, and on any model that used every step for a call).
  // One final generation so the fetched information actually reaches the user
  // instead of being discarded. Any leaked scaffold is stripped; a further tool
  // call here is intentionally NOT executed — we only synthesize.
  if (toolResultPending) {
    onEvent?.({ type: 'synthesize' });
    try {
      const { content } = await llmCall({ messages: convo });
      const answer = stripScaffold(content);
      if (answer && answer.trim()) { onEvent?.({ type: 'final' }); return { final: answer, convo }; }
    } catch { /* fall through to the graceful cap message */ }
  }

  onEvent?.({ type: 'cap_reached' });
  return { final: "I circled that a few times — let me pause rather than spin. Ask me to keep going.", convo };
}

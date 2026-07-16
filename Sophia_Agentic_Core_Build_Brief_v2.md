# Build Brief v2: Sophia Agentic Core + Web Search (transformers.js / WebGPU)

**For:** Claude Code
**From:** Selah (design) / Jobo (direction)
**Supersedes:** the first brief. Runtime is now confirmed: Sophia runs models **in-browser via transformers.js (`@huggingface/transformers`) on WebGPU**, cached on first load. No Ollama, no HTTP model endpoint, no cloud.
**Scope this pass:** (1) a real **agentic tool-use loop** wired to the in-browser engine; (2) a **`web_search` tool** on top of it via a local DuckDuckGo proxy. Proactive/EEG behavior is **out of scope** (next pass).

---

## 0. Context before editing

- Sophia is a **client-side PWA**. The app is one file — **`index.html` (18,536 lines / 933 KB)** — plus sibling modules (`athena-core.js`, `aetheria-bus.js`, `hrv-analysis.js`, `prescription-engine.js`, …). GitHub Pages via `CNAME`.
- **Work modularly.** New logic goes in new top-level modules (`agent-core.js`, `sophia-infer.worker.js`, `tools/web-search.js`) matching existing naming — not more inline code in the monolith.
- **First action — report back two things:**
  1. How Sophia currently loads + runs a selected menu model. Does inference already run in a **Web Worker**? Grep: `grep -nE "Worker\(|apply_chat_template|from_pretrained|AutoModel|pipeline\(|webgpu|generate\(" index.html *.js`
  2. The function that sends a user turn and renders Sophia's reply (the call site the agent loop will wrap).
- **The runtime facts that shape this design (transformers.js specifics):**
  - There is **no structured `tool_calls` object**. Tools are described in the prompt; the model emits a tool call as *text* that we parse. → **manual function calling is the only path**, and it's fine.
  - **Inference must run in a Web Worker.** The loop fires several sequential `generate()` calls per turn; on the main thread that freezes the UI.
  - These are **0.5B–8B, heavily/ternary-quantized** models. Keep prompts tight, `maxSteps` low (3), and expect the smallest models to be poor at tool use.

---

## PART A — Agentic Core

### A.1 Goal
A small **tool registry + tool-use loop** so Sophia can decide to call a tool, read the result, and answer — in her Oracle Shaman voice — chaining up to a few calls. Engine-agnostic loop; transformers.js-specific adapter.

### A.2 Pieces
1. **Tool descriptor** — uniform shape every tool exports:
   ```js
   { name, description, parameters /* JSON schema */, execute: async (args, ctx) => string }
   ```
2. **`ToolRegistry`** — registers tools, renders their specs into the system prompt, validates args, dispatches `execute`.
3. **`runAgent()`** — the loop: generate → parse for a tool call → if found, execute + feed result back → else return the answer. Hard `maxSteps` cap. Emits UI events.
4. **Inference worker** — holds the loaded transformers.js model/tokenizer; `generate(messages) → text`.

### A.3 `agent-core.js`
```js
// agent-core.js — engine-agnostic tool-use loop (manual function calling)
// No external deps. ES module. Runs on the MAIN thread; inference is delegated
// to a worker via the injected llmCall.

export class ToolRegistry {
  constructor() { this.tools = new Map(); }

  register(tool) {
    for (const k of ['name', 'description', 'parameters', 'execute'])
      if (!(k in tool)) throw new Error(`Tool missing "${k}"`);
    this.tools.set(tool.name, tool);
    return this;
  }

  // Rendered into the system prompt so the model knows what it can call.
  instructions() {
    const specs = [...this.tools.values()].map(t =>
      `- ${t.name}: ${t.description}\n    args: ${JSON.stringify(t.parameters.properties || {})}`
    ).join('\n');
    return [
      'You have tools. To call one, reply with ONLY this JSON on its own, nothing else:',
      '{"tool": "<name>", "args": { ... }}',
      'If no tool is needed, reply normally to the user in your own voice.',
      'After a TOOL_RESULT, either call another tool or give your final answer.',
      'Available tools:',
      specs
    ].join('\n');
  }

  async execute(name, args, ctx = {}) {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool "${name}".`;
    for (const req of tool.parameters.required || [])
      if (!(req in (args || {}))) return `Error: ${name} missing arg "${req}".`;
    return await tool.execute(args || {}, ctx);
  }
}

// Extract a {name, args} tool call from model text (fenced OR bare JSON with "tool").
export function parseToolCall(text) {
  if (!text) return null;
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) candidates.push(fenced[1]);
  const bare = text.match(/\{[\s\S]*?"tool"[\s\S]*?\}/);
  if (bare) candidates.push(bare[0]);
  for (const c of candidates) {
    try { const o = JSON.parse(c); if (o.tool) return { name: o.tool, args: o.args || o.arguments || {} }; }
    catch {}
  }
  return null;
}

// If the model both answered and leaked scaffold JSON, strip the JSON blob.
function stripScaffold(text) {
  return text.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, '')
             .replace(/\{[\s\S]*?"tool"[\s\S]*?\}/g, '')
             .trim();
}

function ensureSystemTools(convo, registry) {
  const block = registry.instructions();
  const sys = convo.find(m => m.role === 'system');
  if (sys) sys.content += `\n\n${block}`;
  else convo.unshift({ role: 'system', content: block });
}

/**
 * runAgent
 * @param messages  Sophia's system+history array
 * @param registry  ToolRegistry
 * @param llmCall   async ({messages}) => ({ content })   // worker round-trip
 * @param maxSteps  default 3 (in-browser inference is slow; keep it tight)
 * @param ctx       passed to tool.execute (e.g. { sensorState })
 * @param onEvent   ({type, ...}) for UI status
 */
export async function runAgent({ messages, registry, llmCall, maxSteps = 3, ctx = {}, onEvent }) {
  const convo = messages.map(m => ({ ...m }));
  ensureSystemTools(convo, registry);

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
    // far more reliably than a `tool` role.
    convo.push({
      role: 'user',
      content: `TOOL_RESULT (${call.name}):\n${typeof result === 'string' ? result : JSON.stringify(result)}\n\nUse this to answer in your own voice, or call another tool.`
    });
  }

  onEvent?.({ type: 'cap_reached' });
  return { final: "I circled that a few times — let me pause rather than spin. Ask me to keep going.", convo };
}
```

### A.4 Inference worker — `sophia-infer.worker.js`
If Sophia already runs her menu models in a worker, **don't duplicate loading** — just add the `generate` branch and reuse her loaded `model`/`tokenizer`. This is the reference shape:
```js
// sophia-infer.worker.js
import { AutoTokenizer, AutoModelForCausalLM } from '@huggingface/transformers';

let tokenizer = null, model = null, currentId = null;

self.onmessage = async (e) => {
  const { id, type, messages, modelId, genOpts } = e.data;
  try {
    if (type === 'load') {
      if (modelId !== currentId) {
        tokenizer = await AutoTokenizer.from_pretrained(modelId);
        model = await AutoModelForCausalLM.from_pretrained(modelId, { dtype: 'q4', device: 'webgpu' });
        currentId = modelId;
      }
      self.postMessage({ id, ready: true });
      return;
    }
    if (type === 'generate') {
      const inputs = tokenizer.apply_chat_template(messages, {
        add_generation_prompt: true,
        return_dict: true
        // For the LFM2 Agent-tier models you MAY pass `tools` here to use their
        // trained tool format; the manual path in agent-core works regardless.
      });
      const inputLen = inputs.input_ids.dims[1];
      const output = await model.generate({
        ...inputs, max_new_tokens: 512, do_sample: true, temperature: 0.7, ...genOpts
      });
      // Take only the newly generated tokens (after the prompt), then decode.
      // NOTE: verify this slice against the installed transformers.js version —
      // it's the one spot where the tensor API has shifted between releases.
      const genIds = output.slice(null, [inputLen, null]);
      const text = tokenizer.batch_decode(genIds, { skip_special_tokens: true })[0].trim();
      self.postMessage({ id, text });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
```

### A.5 The `llmCall` adapter (main thread → worker)
```js
// main thread — wraps the worker as the agent loop's llmCall seam
function makeLlmCall(worker) {
  return ({ messages }) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      e.data.error ? reject(new Error(e.data.error)) : resolve({ content: e.data.text });
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, type: 'generate', messages });
  });
}
```

### A.6 Wiring
```js
import { ToolRegistry, runAgent } from './agent-core.js';
import { webSearchTool } from './tools/web-search.js';

const worker   = new Worker(new URL('./sophia-infer.worker.js', import.meta.url), { type: 'module' });
const llmCall  = makeLlmCall(worker);
const registry = new ToolRegistry().register(webSearchTool);

// In Sophia's send handler, replace the direct generate call with:
const { final } = await runAgent({
  messages: conversation,          // her existing system+history
  registry,
  llmCall,
  ctx: { sensorState },            // optional live EEG/HRV context
  onEvent: (e) => {
    if (e.type === 'tool_start' && e.name === 'web_search')
      showStatus(`Sophia is consulting the web: "${e.args.query}"…`);
  }
});
renderSophia(final);
```

### A.7 Model routing + persona
- **When tools are active, default to `LFM2.5-1.2B-Instruct` (Agent Lite)** — the only menu model trained for tool use. Let the user keep a Warm Voice model for tool-free chat.
- **Qwen 0.5B / Gemma 3 1B are too small for dependable multi-step tool use** — great persona voices, weak agents. If one is selected with tools on, cap `maxSteps` at 1 and lean on the parser.
- Persona holds for free: results return through the model, so its next turn *interprets* them as Sophia. Add one line to her system prompt: *"When you use a tool, weave what you learned into your own voice and cite sources plainly — never paste raw results or bare links."*

---

## PART B — Web Search Tool (unchanged from v1; still required)

### B.1 Why a proxy
DuckDuckGo has **no official general-search API** (only a limited Instant Answer API) and **blocks cross-origin browser requests via CORS**. A client-side PWA can't fetch DDG results directly — real results need a **server-side hop**. For local-first, that's a tiny local proxy.

### B.2 `sophia_search_proxy.py`
```python
# sophia_search_proxy.py   |   pip install "ddgs" flask flask-cors
from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
from ddgs import DDGS

app = Flask(__name__)
CORS(app, resources={r"/search": {"origins": [
    "https://<sophia-github-pages-domain>", "http://localhost:*", "http://127.0.0.1:*",
]}})

@app.after_request
def _pna(resp):  # Chrome Private Network Access: public site -> localhost preflight
    resp.headers["Access-Control-Allow-Private-Network"] = "true"
    return resp

@app.route("/search", methods=["GET", "OPTIONS"])
def search():
    if request.method == "OPTIONS":
        return make_response("", 204)
    q = (request.args.get("q") or "").strip()
    n = min(max(int(request.args.get("n", 5)), 1), 8)
    if not q:
        return jsonify({"results": []})
    try:
        with DDGS() as ddgs:
            hits = list(ddgs.text(q, max_results=n))   # keys: title, href, body
        return jsonify({"results": [
            {"title": h.get("title"), "url": h.get("href"), "snippet": h.get("body")} for h in hits
        ]})
    except Exception as e:
        return jsonify({"results": [], "error": str(e)}), 502

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8787)
```
`python sophia_search_proxy.py`. Verify `ddgs` result keys against its current README. Localhost is exempt from HTTPS mixed-content blocking, so the HTTPS PWA can call `http://127.0.0.1:8787`; the CORS block + PNA header handle the rest. (Simplest alternative that sidesteps both: serve Sophia from localhost during personal use.)

### B.3 `tools/web-search.js`
Runs in the **main-thread** orchestration context (so the JSONP fallback's `document` access works).
```js
// tools/web-search.js
export const webSearchTool = {
  name: 'web_search',
  description:
    'Search the live web via DuckDuckGo for current or uncertain information — recent ' +
    'events, specific facts, sources to cite. Use when your knowledge may be stale.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      max_results: { type: 'integer', description: 'How many results (1-8).', default: 5 }
    },
    required: ['query']
  },
  execute: async ({ query, max_results = 5 }) => {
    const base = window.SOPHIA_SEARCH_PROXY || 'http://127.0.0.1:8787';
    try {
      const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&n=${max_results}`);
      if (!r.ok) throw new Error(`proxy ${r.status}`);
      const data = await r.json();
      if (!data.results?.length) return `No results for "${query}".`;
      return data.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.snippet}`).join('\n\n');
    } catch (e) {
      const ia = await ddgInstantAnswer(query).catch(() => null);   // browser-only, limited
      if (ia?.AbstractText) return `${ia.Heading || query}: ${ia.AbstractText}\n(source: ${ia.AbstractURL})`;
      return `Search unavailable (${e.message}). Local proxy not running and no instant answer found.`;
    }
  }
};

function ddgInstantAnswer(query) {   // JSONP sidesteps CORS; returns instant answers only
  return new Promise((resolve, reject) => {
    const cb = 'ddg_' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    window[cb] = (d) => { resolve(d); delete window[cb]; s.remove(); };
    s.onerror = () => { reject(new Error('IA failed')); s.remove(); };
    s.src = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&callback=${cb}`;
    document.body.appendChild(s);
  });
}
```

---

## Acceptance criteria
1. `agent-core.js`, `sophia-infer.worker.js`, `tools/web-search.js` exist as separate modules; only an include + send-handler edit touch `index.html`.
2. Inference runs in a Web Worker; the UI stays responsive across a 3-step loop.
3. With the proxy running and **LFM2.5-1.2B-Instruct** selected: a current-events question (e.g. "latest on rotating spiral brain waves research?") triggers `web_search`, and Sophia answers **in voice with a cited source** — no raw link dump.
4. Proxy down → clean JSONP fallback or a graceful "search unavailable" message; never a hang.
5. Malformed / missing tool args are rejected before execute; malformed tool JSON from a tiny model is either parsed by `parseToolCall` or falls through to a normal answer (no crash).
6. Persona intact across tool use.

## Non-goals this pass
- No proactive/scheduled/EEG-triggered outreach.
- No tools beyond `web_search` (the registry makes meditation-control, ephemeris/horoscope, and session-lookup drop-in descriptors later).
- No fine-tuning.

## Caveats to keep visible
- `ddgs` scraping is unofficial — can break or hit CAPTCHAs under load; keep the fallback, don't hammer it. Upgrade paths if it degrades: Brave Search API (official free tier, still proxied to keep the key off the client) or self-hosted SearXNG.
- Tiny/ternary models are the weak link for tool reliability. The manual parser + `user`-role tool results + Agent-tier default are the mitigations; constrained decoding (via a grammar) is the real fix if needed later.
- Verify the transformers.js token-slice in the worker against the installed version — that API has moved between releases.
- Because it's WebGPU, this same PWA runs on the ROG Phone 9 Pro's Chrome (121+), so the agentic core ships to desktop and phone from one codebase. A dedicated NPU build (Nexa/Genie) stays optional, for later, if you want more phone speed than WebGPU gives.

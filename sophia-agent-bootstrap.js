// sophia-agent-bootstrap.js — bridges the ES-module agentic core into Sophia's
// classic-script app (same pattern as the sensor drivers: ESM logic, window seam).
//
// Exposes window.SophiaAgent.runAgentTurn(). The classic send-handler
// (generateLocalStreamingResponse / generateLocalResponse in index.html) calls it
// when the web_search tool is enabled. Everything the loop needs from the classic
// realm — the inference call, the live tool list, model routing — is PASSED IN,
// because a module cannot read the app's let/const globals (they aren't on window).
//
// The inference Worker is reused as-is (via the passed llmCall wrapping
// workerGenerate); we never load a second copy of the model.

import { ToolRegistry, runAgent } from './agent-core.js';
import { webSearchTool } from './tools/web-search.js';
import { astrologyTool } from './tools/astrology.js';

// web_search works with NO proxy by default (Wikipedia + Crossref + Europe PMC,
// browser-native). Set window.SOPHIA_SEARCH_PROXY = 'http://127.0.0.1:8787' only
// if you run the optional local proxy for full open-web (DuckDuckGo) results.

// Bridge a classic sync tool ({name, description, params, code}) into the async
// registry shape. Its synchronous code() result is stringified for the model.
function bridgeSyncTool(t) {
  return {
    name: t.name,
    description: t.description,
    parameters: { type: 'object', properties: t.params || {}, required: [] },
    execute: async (args) => {
      try {
        const r = t.code(args);
        return typeof r === 'string' ? r : JSON.stringify(r);
      } catch (e) {
        return `Error running ${t.name}: ${e.message}`;
      }
    }
  };
}

window.SophiaAgent = {
  /**
   * runAgentTurn — build a fresh registry (web_search + bridged sync tools) and
   * run the tool-use loop for one user turn.
   * @param messages      prepared system+history+user array (already model-shaped)
   * @param bridgedTools  enabled classic sync tools to expose (web_search excluded)
   * @param llmCall       async ({messages, tools}) => ({content}) — wraps the worker
   * @param maxSteps      loop cap (3 for LFM2.5 / native-tool models, 1 for tiny)
   * @param onEvent       ({type,...}) UI status callback
   * @param ctx           passed to tool.execute
   * @param nativeTools   model has a trained tool_use chat template (Qwen 3.5) —
   *                      send JSON schemas instead of prompt prose
   * @param budget        { maxPromptTokens, maxResultChars } — the loop adds a tool
   *                      block and a whole tool result per step on top of whatever
   *                      the host already budgeted, and re-sends it every step. On a
   *                      small GPU that is what runs out; pass the ceiling.
   * @returns { final, convo }
   */
  async runAgentTurn({ messages, bridgedTools = [], llmCall, maxSteps = 3, onEvent, ctx = {}, nativeTools = false, budget = null }) {
    const registry = new ToolRegistry();
    // Tools with a real async implementation here are skipped in the bridge —
    // their classic-side entry is only a stub for the remote tool path.
    const NATIVE = new Set(['web_search', 'astrology_report']);
    for (const t of bridgedTools) {
      if (!t || NATIVE.has(t.name)) continue;
      try { registry.register(bridgeSyncTool(t)); } catch { /* skip malformed tool */ }
    }
    registry.register(webSearchTool);
    // astrology_report is opt-in like web_search: only expose it when enabled,
    // so a chart tool isn't advertised to a 0.8B model on every single turn.
    if (bridgedTools.some(t => t && t.name === 'astrology_report' && t.enabled !== false)) {
      registry.register(astrologyTool);
    }
    return await runAgent({ messages, registry, llmCall, maxSteps, ctx, onEvent, nativeTools, budget });
  }
};

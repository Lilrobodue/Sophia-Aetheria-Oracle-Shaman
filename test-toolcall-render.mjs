// What the user actually sees when a tool call happens.
//
// The parsers were right and the tarot draw still looked broken, because the
// rendering around them wasn't:
//   - the live bubble streamed the raw tool protocol and was closed before the
//     markup was stripped, so the protocol stayed on screen;
//   - the follow-up interpretation was generated, appended to chatHistory, and
//     rendered nowhere, so a tool call ended in a bare result card and silence;
//   - that follow-up went down the non-streaming path even in streaming mode.
//
// This drives processResponse() itself against a stub DOM and asserts on what
// reaches the transcript.
//
// Run: node test-toolcall-render.mjs

import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8').split('\r').join('');

function between(startSig, endSig) {
    const i = html.indexOf(startSig);
    if (i < 0) throw new Error('start not found: ' + startSig);
    const j = html.indexOf(endSig, i);
    if (j < 0) throw new Error('end not found: ' + endSig);
    return html.slice(i, j + endSig.length);
}

/* ── Stub transcript ───────────────────────────────────────────────────── */

let ui, bubble, chatHistory, spoken, followUpCalls, pendingReasoning;

function reset() {
    ui = [];                                    // everything rendered, in order
    bubble = { id: 'streaming-message', content: '', removed: false, finalised: false };
    chatHistory = [{ role: 'user', content: 'could we dive deeper with a tarot draw?' }];
    spoken = [];
    followUpCalls = [];
    pendingReasoning = '';
}

const env = {
    // --- things processResponse reaches for ---
    config: { streamingEnabled: true, autoSpeak: false, fullPromptLocal: true },
    shouldUseLocal: () => true,
    tools: {
        tarot_draw: { name: 'tarot_draw', enabled: true, description: 'Draw tarot', params: {} },
    },
    executeTool: (name, params) => ({ ok: true, tool: name, got: params, cards: ['The Star'] }),
    divinationProvenanceHTML: () => '<div class="prov">entropy</div>',
    recordDivinationCast: () => {},
    extractMemories: () => {},
    renderToolList: () => {},
    updateToolsIndicator: () => {},
    saveToolsState: () => {},
    speakText: (t) => spoken.push(t),
    addMessageToUI: (role, content) => ui.push({ kind: 'message', role, content }),
    updateStreamingMessage: (id, content) => { bubble.content = content; },
    finalizeStreamingMessage: () => { bubble.finalised = true; ui.push({ kind: 'bubble', content: bubble.content }); },
    // Consume-once, same as the app: reading it clears it.
    consumePendingReasoningHTML: () => { const r = pendingReasoning; pendingReasoning = ''; return r; },
    document: {
        getElementById: (id) => (id === bubble.id && !bubble.removed
            ? { remove: () => { bubble.removed = true; } }
            : null),
    },
    console: { warn() {}, error() {}, log() {} },
    // The follow-up generators, instrumented so the test can tell which ran and
    // what context it was handed.
    streamFollowUp: async (prompt, spokenSoFar) => {
        followUpCalls.push({ via: 'streaming', prompt, spokenSoFar });
        const text = 'The Star speaks of renewal after a long stretch of effort.';
        ui.push({ kind: 'bubble', content: text });
        return text;
    },
    generateResponse: async (prompt, files, spokenSoFar) => {
        followUpCalls.push({ via: 'non-streaming', prompt, spokenSoFar });
        return 'The Star speaks of renewal after a long stretch of effort.';
    },
};

const src = [
    between('function stripThinkBlocks(text) {', 'truncated by max_tokens\n        }'),
    between('function normalizeReasoningTags(text, preopened) {', '// (c), or no reasoning\n        }'),
    // The real gates and the real continuation wording, not stubs — they are
    // exactly what these tests exist to pin down.
    between('function agentOnlyToolsEnabled() {', 'catch (e) { return false; }\n        }'),
    between('function syncToolsEnabled() {', 'catch (e) { return false; }\n        }'),
    between('function withSpokenTurn(messages, spoken) {', 'return out;\n        }'),
    between('function followUpPromptFor(toolName, toolResult, spoken) {', "in your response.';\n        }"),
    between('async function processResponse(response, streamId = null) {', '\n        }\n\n        // One fixed element id'),
    'return { processResponse, syncToolsEnabled, agentOnlyToolsEnabled, withSpokenTurn, followUpPromptFor };',
].join('\n');

const { processResponse, syncToolsEnabled, agentOnlyToolsEnabled, withSpokenTurn, followUpPromptFor } =
    new Function(...Object.keys(env), src)(...Object.values(env));

// chatHistory is a closure variable in the app; expose it the same way.
Object.defineProperty(globalThis, 'chatHistory', {
    get: () => chatHistory, set: (v) => { chatHistory = v; }, configurable: true,
});

/* ── Assertions ────────────────────────────────────────────────────────── */

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + name); } };
const transcript = () => ui.map(u => u.content).join('\n---\n');

const NATIVE_CALL = "<|tool_call_start|>[tarot_draw(spread='celtic')]<|tool_call_end|>";

/* 1. Streaming, prose + a tool call — the tarot case */
reset();
bubble.content = 'Let me draw for you.\n' + NATIVE_CALL;
await processResponse('Let me draw for you.\n' + NATIVE_CALL, 'streaming-message');

t('tool ran', ui.some(u => u.kind === 'message' && u.role === 'system' && /Tool Called:<\/strong> tarot_draw/.test(u.content)));
t('no tool protocol anywhere in the transcript', !/<\|tool_call_start\|>|<\|tool_call_end\|>/.test(transcript()));
t('the prose survives', transcript().includes('Let me draw for you.'));
t('the follow-up was STREAMED, not silently generated', followUpCalls.length === 1 && followUpCalls[0].via === 'streaming');
t('the interpretation is actually rendered', transcript().includes('The Star speaks of renewal'));
t('the live bubble was closed', bubble.finalised);
t('chatHistory holds prose + interpretation', /Let me draw for you[\s\S]*The Star speaks of renewal/.test(chatHistory.at(-1).content));
t('chatHistory holds no protocol', !/tool_call_start/.test(chatHistory.at(-1).content));

/* 2. Streaming, the whole turn was a tool call and nothing else */
reset();
bubble.content = NATIVE_CALL;
await processResponse(NATIVE_CALL, 'streaming-message');
t('empty bubble removed rather than left blank', bubble.removed);
t('interpretation still rendered', transcript().includes('The Star speaks of renewal'));
t('chatHistory is the interpretation alone', chatHistory.at(-1).content === 'The Star speaks of renewal after a long stretch of effort.');

/* 3. Non-streaming must also interpret the result — it never used to */
reset();
env.config.streamingEnabled = false;
await processResponse('Drawing now.\n' + NATIVE_CALL, null);
t('non-streaming generates a follow-up at all', followUpCalls.length === 1 && followUpCalls[0].via === 'non-streaming');
t('non-streaming renders one assistant message', ui.filter(u => u.role === 'assistant').length === 1);
t('non-streaming message carries the interpretation',
    ui.find(u => u.role === 'assistant').content.includes('The Star speaks of renewal'));
t('non-streaming message carries no protocol',
    !/tool_call_start/.test(ui.find(u => u.role === 'assistant').content));
env.config.streamingEnabled = true;

/* 4. A plain answer with no tool call must be untouched */
reset();
bubble.content = 'The moon is waxing tonight.';
await processResponse('The moon is waxing tonight.', 'streaming-message');
t('no tool ran', !ui.some(u => u.role === 'system'));
t('no follow-up generated', followUpCalls.length === 0);
t('bubble kept and closed', bubble.finalised && !bubble.removed);
t('text intact', chatHistory.at(-1).content === 'The moon is waxing tonight.');

/* 5. Unparseable markup: a note, not raw protocol */
reset();
const BROKEN = '<|tool_call_start|>[???]<|tool_call_end|>';
bubble.content = 'Here goes.\n' + BROKEN;
await processResponse('Here goes.\n' + BROKEN, 'streaming-message');
t('user is told the call failed', ui.some(u => /Tool call not understood/.test(u.content)));
t('broken protocol stripped from view', !/tool_call_start/.test(transcript()));
t('no tool executed', !ui.some(u => /Tool Called:/.test(u.content)));
t('chatHistory free of protocol', !/tool_call_start/.test(chatHistory.at(-1).content));

/* 6. Reasoning panel survives the repaint */
reset();
pendingReasoning = '<details class="reasoning-block">plan</details>';
bubble.content = 'Drawing.\n' + NATIVE_CALL;
await processResponse('Drawing.\n' + NATIVE_CALL, 'streaming-message');
t('reasoning panel re-attached after the bubble is repainted',
    ui.some(u => u.kind === 'bubble' && u.content.includes('reasoning-block')));
t('reasoning never enters chatHistory', !/reasoning-block/.test(chatHistory.at(-1).content));

/* 7. The follow-up must CONTINUE the half-spoken turn, not answer afresh.
 *
 * A model stops generating the moment it emits a tool call, so the opening ends
 * mid-thought. The follow-up used to be handed the user's question and a tool
 * result with no trace of what Sophia had already said — chatHistory is not
 * written until the whole turn ends — so it started over and said the same
 * things again. Reported from the desktop as: the first half looked truncated,
 * and the second half mildly repeated it. */
reset();
bubble.content = 'Let me draw for you — I sense a threshold here.\n' + NATIVE_CALL;
await processResponse('Let me draw for you — I sense a threshold here.\n' + NATIVE_CALL, 'streaming-message');
t('the follow-up is handed what was already said',
    followUpCalls[0].spokenSoFar === 'Let me draw for you — I sense a threshold here.');
t('and is asked to carry on rather than restart', /carry straight on/.test(followUpCalls[0].prompt));
t('and told plainly not to repeat itself', /not restate what you already said/i.test(followUpCalls[0].prompt));
t('the tool result is still in the prompt', /tarot_draw tool returned/.test(followUpCalls[0].prompt));

/* 8. Nothing said before the call — there is nothing to continue, so ask plainly */
reset();
bubble.content = NATIVE_CALL;
await processResponse(NATIVE_CALL, 'streaming-message');
t('no continuation instruction when nothing was spoken', !/carry straight on/.test(followUpCalls[0].prompt));
t('it just interprets', /interpret this result naturally/.test(followUpCalls[0].prompt));

/* 9. withSpokenTurn puts the half-turn in the right place */
{
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'q' }, { role: 'user', content: 'tool result' }];
    const out = withSpokenTurn(msgs, 'I sense a threshold.');
    t('the spoken half goes in as an assistant turn', out[2].role === 'assistant');
    t('immediately before the tool result', out[3].content === 'tool result');
    t('the original array is not mutated', msgs.length === 3);
    t('empty spoken text changes nothing', withSpokenTurn(msgs, '   ').length === 3);
    t('missing spoken text changes nothing', withSpokenTurn(msgs).length === 3);
}

/* 10. The gates. This is the bug that made every reading a hallucination:
 * nine tools enabled, none of them agent-only, so the loop never armed — and
 * the fallback parser was skipped on local, so the TOOL_CALL: reply was read by
 * nobody. Sophia answered from her own head and returned hexagram 2 every time. */
{
    // `tools` is bound into the extracted functions by reference, so the registry
    // has to be mutated in place — reassigning env.tools would change nothing.
    const saveTools = { ...env.tools };
    const saveFull = env.config.fullPromptLocal;
    const setTools = (obj) => {
        for (const k of Object.keys(env.tools)) delete env.tools[k];
        Object.assign(env.tools, obj);
    };

    setTools({ tarot_draw: { enabled: true }, neural_iching: { enabled: true } });
    t('divination tools are sync tools', syncToolsEnabled() === true);
    t('and do not arm the multi-hop loop', agentOnlyToolsEnabled() === false);

    setTools({ web_search: { enabled: true, agentTool: true }, tarot_draw: { enabled: false } });
    t('an agent-only tool does arm the loop', agentOnlyToolsEnabled() === true);
    t('and is not mistaken for a sync tool', syncToolsEnabled() === false);

    setTools({ tarot_draw: { enabled: false }, web_search: { enabled: false, agentTool: true } });
    t('nothing enabled arms nothing', !syncToolsEnabled() && !agentOnlyToolsEnabled());

    // The real-world default: local model, full-prompt OFF, divination tools ON.
    // Before the fix this combination could not run a tool by any route.
    setTools(saveTools);
    env.config.fullPromptLocal = false;
    reset();
    bubble.content = 'Let me draw.\n' + NATIVE_CALL;
    await processResponse('Let me draw.\n' + NATIVE_CALL, 'streaming-message');
    t('a local model with tools on DOES run them, full-prompt off',
        ui.some(u => /Tool Called:<\/strong> tarot_draw/.test(u.content)));

    // And with every tool switched off, the old cheap skip still applies.
    setTools({});
    reset();
    bubble.content = 'Let me draw.\n' + NATIVE_CALL;
    await processResponse('Let me draw.\n' + NATIVE_CALL, 'streaming-message');
    t('no tools enabled: nothing is parsed and nothing runs',
        !ui.some(u => /Tool Called:/.test(u.content)));

    setTools(saveTools);
    env.config.fullPromptLocal = saveFull;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('\nALL TOOL-CALL RENDER TESTS PASSED');

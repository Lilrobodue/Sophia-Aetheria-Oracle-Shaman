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
    // The follow-up generators, instrumented so the test can tell which ran.
    streamFollowUp: async (prompt) => {
        followUpCalls.push({ via: 'streaming', prompt });
        const text = 'The Star speaks of renewal after a long stretch of effort.';
        ui.push({ kind: 'bubble', content: text });
        return text;
    },
    generateResponse: async (prompt) => {
        followUpCalls.push({ via: 'non-streaming', prompt });
        return 'The Star speaks of renewal after a long stretch of effort.';
    },
};

const src = [
    between('function stripThinkBlocks(text) {', 'truncated by max_tokens\n        }'),
    between('function normalizeReasoningTags(text, preopened) {', '// (c), or no reasoning\n        }'),
    between('async function processResponse(response, streamId = null) {', '\n        }\n\n        // One fixed element id'),
    'return { processResponse };',
].join('\n');

const { processResponse } = new Function(...Object.keys(env), src)(...Object.values(env));

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('\nALL TOOL-CALL RENDER TESTS PASSED');

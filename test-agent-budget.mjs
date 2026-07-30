/* test-agent-budget.mjs — the tool-use loop must hold a context ceiling.
 * The loop adds its own tool-instruction block and a whole tool result per step
 * on top of whatever the host budgeted, and re-sends the lot on EVERY step. On a
 * phone-class GPU that is what runs out. Plain node:  node test-agent-budget.mjs */
import { runAgent, ToolRegistry } from './agent-core.js';

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL: ' + m); fail++; } };
const tok = s => Math.ceil(String(s || '').length / 4);
const convoTokens = c => c.reduce((a, m) => a + tok(m.content), 0);

function bigRegistry(resultChars) {
  const reg = new ToolRegistry();
  reg.register({
    name: 'astrology_report',
    description: 'Cast a complete natal chart from birth details. '.repeat(6),
    parameters: { type: 'object', properties: { birth_date: { type: 'string' }, birth_time: { type: 'string' } }, required: [] },
    execute: async () => 'NATAL CHART — '.padEnd(resultChars, 'x')
  });
  for (let i = 0; i < 8; i++) {
    reg.register({
      name: 'filler_' + i,
      description: 'A tool with a long description that eats context. '.repeat(4),
      parameters: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: [] },
      execute: async () => 'ok'
    });
  }
  return reg;
}

/* An llmCall that calls the tool on step 0, then answers — and records the size
 * of every prompt it is handed, which is the thing under test. */
function recorder(callFirst = true) {
  const seen = [];
  let n = 0;
  const llmCall = async ({ messages }) => {
    seen.push({ tokens: convoTokens(messages), turns: messages.length });
    n++;
    return { content: (callFirst && n === 1)
      ? '{"tool":"astrology_report","args":{"birth_date":"1985-03-14"}}'
      : 'Here is what your chart says, in my own voice.' };
  };
  return { llmCall, seen };
}

const history = Array.from({ length: 14 }, (_, i) => ({
  role: i % 2 ? 'assistant' : 'user', content: ('turn ' + i + ' ').padEnd(1200, 'y')
}));
const messages = [{ role: 'system', content: 'You are Sophia. '.padEnd(3800, 'p') }, ...history];

console.log('--- every generation stays inside the ceiling ---');
{
  const LIMIT = 3392;                                  // agent-lite: 4096 - 512 - 192
  const { llmCall, seen } = recorder();
  const r = await runAgent({
    messages, registry: bigRegistry(9000), llmCall, maxSteps: 3,
    budget: { maxPromptTokens: LIMIT, maxResultChars: 3392 }
  });
  console.log('  prompts handed to the model:', seen.map(s => s.tokens + ' tok').join(' → '));
  ok(seen.length >= 2, 'the loop ran a tool step and a synthesis, got ' + seen.length + ' generations');
  seen.forEach((s, i) => ok(s.tokens <= LIMIT, `generation ${i} fits: ${s.tokens} <= ${LIMIT}`));
  ok(/own voice/.test(r.final), 'and still produced an answer: ' + r.final.slice(0, 40));
}

console.log('--- an oversized tool result is capped, and says so ---');
{
  const { llmCall } = recorder();
  let captured = null;
  const reg = bigRegistry(40000);
  const r = await runAgent({
    messages: [{ role: 'system', content: 'sys' }], registry: reg,
    llmCall: async ({ messages }) => {
      // NB: match the RESULT turn, not the system block — registry.instructions()
      // itself contains the words "After a TOOL_RESULT", which a loose test caught.
      const last = messages[messages.length - 1];
      if (last.role === 'user' && last.content.startsWith('TOOL_RESULT (')) captured = last.content;
      return { content: captured ? 'done' : '{"tool":"astrology_report","args":{}}' };
    },
    maxSteps: 2, budget: { maxPromptTokens: 100000, maxResultChars: 1200 }
  });
  ok(captured, 'the tool result reached the model');
  ok(captured.length < 1600, 'and was capped, got ' + captured.length + ' chars');
  ok(/truncated: \d+ more characters/.test(captured), 'with the truncation stated, not silent');
  ok(/shown in the app/.test(captured), 'and pointing at where the full result is');
}

console.log('--- the UI still gets the WHOLE result ---');
{
  let uiResult = null;
  const reg = bigRegistry(40000);
  await runAgent({
    messages: [{ role: 'system', content: 'sys' }], registry: reg,
    llmCall: async ({ messages }) => {
      const last = messages[messages.length - 1];
      const answered = last.role === 'user' && last.content.startsWith('TOOL_RESULT (');
      return { content: answered ? 'done' : '{"tool":"astrology_report","args":{}}' };
    },
    maxSteps: 2, budget: { maxResultChars: 1200 },
    onEvent: (e) => { if (e.type === 'tool_end') uiResult = e.result; }
  });
  ok(uiResult && uiResult.length > 39000, 'the full result goes to the UI, got ' + (uiResult || '').length + ' chars');
}

console.log('--- budget events report what happened ---');
{
  const events = [];
  const { llmCall } = recorder();
  await runAgent({
    messages, registry: bigRegistry(9000), llmCall, maxSteps: 2,
    budget: { maxPromptTokens: 3392, maxResultChars: 3392 },
    onEvent: (e) => { if (e.type === 'budget') events.push(e); }
  });
  ok(events.length >= 2, 'a budget event per generation, got ' + events.length);
  ok(events.every(e => typeof e.tokens === 'number' && e.limit === 3392), 'each carries size and limit');
  ok(events.some(e => e.droppedTurns > 0), 'and reports the turns it had to drop');
  console.log('  ' + events.map(e => `step ${e.step}: ${e.tokens}/${e.limit} (-${e.droppedTurns} turns)`).join(' · '));
}

console.log('--- no budget passed: behaviour unchanged ---');
{
  const { llmCall, seen } = recorder();
  const r = await runAgent({ messages, registry: bigRegistry(9000), llmCall, maxSteps: 2 });
  ok(seen[0].tokens > 3392, 'without a budget nothing is trimmed (' + seen[0].tokens + ' tok)');
  ok(r.final, 'and the loop still works');
}

console.log('--- the tool call and its result are never trimmed away ---');
{
  const LIMIT = 900;                                    // brutally small on purpose
  let sawResult = false;
  await runAgent({
    messages, registry: bigRegistry(2000),
    llmCall: async ({ messages }) => {
      if (messages.some(m => m.role === 'user' && m.content.startsWith('TOOL_RESULT ('))) sawResult = true;
      return { content: sawResult ? 'answer' : '{"tool":"astrology_report","args":{}}' };
    },
    maxSteps: 2, budget: { maxPromptTokens: LIMIT, maxResultChars: 800 }
  });
  ok(sawResult, 'the synthesis pass still sees the tool result even under a tiny ceiling');
}

console.log(fail === 0 ? '\nALL AGENT BUDGET TESTS PASSED' : `\n${fail} FAILURE(S)`);
process.exit(fail ? 1 : 0);

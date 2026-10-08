// Run under --unhandled-rejections=strict. This uses no API key or network client.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenAiProvider } = require('../../src/llm/openai/openai.provider');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LlmExecutionService } = require('../../src/llm/llm-execution.service');

async function check(mode) {
  const caller = new AbortController();
  let calls = 0;
  let sdkSignal;
  const create = (_body, options) => {
    calls += 1;
    sdkSignal = options.signal;
    if (mode === 'abort' || mode === 'deadline') {
      return new Promise((_resolve, reject) => {
        const fail = () => reject(new Error('APIUserAbortError'));
        if (options.signal.aborted) fail();
        else options.signal.addEventListener('abort', fail, { once: true });
      });
    }
    return Promise.resolve((async function* () {
      if (mode === 'provider-before') throw new Error('private SDK failure');
      if (mode === 'output-limit') yield { type: 'response.output_text.delta', delta: 'x'.repeat(4097) };
      else if (mode === 'invalid') yield { type: 'response.output_text.delta', delta: '' };
      else {
        yield { type: 'response.output_text.delta', delta: 'first' };
        if (mode === 'provider-after') throw new Error('private SDK failure');
        yield { type: 'response.output_text.delta', delta: 'second' };
        yield { type: 'response.completed', response: { status: 'completed' } };
      }
    })());
  };
  const provider = new OpenAiProvider({ get: (key) => key === 'LLM_MODEL' ? 'test-model' : 'test-only' }, { responses: { create } });
  const service = new LlmExecutionService({ getSelectedProvider: () => provider }, {});
  const events = [];
  const consume = async () => {
    for await (const event of service.streamAnswer({ requestId: 'req-probe', messages: [], evidence: [] }, {},
      { signal: caller.signal, deadlineMs: mode === 'deadline' ? 5 : 1000 })) events.push(event);
  };
  const pending = consume();
  if (mode === 'abort') setTimeout(() => caller.abort(), 5);
  let failure;
  try { await pending; } catch (error) { failure = error.message; }
  const expected = {
    abort: 'LLM_STREAM_ABORTED', deadline: 'LLM_STREAM_DEADLINE',
    'provider-before': 'LLM_STREAM_PROVIDER_FAILURE', 'provider-after': 'LLM_STREAM_PROVIDER_FAILURE',
    'output-limit': 'LLM_STREAM_OUTPUT_LIMIT', invalid: 'LLM_STREAM_INVALID_EVENT'
  }[mode];
  if (failure !== expected || calls !== 1 || (mode === 'success' && (events.length !== 3 || sdkSignal.aborted))) {
    throw new Error('STREAM_LIFECYCLE_PROBE_FAILED');
  }
  if (mode !== 'success' && (events.some((event) => event.type === 'completed') ||
    ((mode === 'abort' || mode === 'deadline' || mode === 'output-limit' || mode === 'invalid') && !sdkSignal.aborted))) {
    throw new Error('STREAM_LIFECYCLE_PROBE_FAILED');
  }
}

(async () => {
  for (const mode of ['success', 'provider-before', 'provider-after', 'abort', 'deadline', 'output-limit', 'invalid']) {
    await check(mode);
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  process.stdout.write('PROCESS_SAFE');
})().catch(() => {
  process.stderr.write('STREAM_LIFECYCLE_PROBE_FAILED');
  process.exitCode = 1;
});

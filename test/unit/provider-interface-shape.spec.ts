import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConnectorAdapter } from '../../src/connectors/connector-adapter.interface';
import { LlmProvider } from '../../src/llm/llm-provider.interface';
import { TokenizerAdapter } from '../../src/query-understanding/tokenizer-adapter.interface';
import { RetrievalProvider } from '../../src/retrieval/retrieval-provider.interface';

describe('provider and adapter interfaces', () => {
  it('keeps domain contracts outside common/providers', () => {
    expect(existsSync(join(process.cwd(), 'src/common/providers'))).toBe(false);
  });

  it('allows downstream modules to type against focused domain contracts', () => {
    const llmProvider: Pick<LlmProvider, 'key' | 'getMetadata'> = {
      key: 'fake-llm',
      getMetadata: () => ({ provider: 'fake-llm', model: 'fake-model', fallbackUsed: false })
    };
    const retrievalProvider: Pick<RetrievalProvider, 'key'> = { key: 'fake-retrieval' };
    const tokenizerAdapter: Pick<TokenizerAdapter, 'key'> = { key: 'fake-tokenizer' };
    const connectorAdapter: Pick<ConnectorAdapter, 'key' | 'listTools'> = {
      key: 'fake-connector',
      listTools: () => []
    };

    expect(llmProvider.getMetadata().provider).toBe('fake-llm');
    expect(retrievalProvider.key).toBe('fake-retrieval');
    expect(tokenizerAdapter.key).toBe('fake-tokenizer');
    expect(connectorAdapter.listTools()).toEqual([]);
  });

  it('exposes a typed abortable provider stream rather than SDK events', async () => {
    const controller = new AbortController();
    const provider: Pick<LlmProvider, 'streamAnswer'> = {
      async *streamAnswer(_input, options) {
        expect(options.signal).toBe(controller.signal);
        yield { type: 'text_delta', text: '甲' };
        yield { type: 'completed', finishReason: 'stop', metadata: { provider: 'fake-llm', model: 'fake-model', fallbackUsed: false } };
      }
    };
    const events = [];
    for await (const event of provider.streamAnswer({ requestId: 'req-stream', messages: [], evidence: [] }, { signal: controller.signal })) events.push(event);
    expect(events).toEqual([
      { type: 'text_delta', text: '甲' },
      { type: 'completed', finishReason: 'stop', metadata: { provider: 'fake-llm', model: 'fake-model', fallbackUsed: false } }
    ]);
  });
});

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
});

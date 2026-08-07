import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { DOMAIN_LEXICON } from '../../src/query-understanding/domain-lexicon';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { TokenizerAdapter } from '../../src/query-understanding/tokenizer-adapter.interface';

const identityContext = {
  requestId: 'req-tokenizer-001',
  actor: {
    actorId: 'actor-001',
    role: 'planner',
    permissionScopes: ['orders:read', 'inventory:read']
  },
  hostApp: {
    hostApp: 'erp'
  },
  company: {
    organizationId: 'org-001'
  }
};

describe('Traditional Chinese tokenizer', () => {
  it('splits Traditional Chinese sentences on Chinese and ASCII punctuation', async () => {
    const service = new RuleBasedQueryUnderstandingPipeline();

    const result = await service.understand({
      requestId: 'req-tokenizer-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '查 SO-10001 狀態。再看庫存！可以嗎?',
      identityContext
    });

    expect(result.sentences.map((sentence) => sentence.text)).toEqual([
      '查 SO-10001 狀態',
      '再看庫存',
      '可以嗎'
    ]);
  });

  it('keeps multi-condition queries and extracts business phrases', async () => {
    const service = new RuleBasedQueryUnderstandingPipeline();

    const result = await service.understand({
      requestId: 'req-tokenizer-002',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '幫我查 SO-10001 的狀態，順便看 SKU-ABC-001 的庫存',
      identityContext
    });

    expect(result.tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'SO-10001' }),
        expect.objectContaining({ value: 'SKU-ABC-001' }),
        expect.objectContaining({ value: '庫存' })
      ])
    );
    expect(result.phrases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '庫存', category: 'resource' }),
        expect.objectContaining({ normalizedValue: 'read', category: 'intent' })
      ])
    );
    expect(result.subTasks.map((task) => task.type)).toEqual(
      expect.arrayContaining(['order_status_lookup', 'inventory_availability_lookup'])
    );
  });

  it('preserves alphanumeric business identifiers as complete tokens', async () => {
    const adapter = new DefaultTokenizerAdapter();
    const result = await adapter.tokenize({
      requestId: 'req-tokenizer-003',
      text: '查 SO-10001、WO-20002、SKU-ABC-001'
    });

    expect(result.tokens.map((token) => token.value)).toEqual(
      expect.arrayContaining(['SO-10001', 'WO-20002', 'SKU-ABC-001'])
    );
  });

  it('uses the shared domain lexicon for tokenizer terms', async () => {
    const adapter = new DefaultTokenizerAdapter();
    const lexiconTerms = DOMAIN_LEXICON.flatMap((entry) => entry.terms);
    const result = await adapter.tokenize({
      requestId: 'req-tokenizer-lexicon',
      text: '工單 製令 料號 品號 SKU 訂單 銷售單 客戶 供應商 庫存 查詢 取消 更新 修改 核准 刪除'
    });
    const termsWithoutTimeOrSingleCharRead = lexiconTerms.filter(
      (term) => !['查', '看', '確認', '今天', '昨天', '本週', '上週', '本月', '近三個月'].includes(term)
    );

    expect(result.tokens.map((token) => token.value)).toEqual(expect.arrayContaining(termsWithoutTimeOrSingleCharRead));
  });

  it('allows replacing tokenizer adapter without binding to a specific package', async () => {
    const fakeTokenizer: TokenizerAdapter = {
      key: 'fake-tokenizer',
      tokenize: jest.fn().mockResolvedValue({
        tokenizer: 'fake-tokenizer',
        tokens: [
          {
            value: 'FAKE-001',
            normalizedValue: 'FAKE-001',
            startOffset: 0,
            endOffset: 8,
            confidence: 1
          }
        ]
      }),
      extractPhrases: jest.fn().mockResolvedValue({
        tokenizer: 'fake-tokenizer',
        phrases: [
          {
            value: '假片語',
            normalizedValue: 'fakePhrase',
            confidence: 0.99,
            category: 'resource'
          }
        ]
      })
    };
    const service = new RuleBasedQueryUnderstandingPipeline(fakeTokenizer);

    const result = await service.understand({
      requestId: 'req-tokenizer-004',
      sessionId: 'session-001',
      messageId: 'message-004',
      text: 'anything',
      identityContext
    });

    expect(fakeTokenizer.tokenize).toHaveBeenCalled();
    expect(fakeTokenizer.extractPhrases).toHaveBeenCalled();
    expect(result.tokens).toEqual([expect.objectContaining({ value: 'FAKE-001' })]);
    expect(result.phrases).toEqual([expect.objectContaining({ value: '假片語' })]);
  });
});

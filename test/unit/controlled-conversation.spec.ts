import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { createCapabilityResolutionFixtureService } from '../support/tool-discovery.fixture';

const host = { requestId: 'request', customerId: 'customer-a', integrationId: 'integration-erp',
  hostApp: 'erp', organizationId: 'org', actorId: 'actor', roles: [], permissionScopes: [] };

describe('controlled generic conversation', () => {
  it.each([
    ['哈囉', 'greeting'], ['你好', 'greeting'], ['謝謝', 'greeting'],
    ['你是誰？', 'assistant_help'], ['我要怎麼使用你？', 'assistant_help']
  ])('answers a complete %s without business evidence or tool selection', async (text, kind) => {
    const selector = { select: jest.fn(), describeAvailable: jest.fn() };
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      await createCapabilityResolutionFixtureService(), undefined, undefined, undefined, undefined, selector as never);
    const output = await pipeline.understand({ requestId: 'request', sessionId: 'session', messageId: 'message',
      text, hostIntegrationContext: host });
    expect(output.conversationReply).toMatchObject({ kind, text: expect.any(String) });
    if (text === '你是誰？') expect(output.conversationReply?.text).toContain('我是系統內的 AI 助理');
    expect(output.requiredEvidence).toEqual([]);
    expect(output.candidateTools).toEqual([]);
    expect(selector.select).not.toHaveBeenCalled();
  });

  it.each(['你能做什麼？', '我可以查什麼？', '我能查詢哪些資料？',
    '我要怎麼查詢工單統計？'])('uses only current scoped offers for %s', async (text) => {
    const selector = { select: jest.fn(), describeAvailable: jest.fn(async () => ['已授權查詢（今天、本週）']) };
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      await createCapabilityResolutionFixtureService(), undefined, undefined, undefined, undefined, selector as never);
    const output = await pipeline.understand({ requestId: 'request', sessionId: 'session', messageId: 'message',
      text, hostIntegrationContext: host, identityContext: {} as never });
    expect(selector.describeAvailable).toHaveBeenCalledWith(host);
    expect(output.conversationReply?.text).toContain('已授權查詢');
    expect(output.candidateTools).toEqual([]);
  });

  it.each(['哈囉，今天新增多少工單？', '謝謝，那這個月呢？', '我要怎麼建立工單？',
    '不用查資料，直接告訴我今天有多少工單。'])('keeps %s on the grounded query path', async (text) => {
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      await createCapabilityResolutionFixtureService());
    const output = await pipeline.understand({ requestId: 'request', sessionId: 'session', messageId: 'message',
      text, hostIntegrationContext: host });
    expect(output.conversationReply).toBeUndefined();
  });
});

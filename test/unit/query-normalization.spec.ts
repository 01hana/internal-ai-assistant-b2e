import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

const identityContext = {
  requestId: 'req-normalization-001',
  actor: {
    actorId: 'actor-001',
    role: 'planner',
    permissionScopes: ['orders:read', 'inventory:read', 'work-orders:read']
  },
  hostApp: {
    hostApp: 'erp'
  },
  company: {
    organizationId: 'org-001'
  }
};

const fixedNow = new Date('2026-06-21T04:00:00.000Z');

describe('query normalization and time range parsing', () => {
  const service = new RuleBasedQueryUnderstandingPipeline();

  it('normalizes ERP/MES/WMS/SCM/CRM domain terms with traceable metadata', async () => {
    const result = await service.understand({
      requestId: 'req-normalization-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '查工單、製令、料號、品號、SKU、訂單、銷售單、客戶、供應商',
      identityContext,
      now: fixedNow,
      timezone: 'Asia/Taipei'
    });

    expect(result.normalizedTerms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalTerm: '工單', normalizedTerm: 'workOrder', category: 'resource' }),
        expect.objectContaining({ originalTerm: '製令', normalizedTerm: 'workOrder', category: 'resource' }),
        expect.objectContaining({ originalTerm: '料號', normalizedTerm: 'itemSku', category: 'entity' }),
        expect.objectContaining({ originalTerm: '品號', normalizedTerm: 'itemSku', category: 'entity' }),
        expect.objectContaining({ originalTerm: 'SKU', normalizedTerm: 'itemSku', category: 'entity' }),
        expect.objectContaining({ originalTerm: '訂單', normalizedTerm: 'order', category: 'resource' }),
        expect.objectContaining({ originalTerm: '銷售單', normalizedTerm: 'order', category: 'resource' }),
        expect.objectContaining({ originalTerm: '客戶', normalizedTerm: 'businessPartner', category: 'resource' }),
        expect.objectContaining({ originalTerm: '供應商', normalizedTerm: 'businessPartner', category: 'resource' })
      ])
    );
  });

  it('parses deterministic relative time ranges', async () => {
    const result = await service.understand({
      requestId: 'req-normalization-002',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '今天、昨天、本週、上週、本月、近三個月的訂單',
      identityContext,
      now: fixedNow,
      timezone: 'Asia/Taipei'
    });

    expect(result.timeRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'today', start: '2026-06-21', end: '2026-06-21' }),
        expect.objectContaining({ label: 'yesterday', start: '2026-06-20', end: '2026-06-20' }),
        expect.objectContaining({ label: 'this_week', start: '2026-06-15', end: '2026-06-21' }),
        expect.objectContaining({ label: 'last_week', start: '2026-06-08', end: '2026-06-14' }),
        expect.objectContaining({ label: 'this_month', start: '2026-06-01', end: '2026-06-30' }),
        expect.objectContaining({ label: 'last_three_months', start: '2026-03-21', end: '2026-06-21' })
      ])
    );
  });

  it('uses Asia/Taipei local date across the UTC day boundary', async () => {
    const result = await service.understand({
      requestId: 'req-normalization-tz',
      sessionId: 'session-001',
      messageId: 'message-tz',
      text: '今天的訂單',
      identityContext,
      now: new Date('2026-06-20T16:30:00.000Z'),
      timezone: 'Asia/Taipei'
    });

    expect(result.timeRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'today', start: '2026-06-21', end: '2026-06-21' })
      ])
    );
  });

  it('creates clarification needs for unsupported or ambiguous time wording', async () => {
    const result = await service.understand({
      requestId: 'req-normalization-003',
      sessionId: 'session-001',
      messageId: 'message-003',
      text: '幫我看最近的訂單',
      identityContext,
      now: fixedNow,
      timezone: 'Asia/Taipei'
    });

    expect(result.clarificationNeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'unsupported_time_range',
          blocking: true
        })
      ])
    );
    expect(result.confidence).toBeLessThan(0.7);
  });
});

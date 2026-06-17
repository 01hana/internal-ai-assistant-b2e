import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';

describe('LlmInputSanitizerService', () => {
  it('keeps only visible fields before data can enter LLM-bound payloads', () => {
    const service = new LlmInputSanitizerService();

    const result = service.sanitize({
      record: {
        status: '已確認',
        customerName: '王小明企業',
        amount: 128000,
        grossMargin: 0.42,
        internalNote: 'Do not expose'
      },
      visibleFields: ['status', 'customerName']
    });

    expect(result.sanitized).toEqual({
      status: '已確認',
      customerName: '王小明企業'
    });
    expect(result.removedFieldCount).toBe(3);
    expect(JSON.stringify(result)).not.toContain('128000');
    expect(JSON.stringify(result)).not.toContain('grossMargin');
    expect(JSON.stringify(result)).not.toContain('internalNote');
  });
});

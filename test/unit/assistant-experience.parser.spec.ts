import { readFileSync } from 'node:fs';
import { parseAssistantExperiencePayload } from '../../src/assistant-experience/assistant-experience.parser';

const valid = () => JSON.parse(readFileSync('test/fixtures/assistant-experience/customer-a.v1.json', 'utf8'));
const errorsOf = (input: unknown) => {
  const result = parseAssistantExperiencePayload(input);
  return result.ok ? [] : result.errors.map((error) => `${error.path}:${error.code}`);
};

describe('assistant experience payload parser (Feature 013 T012)', () => {
  it('accepts the synthetic Customer A configuration and returns a frozen copy', () => {
    const result = parseAssistantExperiencePayload(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.quickReplies).toHaveLength(3);
    expect(Object.isFrozen(result.payload.quickReplies[1])).toBe(true);
  });

  it('rejects non-objects, unknown keys and unsupported versions', () => {
    expect(errorsOf(null)).toEqual(['$:NOT_OBJECT']);
    expect(errorsOf({ ...valid(), extra: true })).toContain('$.extra:UNKNOWN_KEY');
    expect(errorsOf({ ...valid(), version: '2' })).toContain('$.version:UNSUPPORTED_VERSION');
    expect(errorsOf({ ...valid(), semanticReviewStatus: 'AI_INFERRED' })).toContain('$.semanticReviewStatus:INVALID_VALUE');
  });

  it('rejects missing required fields', () => {
    const input = valid();
    delete input.greeting;
    delete input.quickReplies[1].capabilityKey;
    delete input.followUps[0].message;
    expect(errorsOf(input)).toEqual(expect.arrayContaining([
      '$.greeting:REQUIRED', '$.quickReplies[1].capabilityKey:REQUIRED', '$.followUps[0].message:REQUIRED']));
  });

  it('enforces bounds on counts, lengths and priority', () => {
    const input = valid();
    input.maxQuickReplies = 7;
    input.quickReplies[0].label = 'x'.repeat(41);
    input.quickReplies[1].message = 'x'.repeat(201);
    input.quickReplies[2].priority = 1.5;
    input.greeting.text = '';
    expect(errorsOf(input)).toEqual(expect.arrayContaining([
      '$.maxQuickReplies:OUT_OF_RANGE', '$.quickReplies[0].label:TOO_LONG',
      '$.quickReplies[1].message:TOO_LONG', '$.quickReplies[2].priority:OUT_OF_RANGE', '$.greeting.text:EMPTY']));
  });

  it('rejects duplicate ids across Quick Replies and follow-ups and unsafe ids', () => {
    const input = valid();
    input.followUps[0].id = 'overview';
    input.quickReplies[1].id = 'Has Space';
    expect(errorsOf(input)).toEqual(expect.arrayContaining(['$.followUps[0].id:DUPLICATE_ID', '$.quickReplies[1].id:INVALID_ID']));
  });

  it('applies kind-specific rules', () => {
    const input = valid();
    input.quickReplies[0].capabilityKey = 'work-orders.count';
    input.quickReplies[1].kind = 'tool';
    expect(errorsOf(input)).toEqual(expect.arrayContaining([
      '$.quickReplies[0].capabilityKey:NOT_ALLOWED_FOR_KIND', '$.quickReplies[1].kind:INVALID_VALUE']));
  });

  it('rejects non-scalar parameter values and empty page scopes', () => {
    const input = valid();
    input.quickReplies[1].parameters = { timeRange: ['today'] };
    input.quickReplies[2].pageScope = { modules: [] };
    expect(errorsOf(input)).toEqual(expect.arrayContaining([
      '$.quickReplies[1].parameters.timeRange:INVALID_TYPE', '$.quickReplies[2].pageScope.modules:OUT_OF_RANGE']));
  });

  it('never echoes configuration text in errors', () => {
    const input = valid();
    input.quickReplies[0].label = '機密文字'.repeat(20);
    expect(JSON.stringify(parseAssistantExperiencePayload(input))).not.toContain('機密文字');
  });
});

import { readFileSync } from 'node:fs';
import { parseAssistantExperiencePayload } from '../../src/assistant-experience/assistant-experience.parser';
import { AssistantExperienceValidator } from '../../src/assistant-experience/assistant-experience.validator';
import type { AssistantExperiencePayloadV1 } from '../../src/assistant-experience/assistant-experience.types';
import { createExperienceHarness } from '../support/assistant-experience.fixture';

const raw = () => JSON.parse(readFileSync('test/fixtures/assistant-experience/customer-a.v1.json', 'utf8'));
const parsed = (input: unknown): AssistantExperiencePayloadV1 => {
  const result = parseAssistantExperiencePayload(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.payload;
};

describe('assistant experience validator against the active Capability Pack (Feature 013 T013)', () => {
  async function validate(input: unknown) {
    const h = await createExperienceHarness();
    return (await new AssistantExperienceValidator(h.registry, h.binding).validate(parsed(input)))
      .map((error) => `${error.path}:${error.code}`);
  }

  it('accepts a configuration whose declared capabilities and parameters bind to active bindings', async () => {
    expect(await validate(raw())).toEqual([]);
  });

  it('treats message text as display-only (Decision 4)', async () => {
    const input = raw();
    input.quickReplies[1].message = '任何顯示文字';
    input.followUps[0].message = '不需要能被語意解析';
    expect(await validate(input)).toEqual([]);
  });

  it('rejects a scope without an active pack', async () => {
    expect(await validate({ ...raw(), integrationId: 'integration-other' })).toEqual(['$.hostApps[0]:NO_ACTIVE_PACK']);
    expect(await validate({ ...raw(), hostApps: ['erp', 'other-app'] })).toEqual(['$.hostApps[1]:NO_ACTIVE_PACK']);
  });

  it('rejects capability keys and parameters the pack does not declare', async () => {
    const input = raw();
    input.quickReplies[1].capabilityKey = 'unknown.capability';
    input.quickReplies[2].parameters = { timeRange: 'last_year' };
    input.followUps[0].whenCapabilityKey = 'inventory.missing';
    input.followUps[1].parameters = { period: 'this_month' };
    expect(await validate(input)).toEqual(expect.arrayContaining([
      '$.quickReplies[1].capabilityKey:CAPABILITY_NOT_IN_PACK',
      '$.quickReplies[2].parameters.timeRange:PARAMETER_VALUE_NOT_DECLARED',
      '$.followUps[0].whenCapabilityKey:CAPABILITY_NOT_IN_PACK',
      '$.followUps[1].parameters.period:PARAMETER_NOT_DECLARED']));
  });

  it('rejects a declared capability that has no active binding or misses required parameters', async () => {
    const input = raw();
    input.quickReplies[1].capabilityKey = 'inventory.availability';
    delete input.quickReplies[1].parameters;
    input.followUps[0].capabilityKey = 'orders.status';
    delete input.followUps[0].parameters;
    expect(await validate(input)).toEqual([
      '$.quickReplies[1].parameters:PARAMETERS_NOT_BOUND', '$.followUps[0].parameters:PARAMETERS_NOT_BOUND']);
  });

  it('never writes resolution audit events during provisioning validation', async () => {
    const h = await createExperienceHarness();
    await new AssistantExperienceValidator(h.registry, h.binding).validate(parsed(raw()));
    expect(h.audit.record).not.toHaveBeenCalled();
  });
});

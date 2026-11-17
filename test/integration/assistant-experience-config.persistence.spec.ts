import { readFileSync } from 'node:fs';
import { parseAssistantExperiencePayload } from '../../src/assistant-experience/assistant-experience.parser';
import { AssistantExperienceRepository, experienceChecksum } from '../../src/assistant-experience/assistant-experience.repository';
import type { AssistantExperiencePayloadV1 } from '../../src/assistant-experience/assistant-experience.types';
import { ReviewSourceType } from '../../src/generated/prisma/enums';
import { createUs1DbClient, describeDbBackedUs1 } from '../support/us1-db-test.helper';

/** Feature 013 T011 + T014: database constraints and the activation transaction. */
describeDbBackedUs1('AssistantExperienceConfig persistence', () => {
  const prisma = createUs1DbClient();
  const repository = new AssistantExperienceRepository({ db: prisma } as never);
  const payload = (configVersion: string, integrationId = 'integration-erp'): AssistantExperiencePayloadV1 => {
    const result = parseAssistantExperiencePayload({
      ...JSON.parse(readFileSync('test/fixtures/assistant-experience/customer-a.v1.json', 'utf8')), configVersion, integrationId });
    if (!result.ok) throw new Error('fixture invalid');
    return result.payload;
  };
  const clean = () => prisma.assistantExperienceConfig.deleteMany({ where: { customerId: 'customer-a' } });

  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('rejects a second active row for the same integration at the database level', async () => {
    const base = { customerId: 'customer-a', integrationId: 'integration-erp', checksum: 'x', payload: {}, status: 'active' as const,
      activeSlot: 'customer-a/integration-erp' };
    await prisma.assistantExperienceConfig.create({ data: { ...base, configVersion: '1.0.0' } });
    await expect(prisma.assistantExperienceConfig.create({ data: { ...base, configVersion: '1.1.0' } })).rejects.toThrow();
  });

  it('activating a new version retires the previous one in the same transaction', async () => {
    await repository.activate(payload('1.0.0'), experienceChecksum(payload('1.0.0')));
    await repository.activate(payload('1.1.0'), experienceChecksum(payload('1.1.0')));
    const rows = await prisma.assistantExperienceConfig.findMany({ where: { customerId: 'customer-a' }, orderBy: { configVersion: 'asc' } });
    expect(rows.map((row) => [row.configVersion, row.status, row.activeSlot])).toEqual([
      ['1.0.0', 'retired', null], ['1.1.0', 'active', 'customer-a/integration-erp']]);
    expect((await repository.findActive('customer-a', 'integration-erp'))?.configVersion).toBe('1.1.0');
  });

  it('keeps one active row per integration independently', async () => {
    await repository.activate(payload('1.0.0'), 'a');
    await repository.activate(payload('1.0.0', 'integration-other'), 'b');
    expect((await repository.findActive('customer-a', 'integration-erp'))?.configVersion).toBe('1.0.0');
    expect((await repository.findActive('customer-a', 'integration-other'))?.configVersion).toBe('1.0.0');
  });

  it('allows a null session title and the unsupported_question review source', async () => {
    expect(Object.values(ReviewSourceType)).toContain('unsupported_question');
    const session = await prisma.assistantSession.findFirst({ where: { customerId: 'customer-a' } });
    expect(session).not.toBeNull();
    expect(session!.title ?? null).toBeNull();
    const item = await prisma.reviewItem.create({ data: { customerId: 'customer-a', sourceType: 'unsupported_question',
      sourceId: 'feature013-persistence-check', summary: 'unsupported question' } });
    await prisma.reviewItem.delete({ where: { id: item.id } });
  });
});

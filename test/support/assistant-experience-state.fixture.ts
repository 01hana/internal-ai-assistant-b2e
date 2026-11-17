import { readFileSync } from 'node:fs';
import { experienceActiveSlot, experienceChecksum } from '../../src/assistant-experience/assistant-experience.repository';
import { parseAssistantExperiencePayload } from '../../src/assistant-experience/assistant-experience.parser';
import type { Us1TestState } from './us1-test-app.helper';

/**
 * Feature 013: seeds an active experience configuration into the US1 in-memory state.
 * Uses the default US1 Customer A reference pack (orders.status), so choices execute through the mock connector.
 */
export const REFERENCE_EXPERIENCE_CONFIG = 'test/fixtures/assistant-experience/customer-a-reference.v1.json';

export function seedActiveExperienceConfig(state: Us1TestState, path = REFERENCE_EXPERIENCE_CONFIG, override: Record<string, unknown> = {}) {
  const parsed = parseAssistantExperiencePayload({ ...JSON.parse(readFileSync(path, 'utf8')), ...override });
  if (!parsed.ok) throw new Error(`EXPERIENCE_FIXTURE_INVALID ${JSON.stringify(parsed.errors)}`);
  const payload = parsed.payload;
  for (const row of state.assistantExperienceConfigs) {
    if (row.customerId === payload.customerId && row.integrationId === payload.integrationId && row.status === 'active') {
      row.status = 'retired'; row.activeSlot = null;
    }
  }
  state.assistantExperienceConfigs.push({ id: `experience-config-${state.assistantExperienceConfigs.length + 1}`,
    customerId: payload.customerId, integrationId: payload.integrationId, configVersion: payload.configVersion,
    status: 'active', activeSlot: experienceActiveSlot(payload.customerId, payload.integrationId),
    payload: structuredClone(payload), checksum: experienceChecksum(payload),
    createdAt: new Date('2026-11-16T00:00:00.000Z'), activatedAt: new Date('2026-11-16T00:00:00.000Z') });
  return payload;
}

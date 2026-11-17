import { readFileSync } from 'node:fs';
import { parseAssistantExperiencePayload } from '../../../../src/assistant-experience/assistant-experience.parser';
import { AssistantExperienceValidator } from '../../../../src/assistant-experience/assistant-experience.validator';
import type { RegisteredToolDefinition } from '../../../../src/tools/tool-registry.types';
import { createFeature011DirectHarness } from '../../../../test/support/feature011-direct.fixture';

/**
 * Feature 013 T017: the Shinmone experience configuration targets the production Active Pack.
 * Its text was confirmed by the product owner on 2026-11-16 (docs/assistant-experience-review.md).
 */
const configPath = 'customers/shinmone/assistant-experience/1.0.0.json';
const packPath = 'customers/shinmone/capability-packs/shinmone-scm-kpistats/1.0.0.json';
const catalogPath = 'customers/shinmone/test/fixtures/shinmone-kpistats-demo-tool-catalog.json';

type CatalogTool = Omit<RegisteredToolDefinition, 'id' | 'key' | 'active' | 'requiredPermissionScopes'> & {
  isActive: boolean; requiredPermissions: string[]
};

async function productionHarness() {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as { tools: CatalogTool[] };
  // The catalog is stored staged-only (isActive=false); deploy/demo/provision creates these definitions with
  // isActive=true, so model the provisioned state the production pack is validated against.
  const additionalTools = Object.fromEntries(catalog.tools.map(({ isActive: _staged, requiredPermissions, ...tool }) => [tool.name, {
    customerId: 'customer-shinmone',
    tool: { ...tool, id: `fixture-${tool.name}`, key: tool.name, active: true, requiredPermissionScopes: requiredPermissions }
  }]));
  return createFeature011DirectHarness([packPath], { additionalTools });
}

describe('Shinmone assistant experience configuration', () => {
  const parsed = parseAssistantExperiencePayload(JSON.parse(readFileSync(configPath, 'utf8')));

  it('is structurally valid and human-verified for production provisioning', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.semanticReviewStatus).toBe('HUMAN_VERIFIED');
    expect(parsed.payload).toMatchObject({ customerId: 'customer-shinmone', integrationId: 'shinmone-scm-assistant', hostApps: ['shinmone-scm'] });
  });

  it('declares only capabilities and parameters that bind to the production Active Pack', async () => {
    if (!parsed.ok) throw new Error('config invalid');
    const harness = await productionHarness();
    expect(await new AssistantExperienceValidator(harness.registry, harness.binding).validate(parsed.payload)).toEqual([]);
  });

  it('offers a follow-up for every period except the one just answered', () => {
    if (!parsed.ok) throw new Error('config invalid');
    for (const period of ['today', 'this_week', 'this_month']) {
      const targets = parsed.payload.followUps.filter((item) => item.whenParameters?.timeRange === period)
        .map((item) => item.parameters?.timeRange);
      expect(targets.length).toBeGreaterThan(0);
      expect(targets).not.toContain(period);
    }
  });
});

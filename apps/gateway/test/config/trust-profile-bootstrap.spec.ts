import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const commandPath = resolve(__dirname, '../../src/commands/bootstrap-legacy-upstream-trust-profile.ts');

describe('Controlled legacy upstream trust-profile bootstrap (T037)', () => {
  it('creates a deterministic active initial profile from complete config and an explicit binding anchor', async () => {
    const harness = createCommand();
    await expect(harness.command.execute({ integrationId: ' integration-a ', requestId: ' bootstrap-a ' })).resolves.toEqual({ id: 'legacy-upstream-bootstrap:integration-a', integrationId: 'integration-a', changed: true });
    expect(harness.provision.execute).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', id: 'legacy-upstream-bootstrap:integration-a', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: undefined, requestId: 'bootstrap-a'
    }));
    expect(harness.provision.execute.mock.calls[0][0]).not.toHaveProperty('clockToleranceSeconds');
    expect(JSON.stringify(harness.provision.execute.mock.calls)).not.toMatch(/customerId|allowedHostApp/i);
  });

  it.each([undefined, '', '   '])('requires an explicit integration ID (%p) without inference', async (integrationId) => {
    const harness = createCommand();
    await expect(harness.command.execute({ integrationId, requestId: 'bootstrap-a' } as never)).rejects.toThrow('Legacy upstream trust-profile bootstrap cannot be completed.');
    expect(harness.profiles.findByIntegrationId).not.toHaveBeenCalled();
    expect(harness.provision.execute).not.toHaveBeenCalled();
  });

  it('fails closed for a missing binding or invalid legacy policy without persistence', async () => {
    const missingBinding = createCommand({ provisionError: new Error('missing binding') });
    await expect(missingBinding.command.execute({ integrationId: 'integration-missing', requestId: 'bootstrap-missing' })).rejects.toThrow('Legacy upstream trust-profile bootstrap cannot be completed.');
    expect(missingBinding.provision.execute).toHaveBeenCalledTimes(1);

    const unsafe = createCommand({ provisionError: new Error('unsafe JWKS') });
    await expect(unsafe.command.execute({ integrationId: 'integration-a', requestId: 'bootstrap-unsafe' })).rejects.toThrow('Legacy upstream trust-profile bootstrap cannot be completed.');
    expect(unsafe.provision.execute).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for an equivalent active profile and rejects a conflicting active profile', async () => {
    const exact = createCommand({ profiles: [profile()] });
    await expect(exact.command.execute({ integrationId: 'integration-a', requestId: 'bootstrap-replay' })).resolves.toEqual({ id: 'profile-existing', integrationId: 'integration-a', changed: false });
    expect(exact.provision.execute).not.toHaveBeenCalled();

    const conflict = createCommand({ profiles: [profile({ expectedAudience: 'other' })] });
    await expect(conflict.command.execute({ integrationId: 'integration-a', requestId: 'bootstrap-conflict' })).rejects.toThrow('Legacy upstream trust-profile bootstrap cannot be completed.');
    expect(conflict.provision.execute).not.toHaveBeenCalled();
  });

  it('permits shared IdP policy for another integration without modifying it', async () => {
    const other = profile({ id: 'profile-a', integrationId: 'integration-a' });
    const harness = createCommand({ profiles: [] });
    await expect(harness.command.execute({ integrationId: 'integration-b', requestId: 'bootstrap-b' })).resolves.toMatchObject({ integrationId: 'integration-b', changed: true });
    expect(harness.profiles.findByIntegrationId).toHaveBeenCalledWith('integration-b');
    expect(other).toEqual(profile({ id: 'profile-a', integrationId: 'integration-a' }));
  });

  it('is direct-only and excluded from startup, module, and runtime verifier composition', () => {
    expect(existsSync(commandPath)).toBe(true);
    const command = existsSync(commandPath) ? readFileSync(commandPath, 'utf8') : '';
    expect(command).not.toMatch(/@Controller|Controller\s*\(|MultiProfileUpstreamTokenVerifier|PrismaClient|CanonicalIdentityResolver/);
    for (const path of ['../../src/gateway.module.ts', '../../src/main.ts', '../../src/upstream-auth/multi-profile-upstream-token-verifier.ts']) {
      expect(readFileSync(resolve(__dirname, path), 'utf8')).not.toContain('bootstrap-legacy-upstream-trust-profile');
    }
  });
});

function createCommand(options: Partial<{ profiles: ReturnType<typeof profile>[]; provisionError: Error }> = {}) {
  if (!existsSync(commandPath)) throw new Error('Required Batch 5A bootstrap command is missing.');
  const target = require(commandPath) as { BootstrapLegacyUpstreamTrustProfileCommand?: new (dependencies: unknown) => { execute(input: unknown): Promise<unknown> } };
  if (!target.BootstrapLegacyUpstreamTrustProfileCommand) throw new Error('Required Batch 5A bootstrap command is missing.');
  const profiles = { findByIntegrationId: jest.fn(async () => options.profiles ?? []) };
  const provision = { execute: jest.fn(async (input: Record<string, unknown>) => { if (options.provisionError) throw options.provisionError; return { id: input.id, integrationId: input.integrationId, changed: true }; }) };
  const config = { bootstrapUpstreamVerification: { issuer: 'https://issuer.example.test', audience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks', clockToleranceSeconds: 30 } };
  return { command: new target.BootstrapLegacyUpstreamTrustProfileCommand({ config, profiles, provision }), profiles, provision };
}

function profile(overrides: Record<string, unknown> = {}) {
  return { id: 'profile-existing', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null, ...overrides };
}

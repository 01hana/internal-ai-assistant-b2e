import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const commandPath = resolve(__dirname, '../../src/commands/provision-trust-profile.ts');

describe('Controlled trust-profile provisioning contract (T008/T009)', () => {
  it('requires a direct-only command and no public HTTP surface', () => {
    expect(existsSync(commandPath)).toBe(true);
    const source = existsSync(commandPath) ? require('node:fs').readFileSync(commandPath, 'utf8') : '';
    expect(source).not.toMatch(/@Controller|Controller\s*\(/);
  });

  it('creates a valid profile, invalidates its future cache entry, and emits no secrets to audit', async () => {
    const { command, repository, audit, invalidation } = createCommand();
    await expect(command.execute(input())).resolves.toMatchObject({ id: 'profile-a', changed: true });
    expect(repository.create).toHaveBeenCalled();
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-a');
    expect(JSON.stringify(audit.append.mock.calls)).not.toMatch(/jwks\.json|token|secret|credential/i);
  });

  it('replays an identical create and rejects a conflicting create', async () => {
    const current = record();
    const replay = createCommand({ existing: current });
    await expect(replay.command.execute(input())).resolves.toMatchObject({ changed: false });
    expect(replay.repository.create).not.toHaveBeenCalled();

    const conflict = createCommand({ existing: { ...current, expectedAudience: 'other' } });
    await expect(conflict.command.execute(input())).rejects.toThrow('Trust profile provisioning cannot be completed.');
  });

  it('rejects failed activation or missing binding without persistence', async () => {
    const invalid = createCommand({ validationError: new Error('invalid') });
    await expect(invalid.command.execute(input())).rejects.toThrow();
    expect(invalid.repository.create).not.toHaveBeenCalled();
  });

  it('rejects an update that attempts to re-anchor an existing profile to another integration', async () => {
    const { command, repository } = createCommand({ existing: record({ integrationId: 'integration-a' }) });
    await expect(command.execute(input({ action: 'update', integrationId: 'integration-b' }))).rejects.toThrow('Trust profile provisioning cannot be completed.');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('persists disable and replacement metadata only as control-plane primitives', async () => {
    const disabled = createCommand({ existing: record() });
    await expect(disabled.command.execute({ ...input(), action: 'disable' })).resolves.toMatchObject({ enabled: false, changed: true });
    expect(disabled.repository.disable).toHaveBeenCalledWith('profile-a', expect.anything());

    const replacement = createCommand({ existing: null });
    await expect(replacement.command.execute({ ...input(), id: 'profile-b', version: 2, replacesProfileId: 'profile-a' })).resolves.toMatchObject({ id: 'profile-b' });
    expect(replacement.repository.create).toHaveBeenCalledWith(expect.objectContaining({ replacesProfileId: 'profile-a' }), expect.anything());
  });
});

function createCommand(options: Partial<{ existing: Record<string, unknown> | null; validationError: Error }> = {}) {
  if (!existsSync(commandPath)) throw new Error('Required Batch 1 production surface missing: ProvisionTrustProfileCommand.');
  const target = require(commandPath) as { ProvisionTrustProfileCommand?: new (dependencies: unknown) => { execute(input: unknown): Promise<unknown> } };
  if (!target.ProvisionTrustProfileCommand) throw new Error('Required Batch 1 production surface missing: ProvisionTrustProfileCommand.');
  const repository = {
    transaction: jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback({})),
    findById: jest.fn(async () => options.existing === undefined ? null : options.existing),
    create: jest.fn(async (data: Record<string, unknown>) => ({ ...record(), ...data })),
    update: jest.fn(async (_id: string, data: Record<string, unknown>) => ({ ...record(), ...data })),
    disable: jest.fn(async () => ({ ...record(), enabled: false, lifecycle: 'disabled' }))
  };
  const audit = { append: jest.fn(async () => undefined) };
  const invalidation = { invalidate: jest.fn(async () => undefined) };
  return { command: new target.ProvisionTrustProfileCommand({ repository, validator: { validate: jest.fn(async (value) => { if (options.validationError) throw options.validationError; return value; }) }, auditWriter: audit, invalidation }), repository, audit, invalidation };
}

function input(overrides: Record<string, unknown> = {}) {
  return { action: 'create', requestId: 'request-a', ...record(), ...overrides };
}

function record(overrides: Record<string, unknown> = {}) {
  return { id: 'profile-a', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null, ...overrides };
}

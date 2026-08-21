import { ProvisionManagedUpstreamSigningKeyCommand } from '../../src/commands/provision-managed-upstream-signing-key';
import { GatewaySigningAuthorityReader } from '../../src/managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { ManagedUpstreamSigningKeyRepository } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';

type Row = Record<string, unknown>;
const keyInput = (overrides: Row = {}) => ({ issuerId: 'issuer-a', kid: 'managed-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' }, ...overrides });

describe('Phase 2A managed signing-key command', () => {
  it('registers request metadata separately and owns initial lifecycle fields', async () => {
    const harness = createHarness();
    const result = await harness.command.registerKey({ ...keyInput(), requestId: 'request-a' });
    expect(result).toMatchObject({ status: 'new', enabled: false, lifecycle: 'draft', version: 1, replacesKeyId: null });
    expect(result).not.toHaveProperty('requestId');
  });

  it.each(['status', 'enabled', 'lifecycle', 'version', 'replacesKeyId'])('rejects caller-owned %s', async (field) => {
    await expect(createHarness().command.registerKey({ ...keyInput(), requestId: 'request-a', [field]: 'caller-controlled' })).rejects.toThrow();
  });

  it('allows only legal forward transitions and keeps disable/retire non-active', async () => {
    const harness = createHarness();
    const registered = await harness.command.registerKey({ ...keyInput(), requestId: 'register' });
    await expect(harness.command.transitionKey({ id: String(registered.id), to: 'active', requestId: 'skip' })).rejects.toThrow();
    await expect(harness.command.transitionKey({ id: String(registered.id), to: 'published', requestId: 'published' })).resolves.toMatchObject({ status: 'published', enabled: false, lifecycle: 'draft' });
    await expect(harness.command.transitionKey({ id: String(registered.id), to: 'active', requestId: 'active' })).resolves.toMatchObject({ status: 'active', enabled: true, lifecycle: 'active' });
    await expect(harness.command.disableKey({ id: String(registered.id), requestId: 'disable' })).resolves.toMatchObject({ status: 'retiring', enabled: false, lifecycle: 'disabled' });
    await expect(harness.command.transitionKey({ id: String(registered.id), to: 'retired', requestId: 'retired' })).resolves.toMatchObject({ status: 'retired', enabled: false, lifecycle: 'disabled' });
  });

  it.each([
    { kid: 'gateway-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' } },
    { kid: 'managed-kid', keyReference: 'gateway-ref', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' } },
    { kid: 'managed-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'gateway-n', e: 'AQAB' } }
  ])('rechecks Gateway collision on activation without changing persisted state', async (gatewayKey) => {
    const harness = createHarness();
    const registered = await harness.command.registerKey({ ...keyInput(), requestId: 'register' });
    await harness.command.transitionKey({ id: String(registered.id), to: 'published', requestId: 'published' });
    harness.gatewayKeys.splice(0, harness.gatewayKeys.length, gatewayKey);
    await expect(harness.command.transitionKey({ id: String(registered.id), to: 'active', requestId: 'active' })).rejects.toThrow();
    expect(harness.rows.get(String(registered.id))).toMatchObject({ status: 'published', enabled: false, lifecycle: 'draft' });
  });

  it('replaces an active predecessor with a server-owned active successor', async () => {
    const harness = createHarness();
    const predecessor = await activate(harness);
    const successor = await harness.command.replaceKey({ predecessorId: String(predecessor.id), requestId: 'replace', successor: keyInput({ kid: 'managed-kid-v2', keyReference: 'managed-ref-v2', publicJwk: { kty: 'RSA', n: 'managed-n-v2', e: 'AQAB' } }) });
    expect(harness.rows.get(String(predecessor.id))).toMatchObject({ status: 'retired', enabled: false, lifecycle: 'replaced' });
    expect(successor).toMatchObject({ status: 'active', enabled: true, lifecycle: 'active', version: 2, replacesKeyId: predecessor.id });
  });

  it('uses the active-key predicate only for enabled active status', async () => {
    let where: unknown;
    const repository = new ManagedUpstreamSigningKeyRepository({ managedUpstreamSigningKey: { findMany: async (input: { where: unknown }) => { where = input.where; return []; } } } as never);
    await repository.findEnabledActiveByIssuerId('issuer-a');
    expect(where).toEqual({ issuerId: 'issuer-a', enabled: true, lifecycle: 'active', status: 'active' });
  });
});

async function activate(harness: ReturnType<typeof createHarness>) {
  const registered = await harness.command.registerKey({ ...keyInput(), requestId: 'register' });
  await harness.command.transitionKey({ id: String(registered.id), to: 'published', requestId: 'published' });
  return harness.command.transitionKey({ id: String(registered.id), to: 'active', requestId: 'active' });
}

function createHarness() {
  const rows = new Map<string, Row>();
  const gatewayKeys: Row[] = [];
  let serial = 0;
  const repository = {
    transaction: async (callback: (transaction: object) => Promise<Row>) => callback({}),
    create: async (_kind: string, data: Row) => { const row = { id: `key-${++serial}`, ...data }; rows.set(String(row.id), row); return { ...row }; },
    findById: async (_kind: string, id: string) => rows.get(id) ?? null,
    transitionSigningKey: async (id: string, from: string, to: string) => {
      const row = rows.get(id);
      if (!row || row.status !== from || !legal(row, to)) throw new Error('illegal transition');
      if (to === 'published') Object.assign(row, { status: 'published' });
      if (to === 'active') Object.assign(row, { status: 'active', enabled: true, lifecycle: 'active' });
      if (to === 'retiring') Object.assign(row, { status: 'retiring', enabled: false, lifecycle: 'disabled' });
      if (to === 'retired') Object.assign(row, { status: 'retired' });
      return { ...row };
    },
    replaceSigningKey: async (predecessorId: string, successor: Row) => {
      const predecessor = rows.get(predecessorId);
      if (!predecessor || predecessor.status !== 'active') throw new Error('not active');
      Object.assign(predecessor, { status: 'retired', enabled: false, lifecycle: 'replaced' });
      const row = { id: `key-${++serial}`, ...successor, status: 'active', enabled: true, lifecycle: 'active', version: Number(predecessor.version) + 1, replacesKeyId: predecessor.id };
      rows.set(String(row.id), row); return { ...row };
    }
  };
  const reader = new GatewaySigningAuthorityReader({ config: { config: { internalIssuer: 'https://gateway.example.test' } } as never, signingKeys: { findAllForCollision: async () => gatewayKeys as never } });
  return { rows, gatewayKeys, command: new ProvisionManagedUpstreamSigningKeyCommand({ repository: repository as never, audit: { append: async () => undefined }, invalidation: { invalidate: async () => undefined }, gatewaySigningAuthority: reader }) };
}

function legal(row: Row, to: string): boolean {
  return (row.status === 'new' && row.enabled === false && row.lifecycle === 'draft' && to === 'published') ||
    (row.status === 'published' && row.enabled === false && row.lifecycle === 'draft' && to === 'active') ||
    (row.status === 'active' && row.enabled === true && row.lifecycle === 'active' && to === 'retiring') ||
    (row.status === 'retiring' && row.enabled === false && row.lifecycle === 'disabled' && to === 'retired');
}

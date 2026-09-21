import { executionScopedCredentialMaterial } from '../../src/credentials/credential.types';
import {
  parseConnectorBindingBootstrapRequestV1,
  type ConnectorBindingTrustedContextV1
} from '@internal-ai-assistant/connector-runtime-contract';
import {
  SHINMONE_BOOTSTRAP_PROVIDER_KEY,
  SHINMONE_BOOTSTRAP_PROFILE_KEY,
  SHINMONE_CREDENTIAL_PROFILE_REF,
  ShinmoneBearerApplicationStrategy,
  ShinmoneIdxCredentialProvider,
  createShinmoneRuntimeIntegration
} from '../../integrations/shinmone';

describe('removable Shinmone IDX bootstrap and credential provider', () => {
  const now = 1_800_000_000;
  const context: ConnectorBindingTrustedContextV1 = Object.freeze({
    customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
    connectorInstanceId: 'shinmone-scm-connector-1', organizationId: 'org-shared', actorId: 'actor-shared'
  });

  it('retains the exact admitted token and Entry behind a provider-owned handle and returns its native exp cap', async () => {
    const provider = new ShinmoneIdxCredentialProvider({ nowSeconds: () => now, randomBytes: () => Buffer.alloc(32, 0x51) });
    const token = nativeJwt({ exp: now + 90 });
    const parsed = provider.contract.parseProviderPayload({
      nativeAccessToken: token, acceptedSubject: 'actor-shared',
      acceptedOrganization: 'org-shared', acceptedEntry: 'entry-shared'
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const created = await provider.create(parsed.value as never, context);
    expect(created).toMatchObject({
      credentialProviderKey: SHINMONE_BOOTSTRAP_PROVIDER_KEY,
      providerExpiresAt: now + 90,
      providerMetadata: {}
    });
    expect(created.opaqueCredentialHandle).not.toContain(token);
    const records = (provider as unknown as { records: Map<string, { nativeAccessToken: string; acceptedEntry: string }> }).records;
    expect(records.get(created.opaqueCredentialHandle)).toMatchObject({ nativeAccessToken: token, acceptedEntry: 'entry-shared' });

    const material = await provider.resolve(created.opaqueCredentialHandle, context, created.credentialGeneration);
    expect(JSON.stringify(material)).toContain(token);
    expect(JSON.stringify(material)).not.toContain('entry-shared');
    await provider.revoke(created.opaqueCredentialHandle, 'provider_rejected');
    await expect(provider.resolve(created.opaqueCredentialHandle, context, created.credentialGeneration)).rejects.toThrow('credential unavailable');
  });

  it.each([1_024, 1_025, 4_096, 8_192, 12_000])(
    'admits a %i-character native token through the wire parser and real provider contract',
    (length) => {
      const provider = new ShinmoneIdxCredentialProvider();
      const parsed = parseConnectorBindingBootstrapRequestV1(bindingRequest('x'.repeat(length)), provider.contract);
      expect(parsed.ok).toBe(true);
    }
  );

  it('rejects an over-limit token and additional provider fields through the wire parser', () => {
    const provider = new ShinmoneIdxCredentialProvider();
    expect(parseConnectorBindingBootstrapRequestV1(bindingRequest('x'.repeat(12_001)), provider.contract).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(bindingRequest('token', { unexpected: 'value' }), provider.contract).ok).toBe(false);
  });

  it('rejects payload/context mismatch and omits a cap when the accepted token has no numeric exp', async () => {
    const provider = new ShinmoneIdxCredentialProvider({ nowSeconds: () => now });
    for (const payload of [
      { nativeAccessToken: 'opaque-native-token', acceptedSubject: 'other', acceptedOrganization: 'org-shared', acceptedEntry: 'entry' },
      { nativeAccessToken: 'opaque-native-token', acceptedSubject: 'actor-shared', acceptedOrganization: 'other', acceptedEntry: 'entry' }
    ]) {
      const parsed = provider.contract.parseProviderPayload(payload);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) await expect(provider.create(parsed.value as never, context)).rejects.toThrow('context mismatch');
    }
    const parsed = provider.contract.parseProviderPayload({
      nativeAccessToken: 'opaque-native-token', acceptedSubject: 'actor-shared',
      acceptedOrganization: 'org-shared', acceptedEntry: 'entry'
    });
    if (!parsed.ok) throw new Error('fixture');
    await expect(provider.create(parsed.value as never, context)).resolves.toEqual(expect.not.objectContaining({ providerExpiresAt: expect.anything() }));
  });

  it('removes expired, replaced, rejected, and shutdown-owned handles without exposing Entry', async () => {
    let current = now;
    let handleByte = 0x31;
    const provider = new ShinmoneIdxCredentialProvider({
      nowSeconds: () => current,
      randomBytes: () => Buffer.alloc(32, handleByte++),
      randomGeneration: () => `generation-${handleByte}`
    });
    const make = async (entry: string, exp = now + 90) => {
      const parsed = provider.contract.parseProviderPayload({
        nativeAccessToken: nativeJwt({ exp }), acceptedSubject: 'actor-shared',
        acceptedOrganization: 'org-shared', acceptedEntry: entry
      });
      if (!parsed.ok) throw new Error('fixture');
      return provider.create(parsed.value as never, context);
    };
    const first = await make('entry-first');
    const replacement = await make('entry-replacement');
    await provider.revoke(first.opaqueCredentialHandle, 'generation_replaced');
    await expect(provider.resolve(first.opaqueCredentialHandle, context, first.credentialGeneration)).rejects.toThrow('credential unavailable');
    expect(JSON.stringify(await provider.resolve(replacement.opaqueCredentialHandle, context, replacement.credentialGeneration))).not.toContain('entry-replacement');

    const rejected = await make('entry-rejected');
    await provider.revoke(rejected.opaqueCredentialHandle, 'provider_rejected');
    await expect(provider.resolve(rejected.opaqueCredentialHandle, context, rejected.credentialGeneration)).rejects.toThrow('credential unavailable');

    const expiring = await make('entry-expired', now + 1);
    current = now + 1;
    await expect(provider.resolve(expiring.opaqueCredentialHandle, context, expiring.credentialGeneration)).rejects.toThrow('credential unavailable');
    const records = (provider as unknown as { records: Map<string, unknown> }).records;
    expect(records.has(expiring.opaqueCredentialHandle)).toBe(false);

    const shutdown = await make('entry-shutdown', now + 120);
    await provider.onModuleDestroy();
    expect(records.size).toBe(0);
    await expect(provider.resolve(shutdown.opaqueCredentialHandle, context, shutdown.credentialGeneration)).rejects.toThrow('credential unavailable');
  });

  it('uses one fixed bearer application strategy and exports a complete removable registration', () => {
    const strategy = new ShinmoneBearerApplicationStrategy();
    const applied = strategy.apply(
      executionScopedCredentialMaterial({ nativeAccessToken: 'native-token-sentinel' }),
      Object.freeze({ profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: Object.freeze([{ name: 'TimeRange', value: 'thisMonth' }]) }) as never
    );
    expect(applied).toEqual({
      request: { profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: 'thisMonth' }] },
      Authorization: 'Bearer native-token-sentinel'
    });
    expect(Object.keys(applied).sort()).toEqual(['Authorization', 'request']);

    const registration = createShinmoneRuntimeIntegration({ nowSeconds: () => now });
    expect(registration).toMatchObject({
      bootstrapProviders: [expect.objectContaining({ bootstrapProviderKey: SHINMONE_BOOTSTRAP_PROVIDER_KEY, serviceProfileKey: SHINMONE_BOOTSTRAP_PROFILE_KEY })],
      credentialProfiles: [{ credentialProfileRef: SHINMONE_CREDENTIAL_PROFILE_REF, credentialProviderKey: SHINMONE_BOOTSTRAP_PROVIDER_KEY }]
    });
  });
});

function nativeJwt(payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture-signature`;
}

function bindingRequest(nativeAccessToken: string, additions: object = {}): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    version: '1',
    requestId: '76439084-9a9e-4981-9cd7-2e71e822fe28',
    bootstrapProfileKey: SHINMONE_BOOTSTRAP_PROFILE_KEY,
    trustedContext: {
      customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
      connectorInstanceId: 'shinmone-scm-connector-1', organizationId: 'org-shared', actorId: 'actor-shared'
    },
    providerPayload: {
      nativeAccessToken, acceptedSubject: 'actor-shared',
      acceptedOrganization: 'org-shared', acceptedEntry: 'entry-shared', ...additions
    }
  }));
}

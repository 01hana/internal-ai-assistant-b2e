import { ConnectorBindingRequestService } from '../../src/bindings/connector-binding-request.service';
import { ConnectorBindingService } from '../../src/bindings/connector-binding.service';
import { InMemoryConnectorBindingStore } from '../../src/bindings/in-memory-connector-binding.store';
import { opaqueCredentialHandle } from '../../src/bindings/binding-bootstrap-provider';

describe('binding request processing order and authority boundary', () => {
  it('orders authentication before closed parsing, provider creation, and binding mint', async () => {
    const calls: string[] = [];
    const authenticator = {
      authenticateRegisteredBootstrap: jest.fn(async () => {
        calls.push('authenticate');
        return { ok: true, value: { proof: proof() } };
      })
    };
    const provider = {
      bootstrapProviderKey: 'provider-a', serviceProfileKey: 'profile-a',
      contract: {
        profileKey: 'profile-a', maxProviderPayloadBytes: 128,
        parseProviderPayload: jest.fn((value: unknown) => {
          calls.push('parse');
          return value && typeof value === 'object'
            ? { ok: true, value: Object.freeze({ code: 'validated' }) }
            : { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
        })
      },
      create: jest.fn(async () => {
        calls.push('provider');
        return {
          credentialProviderKey: 'credentials-a', opaqueCredentialHandle: 'opaque-handle-a',
          credentialGeneration: 'generation-a', providerMetadata: {}
        };
      }),
      revoke: jest.fn()
    };
    const providers = { resolve: jest.fn(() => provider) };
    const bindings = {
      mint: jest.fn(async () => {
        calls.push('mint');
        return { ok: true, value: { connectorContextRef: 'ccr_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', expiresAt: 1_800_000_060, expiresIn: 60, bindingGeneration: 1 } };
      }),
      revoke: jest.fn()
    };
    const service = new ConnectorBindingRequestService(authenticator as never, providers as never, bindings as never);
    const rawBody = Buffer.from(JSON.stringify({
      version: '1', requestId: proof().requestId, bootstrapProfileKey: 'profile-a',
      trustedContext: proofContext(), providerPayload: { code: 'sensitive' }
    }));

    await expect(service.handle({
      method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', rawBody
    })).resolves.toMatchObject({ statusCode: 200, body: { connectorContextRef: expect.stringMatching(/^ccr_/) } });
    expect(calls).toEqual(['authenticate', 'parse', 'provider', 'mint']);
    expect(provider.revoke).not.toHaveBeenCalled();
    expect(bindings.revoke).not.toHaveBeenCalled();
  });

  it('never parses or invokes providers when registered-bootstrap authentication fails', async () => {
    const authenticator = { authenticateRegisteredBootstrap: jest.fn(async () => ({ ok: false, code: 'CONNECTOR_AUTH_FAILED' })) };
    const providers = { resolve: jest.fn() };
    const bindings = { mint: jest.fn(), revoke: jest.fn() };
    const service = new ConnectorBindingRequestService(authenticator as never, providers as never, bindings as never);

    await expect(service.handle({
      method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', rawBody: Buffer.from('{}')
    })).resolves.toEqual({ statusCode: 401, body: failure('rejected-request', 'CONNECTOR_AUTH_FAILED') });
    expect(providers.resolve).not.toHaveBeenCalled();
    expect(bindings.mint).not.toHaveBeenCalled();
  });

  it('rejects signed actor or organization disagreement with the raw request before provider creation or mint', async () => {
    const provider = providerFixture();
    const bindings = { mint: jest.fn(), revoke: jest.fn() };
    const authenticated = {
      ...proof(),
      trustedContext: { ...proofContext(), actorId: 'actor-a', organizationId: 'organization-a' }
    };
    const service = new ConnectorBindingRequestService(
      { authenticateRegisteredBootstrap: jest.fn(async () => ({ ok: true, value: { proof: authenticated } })) } as never,
      { resolve: jest.fn(() => provider) } as never,
      bindings as never
    );
    const rawBody = Buffer.from(JSON.stringify({
      version: '1', requestId: authenticated.requestId, bootstrapProfileKey: 'profile-a',
      trustedContext: { ...authenticated.trustedContext, actorId: 'actor-b' }, providerPayload: { code: 'sensitive' }
    }));

    await expect(service.handle({
      method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', rawBody
    })).resolves.toEqual({ statusCode: 403, body: failure(authenticated.requestId, 'CONNECTOR_BINDING_INVALID') });
    expect(provider.create).not.toHaveBeenCalled();
    expect(bindings.mint).not.toHaveBeenCalled();
  });

  it('passes the authenticated admitted context to the selected provider and minted binding', async () => {
    const provider = providerFixture();
    const dynamicContext = { ...proofContext(), actorId: 'actor-b', organizationId: 'organization-b' };
    const authenticated = { ...proof(), trustedContext: dynamicContext };
    const mint = jest.fn(async () => ({
      ok: true,
      value: {
        connectorContextRef: 'ccr_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG', expiresAt: 1_800_000_060,
        expiresIn: 60, bindingGeneration: 1
      }
    }));
    const service = new ConnectorBindingRequestService(
      { authenticateRegisteredBootstrap: jest.fn(async () => ({ ok: true, value: { proof: authenticated } })) } as never,
      { resolve: jest.fn(() => provider) } as never,
      { mint, revoke: jest.fn() } as never
    );
    const rawBody = Buffer.from(JSON.stringify({
      version: '1', requestId: authenticated.requestId, bootstrapProfileKey: 'profile-a',
      trustedContext: dynamicContext, providerPayload: { code: 'sensitive' }
    }));

    await expect(service.handle({
      method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', rawBody
    })).resolves.toMatchObject({ statusCode: 200 });
    expect(provider.create).toHaveBeenCalledWith(expect.anything(), dynamicContext);
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ trustedContext: dynamicContext }));
  });

  it('tears down a newly created provider handle when binding mint fails and returns only a safe failure', async () => {
    const provider = providerFixture();
    const service = new ConnectorBindingRequestService(
      acceptedAuthenticator() as never,
      { resolve: jest.fn(() => provider) } as never,
      {
        mint: jest.fn(async () => ({ ok: false, code: 'CONNECTOR_UNAVAILABLE' })),
        revoke: jest.fn()
      } as never
    );

    const result = await service.handle(validInput());

    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.revoke).toHaveBeenCalledTimes(1);
    expect(provider.revoke).toHaveBeenCalledWith('opaque-handle-new', 'mint_failed');
    expect(result).toEqual({ statusCode: 503, body: failure(proof().requestId, 'CONNECTOR_UNAVAILABLE') });
    expect(JSON.stringify(result)).not.toMatch(/opaque-handle-new|metadata-secret|credential-material/i);
  });

  it('tears down a newly created provider handle when binding mint rejects unexpectedly', async () => {
    const provider = providerFixture();
    const service = new ConnectorBindingRequestService(
      acceptedAuthenticator() as never,
      { resolve: jest.fn(() => provider) } as never,
      {
        mint: jest.fn(async () => { throw new Error('mint-exception-sentinel'); }),
        revoke: jest.fn()
      } as never
    );

    const result = await service.handle(validInput());

    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.revoke).toHaveBeenCalledTimes(1);
    expect(provider.revoke).toHaveBeenCalledWith('opaque-handle-new', 'mint_failed');
    expect(result).toEqual({ statusCode: 503, body: failure(proof().requestId, 'CONNECTOR_UNAVAILABLE') });
    expect(JSON.stringify(result)).not.toMatch(/opaque-handle-new|metadata-secret|credential|mint-exception-sentinel/i);
  });

  it('returns the same safe failure when pre-transfer provider cleanup itself rejects', async () => {
    const provider = providerFixture();
    provider.revoke.mockRejectedValueOnce(new Error('cleanup-exception-sentinel'));
    const service = new ConnectorBindingRequestService(
      acceptedAuthenticator() as never,
      { resolve: jest.fn(() => provider) } as never,
      {
        mint: jest.fn(async () => { throw new Error('mint-exception-sentinel'); }),
        revoke: jest.fn()
      } as never
    );

    const result = await service.handle(validInput());

    expect(provider.revoke).toHaveBeenCalledTimes(1);
    expect(provider.revoke).toHaveBeenCalledWith('opaque-handle-new', 'mint_failed');
    expect(result).toEqual({ statusCode: 503, body: failure(proof().requestId, 'CONNECTOR_UNAVAILABLE') });
    expect(JSON.stringify(result)).not.toMatch(/opaque-handle-new|metadata-secret|credential|mint-exception-sentinel|cleanup-exception-sentinel/i);
  });

  it('propagates a provider expiry cap through request orchestration without interpreting its source', async () => {
    const now = 1_800_000_000;
    const fixture = compositionFixture(now + 75, now);

    await expect(fixture.service.handle(validInput())).resolves.toMatchObject({
      statusCode: 200,
      body: { version: '1', requestId: proof().requestId, expiresIn: 60, connectorContextRef: expect.stringMatching(/^ccr_/) }
    });
    expect(fixture.provider.create).toHaveBeenCalledTimes(1);
    expect(fixture.provider.revoke).not.toHaveBeenCalled();
  });

  it('fails closed and tears down the provider handle when its expiry cap leaves less than 15 useful seconds', async () => {
    const now = 1_800_000_000;
    const fixture = compositionFixture(now + 29, now);
    const result = await fixture.service.handle(validInput());

    expect(result).toEqual({ statusCode: 503, body: failure(proof().requestId, 'CONNECTOR_UNAVAILABLE') });
    expect(fixture.provider.create).toHaveBeenCalledTimes(1);
    expect(fixture.provider.revoke).toHaveBeenCalledTimes(1);
    expect(fixture.provider.revoke).toHaveBeenCalledWith('opaque-handle-new', 'mint_failed');
    expect(JSON.stringify(result)).not.toMatch(/opaque-handle-new|metadata-secret/i);
  });
});

function compositionFixture(providerExpiresAt: number, now: number) {
  let fill = 0x60;
  const provider = providerFixture(providerExpiresAt);
  const bindings = new ConnectorBindingService(new InMemoryConnectorBindingStore(
    { maxEntries: 4_096, scopeMaxEntries: 64, sweepBatchSize: 128 },
    { nowSeconds: () => now, randomBytes: (size) => Buffer.alloc(size, ++fill) }
  ));
  return {
    provider,
    service: new ConnectorBindingRequestService(
      acceptedAuthenticator() as never,
      { resolve: jest.fn(() => provider) } as never,
      bindings
    )
  };
}

function acceptedAuthenticator() {
  return { authenticateRegisteredBootstrap: jest.fn(async () => ({ ok: true, value: { proof: proof() } })) };
}

function providerFixture(providerExpiresAt?: number) {
  return {
    bootstrapProviderKey: 'provider-a', serviceProfileKey: 'profile-a',
    contract: {
      profileKey: 'profile-a', maxProviderPayloadBytes: 128,
      parseProviderPayload: jest.fn(() => ({ ok: true, value: Object.freeze({ code: 'validated' }) }))
    },
    create: jest.fn(async () => ({
      credentialProviderKey: 'credentials-a', opaqueCredentialHandle: opaqueCredentialHandle('opaque-handle-new')!,
      credentialGeneration: 'generation-a', providerExpiresAt, providerMetadata: { fixture: 'metadata-secret' }
    })),
    revoke: jest.fn(async () => undefined)
  };
}

function validInput() {
  return {
    method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c',
    rawBody: Buffer.from(JSON.stringify({
      version: '1', requestId: proof().requestId, bootstrapProfileKey: 'profile-a',
      trustedContext: proofContext(), providerPayload: { code: 'sensitive' }
    }))
  };
}

function proof() {
  return {
    kind: 'binding-bootstrap', profileKey: 'profile-a', requestId: '5a8271fb-1127-421c-83eb-3dc6b512db50',
    claims: { provider_key: 'provider-a' }, providerKey: 'provider-a', trustedContext: proofContext()
  };
}

function proofContext() {
  return { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a', connectorInstanceId: 'connector-a' };
}

function failure(requestId: string, code: string) {
  return { version: '1', requestId, status: 'failed', error: { code } };
}

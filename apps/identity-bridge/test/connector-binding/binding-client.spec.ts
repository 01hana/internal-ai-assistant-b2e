import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, request as nativeHttpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { ConnectorBindingClient } from '../../src/connector-binding/connector-binding.client';
import { ConnectorBindingServiceAuthSigner } from '../../src/connector-binding/connector-binding-service-auth.signer';
import { createCustomerConnectorRuntimeApplication } from '../../../customer-connector-runtime/src/main';
import { opaqueCredentialHandle, type BindingBootstrapProvider } from '../../../customer-connector-runtime/src/bindings/binding-bootstrap-provider';
import { ConnectorBindingService } from '../../../customer-connector-runtime/src/bindings/connector-binding.service';
import { validRuntimeEnvironment } from '../../../customer-connector-runtime/test/fixtures/runtime-environment';
import { bindingEnvironment } from './binding-fixtures';

describe('HTTPS-only ConnectorBindingClient', () => {
  it('sends one exact signed request through the real Phase 4 route and accepts only the bounded reference response', async () => {
    const baseEnvironment = bindingEnvironment();
    const fixture = await startRuntime(baseEnvironment);
    const environment = {
      ...baseEnvironment,
      BRIDGE_CONNECTOR_BINDING_URI: `https://phase6-upstream.test:${fixture.port}/v1/internal/connector-bindings`
    };
    const config = new BridgeConfigService(environment);
    const signed = await new ConnectorBindingServiceAuthSigner(config).prepare({
      requestId: randomUUID(), nativeAccessToken: 'native-access-token-sentinel',
      acceptedIdentity: { subject: 'user-a', organization: 'company-a', entry: 'configured-entry' }
    });
    if (!signed.ok) throw new Error('Expected signed binding request.');
    const certificate = readFileSync('../customer-connector-runtime/test/fixtures/phase6-upstream.crt');
    const requests: Array<Record<string, unknown>> = [];
    const client = new ConnectorBindingClient(config, {
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => {
        requests.push(options as Record<string, unknown>);
        return nativeHttpsRequest({ ...options, ca: certificate }, callback);
      }
    });
    try {
      const result = await client.exchange(signed.value);
      expect(result).toEqual({ ok: true, value: {
        version: '1', requestId: signed.value.requestId,
        connectorContextRef: expect.stringMatching(/^ccr_[A-Za-z0-9_-]{43}$/), expiresIn: 60
      } });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        protocol: 'https:', method: 'POST', hostname: 'phase6-upstream.test', port: fixture.port,
        path: '/v1/internal/connector-bindings', rejectUnauthorized: true, servername: 'phase6-upstream.test', agent: false,
        headers: expect.objectContaining({
          accept: 'application/json', 'accept-encoding': 'identity', 'content-type': 'application/json',
          'content-length': signed.value.bytes.length, 'x-request-id': signed.value.requestId,
          authorization: expect.stringMatching(/^Bearer /)
        })
      });
      expect((requests[0]!.headers as Record<string, unknown>)['content-encoding']).toBeUndefined();
      expect(String((requests[0]!.headers as Record<string, unknown>).authorization)).not.toContain('native-access-token-sentinel');
      expect(signed.value.bytes.toString('utf8').split('native-access-token-sentinel')).toHaveLength(2);
      expect(fixture.provider.create).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it('rejects an oversized request before DNS or HTTPS', async () => {
    const config = new BridgeConfigService(bindingEnvironment());
    const resolver = jest.fn();
    const requestFactory = jest.fn();
    const client = new ConnectorBindingClient(config, { resolver, requestFactory: requestFactory as never });
    await expect(client.exchange({ bytes: Buffer.alloc(16_385), proof: 'proof', requestId: randomUUID() }))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
    expect(resolver).not.toHaveBeenCalled();
    expect(requestFactory).not.toHaveBeenCalled();
  });

  it('mints distinct actor-bound references for two admitted users through one real deployment and denies cross-actor use', async () => {
    const baseEnvironment = bindingEnvironment();
    const fixture = await startRuntime(baseEnvironment);
    const config = new BridgeConfigService({
      ...baseEnvironment,
      BRIDGE_CONNECTOR_BINDING_URI: `https://phase6-upstream.test:${fixture.port}/v1/internal/connector-bindings`
    });
    const signer = new ConnectorBindingServiceAuthSigner(config);
    const certificate = readFileSync('../customer-connector-runtime/test/fixtures/phase6-upstream.crt');
    const client = new ConnectorBindingClient(config, {
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => nativeHttpsRequest({ ...options, ca: certificate }, callback)
    });
    const identities = [
      { subject: 'user-a', organization: 'company-a', entry: 'entry-a' },
      { subject: 'user-b', organization: 'company-a', entry: 'entry-b' }
    ] as const;
    try {
      const results = [];
      for (const acceptedIdentity of identities) {
        const signed = await signer.prepare({
          requestId: randomUUID(), nativeAccessToken: `native-${acceptedIdentity.subject}`, acceptedIdentity
        });
        if (!signed.ok) throw new Error('Expected signed binding request.');
        results.push(await client.exchange(signed.value));
      }
      expect(results).toEqual([
        { ok: true, value: { version: '1', requestId: expect.any(String), connectorContextRef: expect.stringMatching(/^ccr_/), expiresIn: 60 } },
        { ok: true, value: { version: '1', requestId: expect.any(String), connectorContextRef: expect.stringMatching(/^ccr_/), expiresIn: 60 } }
      ]);
      if (!results[0]!.ok || !results[1]!.ok || 'status' in results[0]!.value || 'status' in results[1]!.value) {
        throw new Error('Expected two successful binding responses.');
      }
      expect(results[0].value.connectorContextRef).not.toBe(results[1].value.connectorContextRef);
      expect(fixture.provider.create).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ actorId: 'user-a' }));
      expect(fixture.provider.create).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({ actorId: 'user-b' }));
      await expect(fixture.bindings.withInvocationLease(results[0].value.connectorContextRef, {
        trustedContext: {
          customerId: 'reference-customer', integrationId: 'configured-integration', hostApp: 'configured-host-app',
          connectorInstanceId: 'reference-connector-1', organizationId: 'company-a', actorId: 'user-b'
        }
      }, async () => 'unexpected')).resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ['wrong hostname', 'wrong-runtime.test', true],
    ['untrusted certificate', 'phase6-upstream.test', false]
  ])('fails closed for %s without weakening TLS verification', async (_name, hostname, trustCertificate) => {
    const environment = bindingEnvironment();
    const fixture = await startRuntime(environment);
    const config = new BridgeConfigService({
      ...environment,
      BRIDGE_CONNECTOR_BINDING_URI: `https://${hostname}:${fixture.port}/v1/internal/connector-bindings`
    });
    const signed = await new ConnectorBindingServiceAuthSigner(config).prepare({
      requestId: randomUUID(), nativeAccessToken: 'native-access-token-sentinel',
      acceptedIdentity: { subject: 'user-a', organization: 'company-a', entry: 'configured-entry' }
    });
    if (!signed.ok) throw new Error('Expected signed binding request.');
    const certificate = readFileSync('../customer-connector-runtime/test/fixtures/phase6-upstream.crt');
    const client = new ConnectorBindingClient(config, {
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => nativeHttpsRequest(
        { ...options, ...(trustCertificate ? { ca: certificate } : {}) }, callback
      )
    });
    try {
      await expect(client.exchange(signed.value)).resolves.toEqual({ ok: false, code: 'CONNECTOR_UPSTREAM_FAILED' });
    } finally {
      await fixture.close();
    }
  });

  it('uses one fixed 2,000 ms lifecycle timer and destroys the pending request', async () => {
    let timeout: (() => void) | undefined;
    const setTimer = jest.fn((callback: () => void, milliseconds: number) => {
      timeout = callback;
      return {} as NodeJS.Timeout;
    });
    const clearTimer = jest.fn();
    let markCreated: (() => void) | undefined;
    const created = new Promise<void>((resolve) => { markCreated = resolve; });
    const outgoing = Object.assign(new EventEmitter(), { end: jest.fn(), destroy: jest.fn() });
    const requestFactory = jest.fn(() => { markCreated?.(); return outgoing; });
    const client = new ConnectorBindingClient(new BridgeConfigService(bindingEnvironment()), {
      resolver: async () => [{ address: '8.8.8.8', family: 4 }], requestFactory: requestFactory as never,
      setTimer, clearTimer
    });
    const pending = client.exchange(signedFixture());
    await created;
    timeout?.();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 2_000);
    expect(requestFactory).toHaveBeenCalledTimes(1);
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    expect(clearTimer).toHaveBeenCalledTimes(1);
  });
});

function signedFixture() {
  return { bytes: Buffer.from('{"version":"1"}'), proof: 'signed-service-proof', requestId: randomUUID() };
}

async function startRuntime(bridgeEnvironment: Record<string, unknown>) {
  const bridgeConfig = new BridgeConfigService(bridgeEnvironment).configuration.connectorBinding!;
  const profile = {
    kind: 'binding-bootstrap', profileKey: bridgeConfig.serviceAuth.profileKey, typ: bridgeConfig.serviceAuth.typ,
    issuer: bridgeConfig.serviceAuth.issuer, subject: bridgeConfig.serviceAuth.subject, audience: bridgeConfig.serviceAuth.audience,
    keyDomain: bridgeConfig.serviceAuth.keyDomain, trustedContext: {
      customerId: bridgeConfig.context.customerId, integrationId: bridgeConfig.context.integrationId,
      hostApp: bridgeConfig.context.hostApp, connectorInstanceId: bridgeConfig.context.connectorInstanceId,
      ...(bridgeConfig.context.organizationId === undefined ? {} : { organizationId: bridgeConfig.context.organizationId }),
      ...(bridgeConfig.context.actorId === undefined ? {} : { actorId: bridgeConfig.context.actorId })
    },
    keys: bridgeConfig.serviceAuth.keys.map((key) => ({ kid: key.kid, status: key.status, publicJwk: key.publicJwk })),
    providerKey: bridgeConfig.context.providerKey
  };
  const environment = validRuntimeEnvironment();
  const originalContexts = JSON.parse(String(environment.CONNECTOR_RUNTIME_CONTEXT_JSON)) as object[];
  environment.CONNECTOR_RUNTIME_CONTEXT_JSON = JSON.stringify([
    profile.trustedContext,
    ...originalContexts.filter((context) => (context as { customerId?: string }).customerId === 'customer-b')
  ]);
  environment.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON = JSON.stringify([profile]);
  const provider: BindingBootstrapProvider = {
    bootstrapProviderKey: profile.providerKey,
    serviceProfileKey: profile.profileKey,
    contract: {
      profileKey: profile.profileKey,
      maxProviderPayloadBytes: 12_500,
      parseProviderPayload: (value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).sort().join(',') !== 'acceptedEntry,acceptedOrganization,acceptedSubject,nativeAccessToken') {
          return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' } as const;
        }
        return { ok: true, value: Object.freeze({ ...(value as object) }) } as const;
      }
    },
    create: jest.fn(async () => ({
      credentialProviderKey: 'shinmone-idx-bearer-v1', opaqueCredentialHandle: opaqueCredentialHandle('phase8-handle')!,
      credentialGeneration: 'credential-generation-1', providerMetadata: Object.freeze({ fixture: 'phase8' })
    })),
    revoke: jest.fn(async () => undefined)
  };
  const app = await createCustomerConnectorRuntimeApplication(environment, [provider]);
  await app.init();
  const bindings = app.get(ConnectorBindingService);
  const server = createServer({
    cert: readFileSync('../customer-connector-runtime/test/fixtures/phase6-upstream.crt'),
    key: readFileSync('../customer-connector-runtime/test/fixtures/phase6-upstream.key')
  }, app.getHttpAdapter().getInstance());
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return {
    port: (server.address() as AddressInfo).port,
    provider,
    bindings,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await app.close();
    }
  };
}

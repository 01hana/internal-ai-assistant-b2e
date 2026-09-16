import request from 'supertest';
import { createCustomerConnectorRuntimeApplication } from '../../src/main';
import { validRuntimeEnvironment } from '../fixtures/runtime-environment';
import { parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { ConnectorInvocationService } from '../../src/invocation/connector-invocation.service';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { customerBOperation, parsedManifest } from '../fixtures/phase5-manifests';
import { CredentialProfileRegistry } from '../../src/credentials/credential-profile.registry';
import { CredentialExecutionBoundary, type CredentialExecutionResult } from '../../src/credentials/credential-execution.boundary';
import type { ProtectedBindingView } from '../../src/bindings/binding.types';
import type { PreparedManifestOperation } from '../../src/manifest/operation-manifest.registry';
import type { AppliedCredentialRequest } from '../../src/credentials/credential.types';
import { binding, credentialFixtures, profileConfigurations } from '../fixtures/phase5-credentials';

describe('Phase 6 central-only invocation route', () => {
  it('is active, POST-only, and rejects an invalid proof without exposing request data', async () => {
    const app = await createCustomerConnectorRuntimeApplication(validRuntimeEnvironment());
    await app.init();
    try {
      const result = await request(app.getHttpServer()).post('/v1/connector/invocations')
        .set('Content-Type', 'application/json').set('Authorization', 'Bearer sentinel').set('X-Request-Id', 'request-invalid-proof')
        .send({ connectorContextRef: 'ccr_secret', credential: 'credential-sentinel' }).expect(401);
      expect(result.body).toEqual({ version: '1', requestId: 'rejected-request', status: 'failed', error: { code: 'CONNECTOR_AUTH_FAILED' } });
      expect(JSON.stringify(result.body)).not.toMatch(/ccr_secret|credential-sentinel/);
      await request(app.getHttpServer()).get('/v1/connector/invocations').expect(404);
    } finally { await app.close(); }
  });

  it('composes the bounded business path in authority order and releases only the envelope', async () => {
    const events: string[] = [];
    const rawBody = invocationBody();
    const parsed = parseConnectorInvocationRequestV1(rawBody);
    if (!parsed.ok) throw new Error('fixture');
    const fixtures = credentialFixtures();
    const registry = new CredentialProfileRegistry(profileConfigurations, [fixtures.bearerProvider, fixtures.apiKeyProvider], [fixtures.bearerStrategy, fixtures.apiKeyStrategy]);
    const credentials = new CredentialExecutionBoundary(registry);
    const credentialBoundary: Pick<CredentialExecutionBoundary, 'withAppliedCredential'> = {
      async withAppliedCredential<T>(bindingValue: ProtectedBindingView, operation: PreparedManifestOperation,
        consume: (request: AppliedCredentialRequest) => Promise<T>): Promise<CredentialExecutionResult<T>> {
        events.push('credential');
        return credentials.withAppliedCredential<T>(bindingValue, operation, consume);
      }
    };
    const realManifests = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]);
    const service = new ConnectorInvocationService(
      { authenticate: jest.fn(async () => { events.push('authenticate'); return { ok: true as const, value: { proof: proof() } }; }) },
      { snapshot: () => { events.push('readiness'); return { ready: true }; } },
      {
        withInvocationLease: jest.fn(async (_ref, _expected, work) => { events.push('binding'); const result = await work(binding(), new AbortController().signal); events.push('release'); return { ok: true as const, value: result }; }),
        revoke: jest.fn()
      },
      { prepare: jest.fn((...args: Parameters<OperationManifestRegistry['prepare']>) => { events.push('manifest'); return realManifests.prepare(...args); }) },
      credentialBoundary,
      { execute: jest.fn(async () => { events.push('upstream'); return { ok: true as const, value: { sku: 'SKU-1', quantity: 9 } }; }) }
    );
    const result = await service.handle({ method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', requestIdHeader: 'req-phase6-0001', rawBody });
    expect(events).toEqual(['authenticate', 'readiness', 'binding', 'manifest', 'credential', 'upstream', 'release']);
    expect(result).toEqual({ statusCode: 200, body: { version: '1', requestId: 'req-phase6-0001', status: 'succeeded', result: { sku: 'SKU-1', quantity: 9 } } });
    expect(JSON.stringify(result)).not.toMatch(/api-key-secret|customer-b-handle|ccr_/);
  });

  it('rejects a valid authenticated request while Runtime readiness is false before binding or execution', async () => {
    const rawBody = invocationBody();
    const bindings = { withInvocationLease: jest.fn(), revoke: jest.fn() };
    const manifests = { prepare: jest.fn() };
    const credentials = { withAppliedCredential: jest.fn() };
    const upstream = { execute: jest.fn() };
    const service = new ConnectorInvocationService(
      { authenticate: jest.fn(async () => ({ ok: true as const, value: { proof: proof() } })) },
      { snapshot: () => ({ ready: false }) },
      bindings, manifests, credentials, upstream
    );

    const result = await service.handle({ method: 'POST', contentType: 'application/json', authorization: 'Bearer a.b.c', requestIdHeader: 'req-phase6-0001', rawBody });

    expect(result).toEqual({
      statusCode: 503,
      body: { version: '1', requestId: 'req-phase6-0001', status: 'failed', error: { code: 'CONNECTOR_UNAVAILABLE' } }
    });
    expect(bindings.withInvocationLease).not.toHaveBeenCalled();
    expect(manifests.prepare).not.toHaveBeenCalled();
    expect(credentials.withAppliedCredential).not.toHaveBeenCalled();
    expect(upstream.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/readiness|dependency|customer-b-handle|ccr_/i);
  });
});

function invocationBody(): Buffer {
  return Buffer.from(JSON.stringify({ version: '1', requestId: 'req-phase6-0001', remainingBudgetMs: 4500,
    trustedContext: { customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory', organizationId: 'org-b', actorId: 'actor-b', connectorKey: 'inventory', connectorInstanceId: 'customer-b-inventory-connector-1' },
    operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-1' } }, connectorContextRef: `ccr_${'A'.repeat(43)}` }), 'utf8');
}
function proof() {
  return Object.freeze({ kind: 'central-invocation' as const, profileKey: 'central-v1', keyDomain: 'central', kid: 'kid', bodySha256: 'x', jti: 'jti', expiresAt: 2_000_000_000, requestId: 'req-phase6-0001',
    claims: Object.freeze({ customer_id: 'customer-b', integration_id: 'inventory-b', host_app: 'customer-b-inventory', connector_key: 'inventory', connector_instance_id: 'customer-b-inventory-connector-1', operation: 'inventory.stock-on-hand', operation_version: '1.0.0' }) });
}

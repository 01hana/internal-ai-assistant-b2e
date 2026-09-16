import { combineAbortSignals, LocalInvocationDeadline } from '../../src/invocation/invocation-deadline';
import { ConnectorInvocationService } from '../../src/invocation/connector-invocation.service';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { customerBOperation, parsedManifest } from '../fixtures/phase5-manifests';
import { appliedCredentialRequest } from '../../src/credentials/credential.types';
import type { AppliedCredentialRequest } from '../../src/credentials/credential.types';
import type { PreparedManifestOperation } from '../../src/manifest/operation-manifest.registry';
import type { CredentialExecutionResult } from '../../src/credentials/credential-execution.boundary';
import { ConnectorDestinationPolicy } from '../../src/upstream/connector-destination-policy';
import { UpstreamExecutionService } from '../../src/upstream/upstream-execution.service';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import { parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { binding } from '../fixtures/phase5-credentials';
import type { BindingResult, InvocationBindingExpectation, ProtectedBindingView } from '../../src/bindings/binding.types';
import { ConnectorInvocationController } from '../../src/invocation/connector-invocation.controller';
import { EventEmitter } from 'node:events';

describe('Phase 6 invocation timeout and cancellation', () => {
  it('narrows the signed budget by reserve, manifest, and global maximum', () => {
    expect(new LocalInvocationDeadline(4_500, 3_500).timeoutMs).toBe(3_500);
    expect(new LocalInvocationDeadline(1_000, 3_500).timeoutMs).toBe(750);
    expect(new LocalInvocationDeadline(4_500, 3_500, 1_000).timeoutMs).toBe(3_250);
    expect(new LocalInvocationDeadline(1_000, 3_500, 750).timeoutMs).toBe(0);
  });
  it('combines caller, lease, and deadline abort without retry', () => {
    const caller = new AbortController(); const lease = new AbortController();
    const combined = combineAbortSignals([caller.signal, lease.signal]);
    expect(combined.signal.aborted).toBe(false); lease.abort(); expect(combined.signal.aborted).toBe(true); combined.dispose();
  });

  it('subtracts pre-upstream elapsed time from the signed budget in orchestration', async () => {
    jest.useFakeTimers();
    try {
      const clock = jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(1_000);
      const upstream = jest.fn((_operation, _args, _applied, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, code: 'CONNECTOR_TIMEOUT' }), { once: true });
      }));
      const service = serviceWith(upstream, clock);
      let settled = false;
      const pending = service.handle(input()).then((value) => { settled = true; return value; });
      await Promise.resolve();
      jest.advanceTimersByTime(3_249);
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);
      await expect(pending).resolves.toMatchObject({ body: { error: { code: 'CONNECTOR_TIMEOUT' } } });
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('includes bounded route body intake in the signed budget using one monotonic clock domain', async () => {
    jest.useFakeTimers();
    try {
      let now = 0;
      const clock = { nowMilliseconds: () => now };
      const upstream = jest.fn((_operation, _args, _applied, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, code: 'CONNECTOR_TIMEOUT' }), { once: true });
      }));
      const controller = new ConnectorInvocationController(serviceWith(upstream, clock.nowMilliseconds), clock);
      const request = routeRequest(input().rawBody);
      const response = routeResponse();
      const pending = controller.invoke(request as never, response as never);
      now = 1_000;
      request.emit('data', input().rawBody);
      request.emit('end');
      await untilCalled(upstream);
      jest.advanceTimersByTime(3_249);
      await Promise.resolve();
      expect(response.send).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await pending;
      expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'CONNECTOR_TIMEOUT' } }));
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('fails after route body intake exhausts the signed budget before credential, DNS, or HTTP access', async () => {
    let now = 0;
    const clock = { nowMilliseconds: () => now };
    const credential = jest.fn();
    const upstream = jest.fn();
    const controller = new ConnectorInvocationController(serviceWith(upstream, clock.nowMilliseconds, credential), clock);
    const request = routeRequest(input().rawBody);
    const response = routeResponse();
    const pending = controller.invoke(request as never, response as never);
    now = 4_250;
    request.emit('data', input().rawBody);
    request.emit('end');
    await pending;
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'CONNECTOR_TIMEOUT' } }));
    expect(credential).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('fails budget exhaustion before credential or upstream access', async () => {
    const credential = jest.fn();
    const upstream = jest.fn();
    const service = serviceWith(upstream, jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(4_251), credential);
    await expect(service.handle(input())).resolves.toMatchObject({ body: { error: { code: 'CONNECTOR_TIMEOUT' } } });
    expect(credential).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('keeps response-stream cancellation as timeout and never extracts partial data', async () => {
    const operation = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])])
      .prepare('inventory', 'inventory.stock-on-hand', '1.0.0', parseArguments());
    if (!operation.ok) throw new Error('stream timeout fixture');
    const abort = new AbortController();
    const destroy = jest.fn();
    const extractor = new ManifestResponseExtractor();
    const extract = jest.spyOn(extractor, 'extract');
    const body = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"sku":"SKU-1",');
        await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('response-stream-sentinel');
      }
    };
    const upstream = new UpstreamExecutionService(
      new ConnectorDestinationPolicy([{
        upstreamServiceRef: 'inventory-api', origin: 'https://inventory.test', basePath: '/', addressMode: 'public_only', allowedCidrs: []
      }], 'production'),
      { execute: jest.fn().mockResolvedValue({ ok: true, value: {
        statusCode: 200, headers: { 'content-type': 'application/json' }, body, destroy
      } }) } as never,
      jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
      new BoundedJsonResponse(), extractor
    );
    const pending = upstream.execute(operation.value, { sku: 'SKU-1' }, appliedCredentialRequest({
      request: operation.value.request, 'X-Inventory-Key': 'fixture'
    }), abort.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    expect(destroy).toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
  });
});

function serviceWith(upstreamExecute: jest.Mock, clock: () => number, credentialCall = jest.fn()) {
  const manifests = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]);
  return new ConnectorInvocationService(
    { authenticate: jest.fn().mockResolvedValue({ ok: true, value: { proof: proof() } }) },
    { snapshot: () => ({ ready: true }) },
    {
      withInvocationLease: async <T>(_ref: string, _expectation: InvocationBindingExpectation,
        work: (value: ProtectedBindingView, signal: AbortSignal) => Promise<T>): Promise<BindingResult<T>> =>
        Object.freeze({ ok: true as const, value: await work(binding() as ProtectedBindingView, new AbortController().signal) }),
      revoke: jest.fn()
    },
    manifests,
    { withAppliedCredential: async <T>(_binding: ProtectedBindingView, operation: PreparedManifestOperation,
      consume: (request: AppliedCredentialRequest) => Promise<T>): Promise<CredentialExecutionResult<T>> => {
        credentialCall();
        return Object.freeze({ ok: true as const, value: await consume(appliedCredentialRequest({ request: operation.request, 'X-Inventory-Key': 'safe-fixture' })) });
      } },
    { execute: upstreamExecute },
    clock
  );
}

function input() {
  return {
    method: 'POST', contentType: 'application/json', authorization: 'Bearer fixture', requestIdHeader: 'req-budget-0001',
    rawBody: Buffer.from(JSON.stringify({
      version: '1', requestId: 'req-budget-0001', remainingBudgetMs: 4500,
      trustedContext: { customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory', organizationId: 'org-b', actorId: 'actor-b', connectorKey: 'inventory', connectorInstanceId: 'customer-b-inventory-connector-1' },
      operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-1' } }, connectorContextRef: `ccr_${'A'.repeat(43)}`
    }))
  };
}

function proof() {
  return {
    kind: 'central-invocation', profileKey: 'central-v1', keyDomain: 'central', kid: 'kid', bodySha256: 'digest', jti: 'jti',
    expiresAt: 1_900_000_000, requestId: 'req-budget-0001', claims: {
      customer_id: 'customer-b', integration_id: 'inventory-b', host_app: 'customer-b-inventory', connector_key: 'inventory',
      connector_instance_id: 'customer-b-inventory-connector-1', operation: 'inventory.stock-on-hand', operation_version: '1.0.0'
    }
  } as const;
}

function parseArguments() {
  const raw = input().rawBody;
  const parsed = parseConnectorInvocationRequestV1(raw);
  if (!parsed.ok) throw new Error('argument fixture');
  return parsed.value.operation.arguments;
}

function routeRequest(rawBody: Buffer) {
  return Object.assign(new EventEmitter(), {
    method: 'POST', pause: jest.fn(), socket: { destroy: jest.fn() },
    headers: {
      'content-type': 'application/json', authorization: 'Bearer fixture', 'x-request-id': 'req-budget-0001',
      'content-length': String(rawBody.byteLength)
    }
  });
}

function routeResponse() {
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    status: jest.fn(), type: jest.fn(), send: jest.fn(), setHeader: jest.fn()
  });
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.send.mockImplementation(() => { response.writableFinished = true; response.emit('finish'); return response; });
  return response;
}

async function untilCalled(mock: jest.Mock): Promise<void> {
  for (let attempt = 0; attempt < 50 && mock.mock.calls.length === 0; attempt += 1) await Promise.resolve();
  if (mock.mock.calls.length === 0) throw new Error('expected invocation stage was not reached');
}

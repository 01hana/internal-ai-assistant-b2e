import {
  parseConnectorInvocationRequestV1, parseConnectorInvocationResponseV1,
  type ConnectorErrorCode, type ConnectorInvocationRequestV1, type ConnectorInvocationResponseV1
} from '@internal-ai-assistant/connector-runtime-contract';
import type { ConnectorBindingService } from '../bindings/connector-binding.service';
import type { CredentialExecutionBoundary } from '../credentials/credential-execution.boundary';
import type { OperationManifestRegistry } from '../manifest/operation-manifest.registry';
import type { ExactRawBodyAuthenticator } from '../service-auth/exact-raw-body.authenticator';
import type { UpstreamExecutionService, UpstreamExecutionResult } from '../upstream/upstream-execution.service';
import { shouldRevokeCredential } from '../upstream/upstream-errors';
import { combineAbortSignals, LocalInvocationDeadline } from './invocation-deadline';
import { performance } from 'node:perf_hooks';
import { LocalConnectorDiagnostics, type RuntimeDiagnosticMetadata } from '../diagnostics/local-connector-diagnostics';

export interface ConnectorInvocationInput {
  readonly method: string; readonly contentType?: string; readonly contentEncoding?: string; readonly authorization?: string;
  readonly requestIdHeader?: string; readonly rawBody: Uint8Array; readonly requestSignal?: AbortSignal;
}
export interface ConnectorInvocationResult { readonly statusCode: number; readonly body: ConnectorInvocationResponseV1; }
interface RuntimeReadinessBoundary { snapshot(): Readonly<{ ready: boolean }>; }
const REJECTED_REQUEST_ID = 'rejected-request';

export class ConnectorInvocationService {
  constructor(
    private readonly authenticator: Pick<ExactRawBodyAuthenticator, 'authenticate'>,
    private readonly readiness: RuntimeReadinessBoundary,
    private readonly bindings: Pick<ConnectorBindingService, 'withInvocationLease' | 'revoke'>,
    private readonly manifests: Pick<OperationManifestRegistry, 'prepare'>,
    private readonly credentials: Pick<CredentialExecutionBoundary, 'withAppliedCredential'>,
    private readonly upstream: Pick<UpstreamExecutionService, 'execute'>,
    private readonly nowMilliseconds: () => number = () => performance.now(),
    private readonly diagnostics: LocalConnectorDiagnostics = new LocalConnectorDiagnostics()
  ) {}

  async handle(input: ConnectorInvocationInput, invocationStartedAt = this.nowMilliseconds()): Promise<ConnectorInvocationResult> {
    if (!input.requestIdHeader) {
      this.diagnostics.emit('INVOCATION_SERVICE_AUTH_FAILED', 'FAILED', { failureCategory: 'MISSING_REQUEST_ID' });
      return response('CONNECTOR_REQUEST_INVALID', REJECTED_REQUEST_ID);
    }
    const authenticated = await this.authenticator.authenticate({ routeClass: 'central-invocation', method: input.method, contentType: input.contentType,
      contentEncoding: input.contentEncoding, authorization: input.authorization, rawBody: input.rawBody });
    if (!authenticated.ok) {
      this.diagnostics.emit('INVOCATION_SERVICE_AUTH_FAILED', 'FAILED', {
        requestId: input.requestIdHeader, failureCategory: authenticated.code
      });
      return response(authenticated.code, REJECTED_REQUEST_ID);
    }
    const proof = authenticated.value.proof; const parsed = parseConnectorInvocationRequestV1(input.rawBody);
    this.diagnostics.emit('INVOCATION_SERVICE_AUTH_SUCCEEDED', 'SUCCEEDED', { requestId: proof.requestId });
    if (!parsed.ok || parsed.value.requestId !== proof.requestId || input.requestIdHeader !== proof.requestId || !proofMatchesBody(proof.claims, parsed.value)) {
      this.diagnostics.emit('INVOCATION_CONTEXT_REJECTED', 'FAILED', {
        requestId: proof.requestId, failureCategory: 'TRUSTED_CONTEXT_MISMATCH'
      });
      return response('CONNECTOR_REQUEST_INVALID', proof.requestId);
    }
    const body = parsed.value;
    const diagnosticMetadata = safeInvocationMetadata(body);
    this.diagnostics.emit('INVOCATION_CONTEXT_VALIDATED', 'SUCCEEDED', diagnosticMetadata);
    if (!this.readiness.snapshot().ready) return response('CONNECTOR_UNAVAILABLE', body.requestId);
    let revokeCredential = false;
    try {
      const leased = await this.bindings.withInvocationLease(body.connectorContextRef, { trustedContext: {
        customerId: body.trustedContext.customerId, integrationId: body.trustedContext.integrationId, hostApp: body.trustedContext.hostApp,
        connectorInstanceId: body.trustedContext.connectorInstanceId, organizationId: body.trustedContext.organizationId, actorId: body.trustedContext.actorId
      } }, async (binding, leaseSignal) => {
        this.diagnostics.emit('BINDING_LOOKUP_SUCCEEDED', 'SUCCEEDED', diagnosticMetadata);
        const prepared = this.manifests.prepare(body.trustedContext.connectorKey, body.operation.key, body.operation.version, body.operation.arguments);
        if (!prepared.ok) {
          this.diagnostics.emit('MANIFEST_RESOLUTION_FAILED', 'FAILED', {
            ...diagnosticMetadata, failureCategory: prepared.code
          });
          return prepared;
        }
        this.diagnostics.emit('MANIFEST_RESOLVED', 'SUCCEEDED', diagnosticMetadata);
        const elapsedMs = Math.max(0, this.nowMilliseconds() - invocationStartedAt);
        const deadline = new LocalInvocationDeadline(body.remainingBudgetMs, prepared.value.limits.timeoutMs, elapsedMs);
        if (deadline.timeoutMs <= 0) return Object.freeze({ ok: false as const, code: 'CONNECTOR_TIMEOUT' as const });
        const combined = combineAbortSignals([leaseSignal, ...(input.requestSignal ? [input.requestSignal] : [])], deadline.timeoutMs);
        try {
          const executed = await this.credentials.withAppliedCredential(binding, prepared.value, (applied) => {
            this.diagnostics.emit('CREDENTIAL_RESOLUTION_SUCCEEDED', 'SUCCEEDED', diagnosticMetadata);
            return this.upstream.execute(
              prepared.value,
              body.operation.arguments as Readonly<Record<string, unknown>>,
              applied,
              combined.signal,
              { diagnostics: this.diagnostics, metadata: diagnosticMetadata }
            );
          });
          if (!executed.ok) {
            this.diagnostics.emit('CREDENTIAL_RESOLUTION_FAILED', 'FAILED', {
              ...diagnosticMetadata, failureCategory: executed.code
            });
            return executed;
          }
          const result = executed.value as UpstreamExecutionResult;
          if (!result.ok && shouldRevokeCredential(result.code)) revokeCredential = true;
          return result;
        } finally { combined.dispose(); }
      });
      if (!leased.ok) {
        this.diagnostics.emit('BINDING_LOOKUP_FAILED', 'FAILED', {
          ...diagnosticMetadata, failureCategory: leased.code
        });
        return response(leased.code, body.requestId);
      }
      if (!leased.value.ok) {
        if (shouldRevokeCredential(leased.value.code)) revokeCredential = true;
        return response(leased.value.code, body.requestId);
      }
      return success(body.requestId, leased.value.value);
    } catch {
      this.diagnostics.emit('UPSTREAM_REQUEST_FAILED', 'FAILED', {
        ...diagnosticMetadata,
        failureCategory: input.requestSignal?.aborted ? 'CONNECTOR_TIMEOUT' : 'CONNECTOR_UNAVAILABLE'
      });
      return response(input.requestSignal?.aborted ? 'CONNECTOR_TIMEOUT' : 'CONNECTOR_UNAVAILABLE', body.requestId);
    } finally {
      if (revokeCredential) { try { await this.bindings.revoke(body.connectorContextRef, 'provider_rejected'); } catch { /* remains safe */ } }
    }
  }
}

function safeInvocationMetadata(body: ConnectorInvocationRequestV1): RuntimeDiagnosticMetadata {
  return Object.freeze({
    requestId: body.requestId,
    customerId: body.trustedContext.customerId,
    integrationId: body.trustedContext.integrationId,
    hostApp: body.trustedContext.hostApp,
    connectorKey: body.trustedContext.connectorKey,
    connectorInstanceId: body.trustedContext.connectorInstanceId,
    operationKey: body.operation.key,
    operationVersion: body.operation.version
  });
}

function proofMatchesBody(claims: Readonly<Record<string, unknown>>, value: ConnectorInvocationRequestV1): boolean {
  return claims.customer_id === value.trustedContext.customerId && claims.integration_id === value.trustedContext.integrationId &&
    claims.host_app === value.trustedContext.hostApp && claims.connector_key === value.trustedContext.connectorKey &&
    claims.connector_instance_id === value.trustedContext.connectorInstanceId && claims.operation === value.operation.key && claims.operation_version === value.operation.version;
}
function success(requestId: string, result: Readonly<Record<string, string | number | boolean>>): ConnectorInvocationResult {
  return validated(200, { version: '1', requestId, status: 'succeeded', result });
}
function response(code: ConnectorErrorCode, requestId: string): ConnectorInvocationResult {
  return validated(statusFor(code), { version: '1', requestId, status: 'failed', error: { code } });
}
function validated(statusCode: number, body: object): ConnectorInvocationResult {
  const parsed = parseConnectorInvocationResponseV1(Buffer.from(JSON.stringify(body), 'utf8'), (body as { requestId: string }).requestId);
  if (!parsed.ok) {
    const fallback = { version: '1' as const, requestId: REJECTED_REQUEST_ID, status: 'failed' as const, error: { code: 'CONNECTOR_UNAVAILABLE' as const } };
    return Object.freeze({ statusCode: 503, body: fallback as ConnectorInvocationResponseV1 });
  }
  return Object.freeze({ statusCode, body: parsed.value });
}
function statusFor(code: ConnectorErrorCode): number {
  if (code === 'CONNECTOR_REQUEST_INVALID') return 400; if (code === 'CONNECTOR_AUTH_FAILED') return 401;
  if (code === 'CONNECTOR_CONTEXT_MISMATCH' || code === 'CONNECTOR_BINDING_INVALID') return 403;
  if (code === 'CONNECTOR_REPLAY_REJECTED' || code === 'CONNECTOR_BINDING_BUSY') return 409;
  if (code === 'CONNECTOR_OPERATION_UNAVAILABLE' || code === 'CONNECTOR_RESPONSE_INVALID') return 422;
  if (code === 'CONNECTOR_UPSTREAM_AUTH_FAILED' || code === 'CONNECTOR_UPSTREAM_FAILED') return 502;
  if (code === 'CONNECTOR_TIMEOUT') return 504; return 503;
}

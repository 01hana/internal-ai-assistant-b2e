import {
  CONNECTOR_BINDING_MAX_RESPONSE_BYTES,
  parseConnectorBindingBootstrapRequestV1,
  type ConnectorBindingBootstrapResponseV1,
  type ConnectorErrorCode
} from '@internal-ai-assistant/connector-runtime-contract';
import type { ExactRawBodyAuthenticator } from '../service-auth/exact-raw-body.authenticator';
import type { BindingBootstrapProviderRegistry } from './binding-bootstrap-provider.registry';
import type { BindingBootstrapProviderResult } from './binding-bootstrap-provider';
import type { ConnectorBindingService } from './connector-binding.service';
import type { LocalConnectorDiagnostics } from '../diagnostics/local-connector-diagnostics';

export type ConnectorBindingRequestInput = Readonly<{
  method: string;
  contentType?: string;
  contentEncoding?: string;
  authorization?: string;
  rawBody: Uint8Array;
  diagnosticRequestId?: string;
}>;

export type ConnectorBindingRequestResult = Readonly<{
  statusCode: number;
  body: ConnectorBindingBootstrapResponseV1;
}>;

const REJECTED_REQUEST_ID = 'rejected-request';

export class ConnectorBindingRequestService {
  constructor(
    private readonly authenticator: Pick<ExactRawBodyAuthenticator, 'authenticateRegisteredBootstrap'>,
    private readonly providers: Pick<BindingBootstrapProviderRegistry, 'resolve'>,
    private readonly bindings: Pick<ConnectorBindingService, 'mint' | 'revoke'>,
    private readonly diagnostics?: Pick<LocalConnectorDiagnostics, 'emit'>
  ) {}

  async handle(input: ConnectorBindingRequestInput): Promise<ConnectorBindingRequestResult> {
    const authenticated = await this.authenticator.authenticateRegisteredBootstrap({
      routeClass: 'binding-bootstrap', method: input.method, contentType: input.contentType,
      contentEncoding: input.contentEncoding, authorization: input.authorization, rawBody: input.rawBody
    });
    if (!authenticated.ok) {
      this.diagnostics?.emit('BINDING_SERVICE_AUTH_FAILED', 'FAILED', {
        internalBindingRequestId: input.diagnosticRequestId, failureCategory: authenticated.code
      });
      return response(authenticated.code, REJECTED_REQUEST_ID);
    }
    const proof = authenticated.value.proof;
    const metadata = { internalBindingRequestId: proof.requestId };
    this.diagnostics?.emit('BINDING_SERVICE_AUTH_SUCCEEDED', 'SUCCEEDED', metadata);
    this.diagnostics?.emit('BOOTSTRAP_PROFILE_RESOLVED', 'SUCCEEDED', metadata);
    const provider = proof.providerKey === undefined ? undefined : this.providers.resolve(proof.profileKey, proof.providerKey);
    if (!provider) {
      this.diagnostics?.emit('BOOTSTRAP_PROVIDER_FAILED', 'FAILED', { ...metadata, failureCategory: 'PROVIDER_UNRESOLVED' });
      return response('CONNECTOR_UNAVAILABLE', proof.requestId);
    }
    this.diagnostics?.emit('BOOTSTRAP_PROVIDER_RESOLVED', 'SUCCEEDED', metadata);
    const parsed = parseConnectorBindingBootstrapRequestV1(input.rawBody, provider.contract);
    if (!parsed.ok || parsed.value.requestId !== proof.requestId || parsed.value.bootstrapProfileKey !== proof.profileKey) {
      return response('CONNECTOR_REQUEST_INVALID', proof.requestId);
    }
    if (!contextsEqual(parsed.value.trustedContext, proof.trustedContext)) {
      this.diagnostics?.emit('BINDING_CONTEXT_REJECTED', 'FAILED', { ...metadata, failureCategory: 'TRUSTED_CONTEXT_MISMATCH' });
      return response('CONNECTOR_BINDING_INVALID', proof.requestId);
    }
    this.diagnostics?.emit('BINDING_CONTEXT_VALIDATED', 'SUCCEEDED', metadata);

    let created: BindingBootstrapProviderResult | undefined;
    let ownershipTransferred = false;
    let providerCleanupAttempted = false;
    const cleanupBeforeTransfer = async (): Promise<void> => {
      if (!created || ownershipTransferred || providerCleanupAttempted) return;
      providerCleanupAttempted = true;
      try { await provider.revoke(created.opaqueCredentialHandle, 'mint_failed'); } catch { /* safe failure only */ }
    };

    try {
      created = await provider.create(parsed.value.providerPayload, proof.trustedContext!);
      this.diagnostics?.emit('CREDENTIAL_CREATE_SUCCEEDED', 'SUCCEEDED', metadata);
      const minted = await this.bindings.mint({
        trustedContext: proof.trustedContext!, bootstrapProviderKey: provider.bootstrapProviderKey,
        credentialProviderKey: created.credentialProviderKey, opaqueCredentialHandle: created.opaqueCredentialHandle,
        credentialGeneration: created.credentialGeneration, providerExpiresAt: created.providerExpiresAt,
        providerMetadata: created.providerMetadata
      });
      if (!minted.ok) {
        this.diagnostics?.emit('BINDING_MINT_FAILED', 'FAILED', { ...metadata, failureCategory: minted.code });
        await cleanupBeforeTransfer();
        return response(minted.code === 'CONNECTOR_UNAVAILABLE' ? minted.code : 'CONNECTOR_UNAVAILABLE', proof.requestId);
      }
      ownershipTransferred = true;
      this.diagnostics?.emit('BINDING_MINT_SUCCEEDED', 'SUCCEEDED', metadata);
      const body = Object.freeze({
        version: '1' as const, requestId: proof.requestId,
        connectorContextRef: minted.value.connectorContextRef, expiresIn: minted.value.expiresIn
      });
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > CONNECTOR_BINDING_MAX_RESPONSE_BYTES) {
        await this.bindings.revoke(minted.value.connectorContextRef, 'mint_failed');
        return response('CONNECTOR_UNAVAILABLE', proof.requestId);
      }
      return Object.freeze({ statusCode: 200, body });
    } catch {
      this.diagnostics?.emit(created ? 'BINDING_MINT_FAILED' : 'CREDENTIAL_CREATE_FAILED', 'FAILED', {
        ...metadata, failureCategory: created ? 'UNEXPECTED_MINT_FAILURE' : 'PROVIDER_CREATE_FAILED'
      });
      await cleanupBeforeTransfer();
      return response('CONNECTOR_UNAVAILABLE', proof.requestId);
    }
  }
}

function contextsEqual(left: object, right: object | undefined): boolean {
  if (!right) return false;
  const keys = ['customerId', 'integrationId', 'hostApp', 'connectorInstanceId', 'organizationId', 'actorId'] as const;
  return keys.every((key) => (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key]);
}

function response(code: ConnectorErrorCode, requestId: string): ConnectorBindingRequestResult {
  const body = Object.freeze({ version: '1' as const, requestId, status: 'failed' as const, error: Object.freeze({ code }) });
  return Object.freeze({ statusCode: statusFor(code), body });
}

function statusFor(code: ConnectorErrorCode): number {
  if (code === 'CONNECTOR_REQUEST_INVALID') return 400;
  if (code === 'CONNECTOR_AUTH_FAILED') return 401;
  if (code === 'CONNECTOR_BINDING_INVALID') return 403;
  if (code === 'CONNECTOR_REPLAY_REJECTED' || code === 'CONNECTOR_BINDING_BUSY') return 409;
  if (code === 'CONNECTOR_TIMEOUT') return 504;
  return 503;
}

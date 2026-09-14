import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { exportJWK, SignJWT, type KeyLike } from 'jose';
import { CONNECTOR_BINDING_MAX_REQUEST_BYTES } from '@internal-ai-assistant/connector-runtime-contract';
import { BridgeConfigService, type ConnectorBindingConfiguration } from '../config/bridge-config.service';
import type { AcceptedIdentity } from '../idx/identity-admission.service';
import { SigningKeyProvider } from '../signing/signing-key.provider';

export type ConnectorBindingPrepareInput = Readonly<{
  requestId: string;
  nativeAccessToken: string;
  acceptedIdentity: AcceptedIdentity;
}>;

export type SignedConnectorBindingRequest = Readonly<{
  bytes: Buffer;
  proof: string;
  requestId: string;
}>;

export type ConnectorBindingPrepareResult =
  | Readonly<{ ok: true; value: SignedConnectorBindingRequest }>
  | Readonly<{ ok: false; code: 'CONNECTOR_AUTH_FAILED' | 'CONNECTOR_REQUEST_INVALID' }>;

type SignerOptions = Readonly<{
  now?: () => number;
  uuid?: () => string;
  serialize?: (value: unknown) => string;
}>;

export class ConnectorBindingServiceAuthSigner {
  constructor(
    private readonly bridgeConfig: BridgeConfigService,
    private readonly options: SignerOptions = {},
    private readonly keyProvider = new SigningKeyProvider()
  ) {}

  async validate(): Promise<boolean> {
    try { await this.activeKey(this.bindingConfig()); return true; } catch { return false; }
  }

  async prepare(input: ConnectorBindingPrepareInput): Promise<ConnectorBindingPrepareResult> {
    try {
      const config = this.bindingConfig();
      if (!validRequestId(input.requestId) || !validNativeAccessToken(input.nativeAccessToken) ||
          !identifier(input.acceptedIdentity.subject) || !identifier(input.acceptedIdentity.organization) ||
          (config.context.actorId !== undefined && input.acceptedIdentity.subject !== config.context.actorId) ||
          (config.context.organizationId !== undefined && input.acceptedIdentity.organization !== config.context.organizationId) ||
          !identifier(input.acceptedIdentity.entry)) return authFailure();
      const admittedContext = Object.freeze({
        organizationId: input.acceptedIdentity.organization,
        actorId: input.acceptedIdentity.subject
      });
      const request = deepFreeze({
        version: '1' as const,
        requestId: input.requestId,
        bootstrapProfileKey: config.context.bootstrapProfileKey,
        trustedContext: {
          customerId: config.context.customerId,
          integrationId: config.context.integrationId,
          hostApp: config.context.hostApp,
          connectorInstanceId: config.context.connectorInstanceId,
          organizationId: admittedContext.organizationId,
          actorId: admittedContext.actorId
        },
        providerPayload: {
          nativeAccessToken: input.nativeAccessToken,
          acceptedSubject: input.acceptedIdentity.subject,
          acceptedOrganization: input.acceptedIdentity.organization,
          acceptedEntry: input.acceptedIdentity.entry
        }
      });
      const serialized = (this.options.serialize ?? JSON.stringify)(request);
      const bytes = Buffer.from(serialized, 'utf8');
      if (bytes.byteLength < 1 || bytes.byteLength > CONNECTOR_BINDING_MAX_REQUEST_BYTES) return requestFailure();
      const key = await this.activeKey(config);
      const now = (this.options.now ?? (() => Math.floor(Date.now() / 1000)))();
      const jti = (this.options.uuid ?? randomUUID)();
      if (!Number.isInteger(now) || !validUuid(jti)) return authFailure();
      const context = config.context;
      const proof = await new SignJWT({
        proof_version: 1,
        customer_id: context.customerId,
        integration_id: context.integrationId,
        host_app: context.hostApp,
        connector_instance_id: context.connectorInstanceId,
        organization_id: admittedContext.organizationId,
        actor_id: admittedContext.actorId,
        bootstrap_profile_key: context.bootstrapProfileKey,
        provider_key: context.providerKey,
        request_id: input.requestId,
        body_sha256: createHash('sha256').update(bytes).digest('base64url')
      }).setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: config.serviceAuth.typ })
        .setIssuer(config.serviceAuth.issuer)
        .setSubject(config.serviceAuth.subject)
        .setAudience(config.serviceAuth.audience)
        .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 30).setJti(jti)
        .sign(key.privateKey);
      return Object.freeze({ ok: true, value: Object.freeze({ bytes, proof, requestId: input.requestId }) });
    } catch {
      return authFailure();
    }
  }

  private bindingConfig(): ConnectorBindingConfiguration {
    const config = this.bridgeConfig.configuration.connectorBinding;
    if (!config) throw new Error('binding-disabled');
    return config;
  }

  private async activeKey(config: ConnectorBindingConfiguration): Promise<Readonly<{ kid: string; privateKey: KeyLike }>> {
    const active = config.serviceAuth.keys.filter((key) => key.status === 'active');
    if (active.length !== 1 || !active[0]!.privateKeyReference) throw new Error('binding-key');
    const configured = active[0]!;
    const reference = configured.privateKeyReference;
    if (!reference) throw new Error('binding-key');
    const privateKey = await this.keyProvider.load(reference);
    const derived = await exportJWK(createPublicKey(privateKey as never) as KeyLike);
    if (derived.kty !== 'RSA' || derived.n !== configured.publicJwk.n || derived.e !== configured.publicJwk.e) throw new Error('binding-key');
    return Object.freeze({ kid: configured.kid, privateKey });
  }
}

function validNativeAccessToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 12_000 && !/\s|\0/.test(value);
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function validRequestId(value: unknown): value is string { return identifier(value); }
function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function authFailure(): ConnectorBindingPrepareResult { return Object.freeze({ ok: false, code: 'CONNECTOR_AUTH_FAILED' }); }
function requestFailure(): ConnectorBindingPrepareResult { return Object.freeze({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' }); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

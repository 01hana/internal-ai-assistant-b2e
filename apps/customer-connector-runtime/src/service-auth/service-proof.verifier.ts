import { compactVerify } from 'jose';
import {
  parseBindingBootstrapServiceProofV1,
  parseCentralInvocationServiceProofV1,
  type ConnectorErrorCode
} from '@internal-ai-assistant/connector-runtime-contract';
import type { RuntimeProfileKind, RuntimeServiceProfileConfiguration } from '../config/runtime-configuration';
import { RuntimeServiceProfileRegistry } from './service-profile.registry';

export type VerifiedServiceProof = Readonly<{
  kind: RuntimeProfileKind;
  profileKey: string;
  keyDomain: string;
  kid: string;
  bodySha256: string;
  jti: string;
  expiresAt: number;
  requestId: string;
  providerKey?: string;
  trustedContext?: Readonly<{
    customerId: string;
    integrationId: string;
    hostApp: string;
    connectorInstanceId: string;
    organizationId?: string;
    actorId?: string;
  }>;
  claims: Readonly<Record<string, unknown>>;
}>;

export type ServiceProofVerificationResult =
  | Readonly<{ ok: true; value: VerifiedServiceProof }>
  | Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_AUTH_FAILED'> }>;

export type SignatureVerifiedServiceProof = Readonly<{
  kind: RuntimeProfileKind;
  profile: RuntimeServiceProfileConfiguration;
  kid: string;
  protectedHeader: Readonly<Record<string, unknown>>;
  claims: Readonly<Record<string, unknown>>;
}>;

export type SignatureVerificationResult =
  | Readonly<{ ok: true; value: SignatureVerifiedServiceProof }>
  | Readonly<{ ok: false; code: 'CONNECTOR_AUTH_FAILED' }>;

export class ConnectorServiceProofVerifier {
  constructor(
    private readonly registry: RuntimeServiceProfileRegistry,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000)
  ) {}

  async verify(kind: RuntimeProfileKind, compactJwt: string, expectedProfileKey?: string): Promise<ServiceProofVerificationResult> {
    const signature = await this.verifySignature(kind, compactJwt, expectedProfileKey);
    if (!signature.ok || !this.isFresh(signature.value)) return failure();
    return this.validateProfileAndContext(signature.value);
  }

  async verifySignature(kind: RuntimeProfileKind, compactJwt: string, expectedProfileKey?: string): Promise<SignatureVerificationResult> {
    return this.verifySignatureCandidate(kind, compactJwt, expectedProfileKey, false);
  }

  async verifyRegisteredBootstrapSignature(compactJwt: string): Promise<SignatureVerificationResult> {
    return this.verifySignatureCandidate('binding-bootstrap', compactJwt, undefined, true);
  }

  private async verifySignatureCandidate(kind: RuntimeProfileKind, compactJwt: string, expectedProfileKey: string | undefined, registeredBootstrap: boolean): Promise<SignatureVerificationResult> {
    try {
      if (typeof compactJwt !== 'string' || compactJwt.length === 0 || compactJwt.length > 16_384) return signatureFailure();
      if (kind === 'binding-bootstrap' && !expectedProfileKey && !registeredBootstrap) return signatureFailure();
      const resolved = await this.registry.resolve(kind, compactJwt, expectedProfileKey);
      if (!resolved) return signatureFailure();
      const verified = await compactVerify(compactJwt, resolved.verificationKey, { algorithms: ['RS256'] });
      const claims = parseVerifiedClaims(verified.payload);
      return Object.freeze({ ok: true, value: Object.freeze({
        kind, profile: resolved.profile, kid: resolved.key.kid,
        protectedHeader: Object.freeze({ ...verified.protectedHeader }),
        claims: Object.freeze({ ...claims })
      }) });
    } catch {
      return signatureFailure();
    }
  }

  isFresh(signature: SignatureVerifiedServiceProof): boolean {
    return fresh(signature.claims.nbf, signature.claims.exp, this.nowSeconds());
  }

  validateProfileAndContext(signature: SignatureVerifiedServiceProof): ServiceProofVerificationResult {
    const parsed = signature.kind === 'central-invocation'
      ? parseCentralInvocationServiceProofV1({ protectedHeader: signature.protectedHeader, claims: signature.claims }, contractProfile(signature.profile))
      : parseBindingBootstrapServiceProofV1({ protectedHeader: signature.protectedHeader, claims: signature.claims }, contractProfile(signature.profile));
    if (!parsed.ok || !contextMatches(signature.profile, parsed.value.claims as unknown as Readonly<Record<string, unknown>>)) return failure();
    return Object.freeze({ ok: true, value: Object.freeze({
      kind: signature.kind,
      profileKey: signature.profile.profileKey,
      keyDomain: signature.profile.keyDomain,
      kid: signature.kid,
      bodySha256: parsed.value.claims.body_sha256,
      jti: parsed.value.claims.jti,
      expiresAt: parsed.value.claims.exp,
      requestId: parsed.value.claims.request_id,
      ...(signature.kind === 'binding-bootstrap'
        ? { providerKey: signature.profile.providerKey, trustedContext: (parsed.value as never as { trustedContext: VerifiedServiceProof['trustedContext'] }).trustedContext }
        : {}),
      claims: parsed.value.claims as unknown as Readonly<Record<string, unknown>>
    }) });
  }
}

function contractProfile(profile: RuntimeServiceProfileConfiguration): never {
  return Object.freeze({
    kind: profile.kind,
    profileKey: profile.profileKey,
    typ: profile.typ,
    issuer: profile.issuer,
    subject: profile.subject,
    audience: profile.audience,
    keyDomain: profile.keyDomain,
    acceptedKids: Object.freeze(profile.keys.filter((key) => key.status !== 'retired').map((key) => key.kid)),
    ...(profile.providerKey === undefined ? {} : { providerKey: profile.providerKey })
  }) as never;
}

function parseVerifiedClaims(payload: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(payload).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  return value as Record<string, unknown>;
}

function fresh(notBefore: unknown, expiresAt: unknown, now: number): boolean {
  return Number.isInteger(notBefore) && Number.isInteger(expiresAt) && Number.isInteger(now) &&
    now >= (notBefore as number) - 5 && now < (expiresAt as number) + 5;
}

function contextMatches(profile: RuntimeServiceProfileConfiguration, claims: Readonly<Record<string, unknown>>): boolean {
  const context = profile.trustedContext;
  const baseMatches = claims.customer_id === context.customerId && claims.integration_id === context.integrationId &&
    claims.host_app === context.hostApp && claims.connector_instance_id === context.connectorInstanceId;
  if (!baseMatches) return false;
  if (profile.kind === 'binding-bootstrap') {
    return (context.organizationId === undefined || claims.organization_id === context.organizationId) &&
      (context.actorId === undefined || claims.actor_id === context.actorId);
  }
  return (context.organizationId === undefined ? claims.organization_id === undefined : claims.organization_id === context.organizationId) &&
    (context.actorId === undefined ? claims.actor_id === undefined : claims.actor_id === context.actorId);
}

function failure(): ServiceProofVerificationResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
}
function signatureFailure(): SignatureVerificationResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
}

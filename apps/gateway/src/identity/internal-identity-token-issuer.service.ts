import { randomUUID } from 'node:crypto';
import { SignJWT, type JWTPayload } from 'jose';
import {
  INTERNAL_IDENTITY_JWT_ALGORITHM,
  type CanonicalInternalIdentityClaims
} from '@internal-ai-assistant/internal-identity-contract';
import type { CanonicalGatewayIdentity } from './canonical-gateway-identity';
import type { ActiveSigningKey } from '../signing/active-signing-key-resolver';

export type InternalIdentityIssuerConfig = Readonly<{
  internalIssuer: string;
  internalAudience: string;
  internalTokenTtlSeconds: number;
}>;

export class InternalIdentityTokenIssuer {
  constructor(
    private readonly config: InternalIdentityIssuerConfig,
    private readonly activeKeyResolver: Readonly<{ resolveActiveSigningKey(): Promise<ActiveSigningKey> }>
  ) {}

  async issue(identity: CanonicalGatewayIdentity): Promise<string> {
    const activeKey = await this.activeKeyResolver.resolveActiveSigningKey();
    const iat = Math.floor(Date.now() / 1000);
    const canonicalClaims: CanonicalInternalIdentityClaims = {
      customer_id: identity.customerId,
      integration_id: identity.integrationId,
      sub: identity.subject,
      org_id: identity.organizationId,
      host_app: identity.hostApp,
      roles: [...identity.roles],
      permission_scopes: [...identity.permissionScopes],
      jti: randomUUID()
    };
    const claims: JWTPayload = { ...canonicalClaims };

    return new SignJWT(claims)
      .setProtectedHeader({ alg: INTERNAL_IDENTITY_JWT_ALGORITHM, typ: 'JWT', kid: activeKey.kid })
      .setIssuer(this.config.internalIssuer)
      .setAudience(this.config.internalAudience)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.config.internalTokenTtlSeconds)
      .sign(activeKey.privateKey);
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { exportJWK, JWK, KeyLike, SignJWT } from 'jose';
import { ExternalIdentity } from './external-identity.service';
import { GatewayConfigService } from './gateway-config.service';

@Injectable()
export class InternalIdentityTokenService implements OnModuleInit {
  private signingKey!: KeyLike;
  private publicJwk!: JWK;

  constructor(private readonly config: GatewayConfigService) {}

  async onModuleInit() {
    const privateKey = createPrivateKey(this.config.internalPrivateKeyPem);
    this.signingKey = privateKey as KeyLike;
    this.publicJwk = {
      ...(await exportJWK(createPublicKey(privateKey) as KeyLike)),
      kid: this.config.internalJwtKeyId,
      use: 'sig',
      alg: 'RS256'
    };
  }

  getJwks() {
    return { keys: [this.publicJwk] };
  }

  async sign(identity: ExternalIdentity): Promise<string> {
    return new SignJWT({
      org_id: identity.organizationId,
      role: identity.role,
      permission_scopes: identity.permissionScopes,
      host_app: identity.hostApp
    })
      .setProtectedHeader({ alg: 'RS256', kid: this.config.internalJwtKeyId, typ: 'JWT' })
      .setIssuer(this.config.internalJwtIssuer)
      .setAudience(this.config.internalJwtAudience)
      .setSubject(identity.actorId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${this.config.internalTokenTtlSeconds}s`)
      .sign(this.signingKey);
  }
}

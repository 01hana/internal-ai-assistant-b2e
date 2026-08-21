import type { GatewayConfigService } from '../../config/gateway-config.service';
import type { GatewaySigningKeyRepository } from '../../signing/gateway-signing-key.repository';
import { ManagedExchangeActivationError } from './managed-exchange-activation.validator';

/** Read-only boundary to Gateway signing authority used solely for collision rejection. */
export class GatewaySigningAuthorityReader {
  constructor(private readonly dependencies: Readonly<{
    config: Pick<GatewayConfigService, 'config'>;
    signingKeys: Pick<GatewaySigningKeyRepository, 'findAllForCollision'>;
  }>) {}

  assertDistinctIssuer(issuer: unknown): void {
    if (issuer === this.dependencies.config.config.internalIssuer) throw new ManagedExchangeActivationError();
  }

  async assertDistinctKey(input: Readonly<Record<string, unknown>>): Promise<void> {
    const kid = input.kid;
    const keyReference = input.keyReference;
    const publicJwk = input.publicJwk;
    if (typeof kid !== 'string' || typeof keyReference !== 'string' || !rsa(publicJwk)) throw new ManagedExchangeActivationError();
    const gatewayKeys = await this.dependencies.signingKeys.findAllForCollision();
    if (gatewayKeys.some((key) => key.kid === kid || key.keyReference === keyReference || sameRsa(key.publicJwk, publicJwk))) {
      throw new ManagedExchangeActivationError();
    }
  }
}

function rsa(value: unknown): value is Readonly<{ kty: string; n: string; e: string }> {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).kty === 'RSA' &&
    typeof (value as Record<string, unknown>).n === 'string' && typeof (value as Record<string, unknown>).e === 'string';
}

function sameRsa(left: unknown, right: Readonly<{ kty: string; n: string; e: string }>): boolean {
  return rsa(left) && left.kty === right.kty && left.n === right.n && left.e === right.e;
}

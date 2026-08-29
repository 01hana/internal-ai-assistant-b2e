import { Injectable, Optional } from '@nestjs/common';
import { BridgeConfigService } from '../config/bridge-config.service';
import { ActiveKeyResolver } from '../signing/active-key.resolver';
import { BridgeJwksError, KeyLifecycleService } from './key-lifecycle.service';

export type BridgePublicJwk = Readonly<{ kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string }>;
export type BridgeJwksDocument = Readonly<{ keys: readonly BridgePublicJwk[] }>;

@Injectable()
export class JwksService {
  private readonly activeResolver: ActiveKeyResolver;

  constructor(
    private readonly config: BridgeConfigService,
    private readonly lifecycle: KeyLifecycleService,
    @Optional() activeResolver?: ActiveKeyResolver
  ) {
    this.activeResolver = activeResolver ?? new ActiveKeyResolver(config);
  }

  async document(): Promise<BridgeJwksDocument> {
    try {
      const keys = this.config.configuration.signingKeys;
      this.lifecycle.validateCurrent(keys);
      await this.activeResolver.resolve();
      const publicKeys = keys.map((key) => Object.freeze({
        kty: 'RSA' as const,
        kid: key.kid,
        alg: 'RS256' as const,
        use: 'sig' as const,
        n: key.publicJwk.n as string,
        e: key.publicJwk.e as string
      })).sort((left, right) => left.kid < right.kid ? -1 : left.kid > right.kid ? 1 : 0);
      return Object.freeze({ keys: Object.freeze(publicKeys) });
    } catch {
      throw new BridgeJwksError();
    }
  }

  async findByKid(kid: string): Promise<BridgePublicJwk | undefined> {
    return (await this.document()).keys.find((key) => key.kid === kid);
  }
}

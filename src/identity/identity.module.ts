import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdentityGuard } from './identity.guard';
import { RemoteJwksInternalIdentityTokenVerifier } from './internal-identity-token-verifier';
import {
  INTERNAL_IDENTITY_CONFIG,
  INTERNAL_IDENTITY_TOKEN_VERIFIER,
  InternalIdentityConfig,
  validateInternalIdentityConfig
} from './identity-token.types';

@Module({
  providers: [
    {
      provide: INTERNAL_IDENTITY_CONFIG,
      useFactory: (configService: ConfigService): InternalIdentityConfig =>
        validateInternalIdentityConfig({
          issuer: configService.getOrThrow<string>('INTERNAL_IDENTITY_JWT_ISSUER'),
          audience: configService.getOrThrow<string>('INTERNAL_IDENTITY_JWT_AUDIENCE'),
          jwksUri: configService.getOrThrow<string>('INTERNAL_IDENTITY_JWKS_URI'),
          clockToleranceSeconds: configService.get<number>('INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS') ?? 0
        }),
      inject: [ConfigService]
    },
    {
      provide: INTERNAL_IDENTITY_TOKEN_VERIFIER,
      useFactory: (config: InternalIdentityConfig) => new RemoteJwksInternalIdentityTokenVerifier(config),
      inject: [INTERNAL_IDENTITY_CONFIG]
    },
    IdentityGuard
  ],
  exports: [IdentityGuard, INTERNAL_IDENTITY_CONFIG, INTERNAL_IDENTITY_TOKEN_VERIFIER]
})
export class IdentityModule {}

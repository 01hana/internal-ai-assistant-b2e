import { Module } from '@nestjs/common';
import { IdentityContextExtractor } from './identity-context.extractor';
import { IdentityGuard } from './identity.guard';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, JwksInternalIdentityTokenVerifier } from './internal-identity-token-verifier';

@Module({
  providers: [
    IdentityContextExtractor,
    IdentityGuard,
    JwksInternalIdentityTokenVerifier,
    { provide: INTERNAL_IDENTITY_TOKEN_VERIFIER, useExisting: JwksInternalIdentityTokenVerifier }
  ],
  exports: [IdentityContextExtractor, IdentityGuard, INTERNAL_IDENTITY_TOKEN_VERIFIER]
})
export class IdentityModule {}

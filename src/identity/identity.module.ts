import { Module } from '@nestjs/common';
import { IdentityContextExtractor } from './identity-context.extractor';
import { IdentityGuard } from './identity.guard';

@Module({
  providers: [IdentityContextExtractor, IdentityGuard],
  exports: [IdentityContextExtractor, IdentityGuard]
})
export class IdentityModule {}

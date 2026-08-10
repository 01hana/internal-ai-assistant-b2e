import { Module } from '@nestjs/common';
import { GatewaySigningKeyPersistenceModule } from '../signing/gateway-signing-key-persistence.module';
import { JwksController } from './jwks.controller';
import { JwksService } from './jwks.service';

@Module({
  imports: [GatewaySigningKeyPersistenceModule],
  controllers: [JwksController],
  providers: [JwksService],
  exports: [JwksService]
})
export class JwksModule {}

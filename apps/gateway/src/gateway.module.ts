import { Module } from '@nestjs/common';
import { ExternalIdentityService } from './external-identity.service';
import { GatewayAccessTokenGuard } from './gateway-access-token.guard';
import { GatewayConfigService } from './gateway-config.service';
import { GatewayController } from './gateway.controller';
import { InternalIdentityTokenService } from './internal-identity-token.service';

@Module({
  controllers: [GatewayController],
  providers: [GatewayConfigService, ExternalIdentityService, InternalIdentityTokenService, GatewayAccessTokenGuard]
})
export class GatewayModule {}

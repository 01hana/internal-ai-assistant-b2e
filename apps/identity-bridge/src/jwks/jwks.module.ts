import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { BridgeHealthModule } from '../health/bridge-health.module';
import { BridgeReadinessRegistry } from '../health/readiness.service';
import { JwksController } from './jwks.controller';
import { JwksService } from './jwks.service';
import { KeyLifecycleService } from './key-lifecycle.service';

@Injectable()
class JwksReadinessInitializer implements OnModuleInit {
  constructor(private readonly jwks: JwksService, private readonly readiness: BridgeReadinessRegistry) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.jwks.document();
      this.readiness.setReady('jwks', true);
    } catch {
      this.readiness.setReady('jwks', false);
    }
  }
}

@Module({
  imports: [ConfigurationModule, BridgeHealthModule],
  controllers: [JwksController],
  providers: [KeyLifecycleService, JwksService, JwksReadinessInitializer],
  exports: [KeyLifecycleService, JwksService]
})
export class JwksModule {}

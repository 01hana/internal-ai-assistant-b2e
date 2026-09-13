import { DynamicModule, Module } from '@nestjs/common';
import { ConnectorRuntimeConfigService } from '../config/runtime-configuration';
import { RuntimeHealthModule } from '../health/runtime-health.module';
import { ConnectorDestinationPolicy } from './connector-destination-policy';
import { SafeUpstreamHttpClient } from './safe-upstream-http-client';
import { UpstreamExecutionService } from './upstream-execution.service';
import { UpstreamReadinessInitializer } from './upstream-readiness.initializer';

@Module({})
export class UpstreamModule {
 static register(manifestModule: DynamicModule): DynamicModule { return {
  module: UpstreamModule,
  imports: [RuntimeHealthModule, manifestModule],
  providers: [
    { provide: ConnectorDestinationPolicy, useFactory: (config: ConnectorRuntimeConfigService) => {
      try { return new ConnectorDestinationPolicy(config.validation.ok ? config.validation.config.upstreams : [], String(process.env.NODE_ENV ?? 'production')); }
      catch { return new ConnectorDestinationPolicy([], 'production'); }
    }, inject: [ConnectorRuntimeConfigService] },
    SafeUpstreamHttpClient,
    { provide: UpstreamExecutionService, useFactory: (policy: ConnectorDestinationPolicy, client: SafeUpstreamHttpClient) => new UpstreamExecutionService(policy, client), inject: [ConnectorDestinationPolicy, SafeUpstreamHttpClient] },
    UpstreamReadinessInitializer
  ],
  exports: [ConnectorDestinationPolicy, UpstreamExecutionService]
 }; }
}

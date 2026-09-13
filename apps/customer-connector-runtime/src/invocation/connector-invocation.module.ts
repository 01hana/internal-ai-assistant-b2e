import { DynamicModule, Module } from '@nestjs/common';
import { ConnectorBindingService } from '../bindings/connector-binding.service';
import { CredentialExecutionBoundary } from '../credentials/credential-execution.boundary';
import { RuntimeHealthModule } from '../health/runtime-health.module';
import { OperationManifestRegistry } from '../manifest/operation-manifest.registry';
import { ServiceAuthModule } from '../service-auth/service-auth.module';
import { ExactRawBodyAuthenticator } from '../service-auth/exact-raw-body.authenticator';
import { UpstreamExecutionService } from '../upstream/upstream-execution.service';
import { ConnectorInvocationController } from './connector-invocation.controller';
import { ConnectorInvocationService } from './connector-invocation.service';
import { InvocationReadinessInitializer } from './invocation-readiness.initializer';
import { InvocationMonotonicClock } from './invocation-deadline';

@Module({})
export class ConnectorInvocationModule {
  static register(bindingModule: DynamicModule, manifestModule: DynamicModule, upstreamModule: DynamicModule): DynamicModule {
    return {
      module: ConnectorInvocationModule,
      imports: [RuntimeHealthModule, ServiceAuthModule, bindingModule, manifestModule, upstreamModule],
      controllers: [ConnectorInvocationController],
      providers: [
        InvocationMonotonicClock,
        { provide: ConnectorInvocationService, useFactory: (
          authenticator: ExactRawBodyAuthenticator, bindings: ConnectorBindingService, manifests: OperationManifestRegistry,
          credentials: CredentialExecutionBoundary, upstream: UpstreamExecutionService, clock: InvocationMonotonicClock
        ) => new ConnectorInvocationService(authenticator, bindings, manifests, credentials, upstream, () => clock.nowMilliseconds()),
        inject: [ExactRawBodyAuthenticator, ConnectorBindingService, OperationManifestRegistry, CredentialExecutionBoundary, UpstreamExecutionService, InvocationMonotonicClock] },
        InvocationReadinessInitializer
      ]
    };
  }
}

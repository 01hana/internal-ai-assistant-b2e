import { DynamicModule, Module } from '@nestjs/common';
import { RuntimeConfigurationModule } from './config/configuration.module';
import { ServiceAuthModule } from './service-auth/service-auth.module';
import { ConnectorBindingModule } from './bindings/connector-binding.module';
import type { BindingBootstrapProvider } from './bindings/binding-bootstrap-provider';
import { OperationManifestModule } from './manifest/operation-manifest.module';
import type { CredentialApplicationStrategy, CredentialProvider } from './credentials/credential.types';
import { UpstreamModule } from './upstream/upstream.module';
import { ConnectorInvocationModule } from './invocation/connector-invocation.module';

export interface Phase5RuntimeRegistrations {
  readonly credentialProviders?: readonly CredentialProvider[];
  readonly credentialStrategies?: readonly CredentialApplicationStrategy[];
}

@Module({})
export class CustomerConnectorRuntimeModule {
  static forEnvironment(
    environment: Record<string, unknown> = process.env,
    providers: readonly BindingBootstrapProvider[] = [],
    phase5: Phase5RuntimeRegistrations = {}
  ): DynamicModule {
    const bindingModule = ConnectorBindingModule.register(providers);
    const manifestModule = OperationManifestModule.register(phase5.credentialProviders, phase5.credentialStrategies);
    const upstreamModule = UpstreamModule.register(manifestModule);
    return {
      module: CustomerConnectorRuntimeModule,
      imports: [
        RuntimeConfigurationModule.forEnvironment(environment),
        ServiceAuthModule,
        ConnectorInvocationModule.register(bindingModule, manifestModule, upstreamModule)
      ]
    };
  }
}

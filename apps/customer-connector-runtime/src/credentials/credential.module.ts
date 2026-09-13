import { DynamicModule, Module } from '@nestjs/common';
import { ConnectorRuntimeConfigService } from '../config/runtime-configuration';
import { CredentialProfileRegistry } from './credential-profile.registry';
import type { CredentialApplicationStrategy, CredentialProvider } from './credential.types';
import { CredentialExecutionBoundary } from './credential-execution.boundary';

const CREDENTIAL_PROVIDERS = Symbol('CREDENTIAL_PROVIDERS');
const CREDENTIAL_STRATEGIES = Symbol('CREDENTIAL_STRATEGIES');

@Module({})
export class CredentialModule {
  static register(providers: readonly CredentialProvider[] = [], strategies: readonly CredentialApplicationStrategy[] = []): DynamicModule {
    return {
      module: CredentialModule,
      providers: [
        { provide: CREDENTIAL_PROVIDERS, useValue: Object.freeze([...providers]) },
        { provide: CREDENTIAL_STRATEGIES, useValue: Object.freeze([...strategies]) },
        {
          provide: CredentialProfileRegistry,
          useFactory: (config: ConnectorRuntimeConfigService, values: readonly CredentialProvider[], applications: readonly CredentialApplicationStrategy[]) =>
            new CredentialProfileRegistry(config.validation.ok ? config.validation.config.credentialProfiles : [], values, applications),
          inject: [ConnectorRuntimeConfigService, CREDENTIAL_PROVIDERS, CREDENTIAL_STRATEGIES]
        },
        { provide: CredentialExecutionBoundary, useFactory: (profiles: CredentialProfileRegistry) => new CredentialExecutionBoundary(profiles), inject: [CredentialProfileRegistry] }
      ],
      exports: [CredentialProfileRegistry, CredentialExecutionBoundary]
    };
  }
}

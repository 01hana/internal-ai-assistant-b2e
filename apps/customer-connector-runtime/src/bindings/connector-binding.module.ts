import { DynamicModule, Module } from '@nestjs/common';
import { ConnectorRuntimeConfigService } from '../config/runtime-configuration';
import { RuntimeHealthModule } from '../health/runtime-health.module';
import { ServiceAuthModule } from '../service-auth/service-auth.module';
import { ExactRawBodyAuthenticator } from '../service-auth/exact-raw-body.authenticator';
import { BindingBootstrapProviderRegistry } from './binding-bootstrap-provider.registry';
import type { BindingBootstrapProvider } from './binding-bootstrap-provider';
import { BindingLifecycleManager } from './binding-lifecycle.manager';
import { BindingReadinessInitializer } from './binding-readiness.initializer';
import { ConnectorBindingController } from './connector-binding.controller';
import { ConnectorBindingRequestService } from './connector-binding-request.service';
import { ConnectorBindingService } from './connector-binding.service';
import { InMemoryConnectorBindingStore } from './in-memory-connector-binding.store';

const BINDING_BOOTSTRAP_PROVIDERS = Symbol('BINDING_BOOTSTRAP_PROVIDERS');

@Module({})
export class ConnectorBindingModule {
  static register(providers: readonly BindingBootstrapProvider[] = []): DynamicModule {
    return {
      module: ConnectorBindingModule,
      imports: [ServiceAuthModule, RuntimeHealthModule],
      controllers: [ConnectorBindingController],
      providers: [
        { provide: BINDING_BOOTSTRAP_PROVIDERS, useValue: Object.freeze([...providers]) },
        {
          provide: BindingBootstrapProviderRegistry,
          useFactory: (config: ConnectorRuntimeConfigService, values: readonly BindingBootstrapProvider[]) =>
            new BindingBootstrapProviderRegistry(config.validation.ok ? config.validation.config : undefined, values),
          inject: [ConnectorRuntimeConfigService, BINDING_BOOTSTRAP_PROVIDERS]
        },
        {
          provide: InMemoryConnectorBindingStore,
          useFactory: (config: ConnectorRuntimeConfigService) => new InMemoryConnectorBindingStore(config.validation.ok
            ? {
                maxEntries: config.validation.config.bindingStoreMaxEntries,
                scopeMaxEntries: config.validation.config.bindingScopeMaxEntries,
                sweepBatchSize: config.validation.config.bindingSweepBatchSize
              }
            : { maxEntries: 1, scopeMaxEntries: 1, sweepBatchSize: 1 }),
          inject: [ConnectorRuntimeConfigService]
        },
        {
          provide: ConnectorBindingService,
          useFactory: (store: InMemoryConnectorBindingStore, registry: BindingBootstrapProviderRegistry) =>
            new ConnectorBindingService(store, registry),
          inject: [InMemoryConnectorBindingStore, BindingBootstrapProviderRegistry]
        },
        {
          provide: ConnectorBindingRequestService,
          useFactory: (authenticator: ExactRawBodyAuthenticator, registry: BindingBootstrapProviderRegistry, bindings: ConnectorBindingService) =>
            new ConnectorBindingRequestService(authenticator, registry, bindings),
          inject: [ExactRawBodyAuthenticator, BindingBootstrapProviderRegistry, ConnectorBindingService]
        },
        BindingLifecycleManager,
        BindingReadinessInitializer
      ],
      exports: [ConnectorBindingService]
    };
  }
}

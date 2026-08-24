import { Module } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { IntegrationBindingRepository } from '../integration-registry/integration-binding.repository';
import { TrustProfileRepository } from '../integration-registry/trust-profile.repository';
import { GATEWAY_PRISMA_CLIENT, GatewaySigningKeyPersistenceModule } from '../signing/gateway-signing-key-persistence.module';
import { SigningKeyProvider } from '../signing/signing-key-provider';
import { IntegrationAdmissionService } from './admission/integration-admission.service';
import { ManagedCanonicalizationService } from './canonicalization/managed-canonicalization.service';
import { ManagedIdentityExchangeController } from './exchange.controller';
import { ManagedIdentityExchangeService } from './exchange.service';
import { ManagedJwksController } from './issuer/managed-jwks.controller';
import { ManagedJwksService } from './issuer/managed-jwks.service';
import { ManagedSigningKeyRuntimeProvider } from './issuer/managed-signing-key.provider';
import { ManagedUpstreamTokenIssuer } from './issuer/managed-upstream-token-issuer';
import { ManagedPermissionScopeProjector } from './permissions/managed-permission-scope.projector';
import { ManagedPermissionService } from './permissions/managed-permission.service';
import { PermissionNormalizerRegistry } from './permissions/permission-normalizer.registry';
import { PermissionSourceAdapterRegistry } from './permissions/permission-source-adapter.registry';
import { SyntheticV1PermissionNormalizer } from './permissions/synthetic-v1-permission.normalizer';
import { ManagedExchangeAuditWriter } from './persistence/managed-exchange-audit.writer';
import { createManagedExchangeReadinessValidator } from './persistence/managed-exchange-readiness.composition';
import { ManagedExchangeReadinessValidator } from './persistence/managed-exchange-readiness.validator';
import {
  ManagedExchangeAuditRepository, ManagedIdentityProviderInstanceRepository,
  ManagedIntegrationAdmissionPolicyRepository, ManagedIntegrationExchangeConfigRepository,
  ManagedPermissionPolicyRepository, ManagedPermissionSourceInstanceRepository,
  ManagedUpstreamIssuerRepository, ManagedUpstreamSigningKeyRepository
} from './persistence/managed-exchange.repository';
import { DelegatedHttpTransport } from './providers/delegated-http.transport';
import { DelegatedHttpV1Adapter } from './providers/delegated-http-v1.adapter';
import { IdentityProviderAdapterRegistry } from './providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from './providers/idx-delegated-verification.adapter';

@Module({
  imports: [GatewaySigningKeyPersistenceModule],
  controllers: [ManagedIdentityExchangeController, ManagedJwksController],
  providers: [
    {
      provide: IntegrationBindingRepository,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new IntegrationBindingRepository(client)
    },
    {
      provide: TrustProfileRepository,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new TrustProfileRepository(client)
    },
    ...[
      ManagedIdentityProviderInstanceRepository, ManagedIntegrationExchangeConfigRepository,
      ManagedIntegrationAdmissionPolicyRepository, ManagedPermissionSourceInstanceRepository,
      ManagedPermissionPolicyRepository, ManagedUpstreamIssuerRepository,
      ManagedUpstreamSigningKeyRepository, ManagedExchangeAuditRepository
    ].map((repository) => ({
      provide: repository,
      inject: [GATEWAY_PRISMA_CLIENT],
      useFactory: (client: PrismaClient) => new repository(client as never)
    })),
    DelegatedHttpTransport,
    {
      provide: DelegatedHttpV1Adapter,
      inject: [DelegatedHttpTransport],
      useFactory: (transport: DelegatedHttpTransport) => new DelegatedHttpV1Adapter(transport)
    },
    IdxDelegatedVerificationAdapter,
    {
      provide: IdentityProviderAdapterRegistry,
      inject: [DelegatedHttpV1Adapter, IdxDelegatedVerificationAdapter],
      useFactory: (delegated: DelegatedHttpV1Adapter, idx: IdxDelegatedVerificationAdapter) => new IdentityProviderAdapterRegistry(delegated, idx)
    },
    {
      provide: PermissionSourceAdapterRegistry,
      useFactory: () => new PermissionSourceAdapterRegistry([])
    },
    SyntheticV1PermissionNormalizer,
    {
      provide: PermissionNormalizerRegistry,
      inject: [SyntheticV1PermissionNormalizer],
      useFactory: (normalizer: SyntheticV1PermissionNormalizer) => new PermissionNormalizerRegistry([normalizer])
    },
    ManagedPermissionScopeProjector,
    {
      provide: ManagedExchangeReadinessValidator,
      inject: [IntegrationBindingRepository, ManagedIntegrationExchangeConfigRepository, ManagedIdentityProviderInstanceRepository, ManagedIntegrationAdmissionPolicyRepository, ManagedPermissionPolicyRepository, ManagedPermissionSourceInstanceRepository, ManagedUpstreamIssuerRepository, ManagedUpstreamSigningKeyRepository, TrustProfileRepository, PermissionSourceAdapterRegistry, PermissionNormalizerRegistry],
      useFactory: (bindings: IntegrationBindingRepository, configs: ManagedIntegrationExchangeConfigRepository, providers: ManagedIdentityProviderInstanceRepository, admissions: ManagedIntegrationAdmissionPolicyRepository, permissionPolicies: ManagedPermissionPolicyRepository, permissionSources: ManagedPermissionSourceInstanceRepository, issuers: ManagedUpstreamIssuerRepository, signingKeys: ManagedUpstreamSigningKeyRepository, trustProfiles: TrustProfileRepository, permissionAdapters: PermissionSourceAdapterRegistry, permissionNormalizers: PermissionNormalizerRegistry) => createManagedExchangeReadinessValidator({ bindings, configs, providers, admissions, permissionPolicies, permissionSources, issuers, signingKeys, trustProfiles, permissionAdapters, permissionNormalizers })
    },
    {
      provide: IntegrationAdmissionService,
      inject: [ManagedIntegrationAdmissionPolicyRepository],
      useFactory: (policies: ManagedIntegrationAdmissionPolicyRepository) => new IntegrationAdmissionService(policies)
    },
    {
      provide: ManagedCanonicalizationService,
      inject: [ManagedIntegrationExchangeConfigRepository],
      useFactory: (configs: ManagedIntegrationExchangeConfigRepository) => new ManagedCanonicalizationService(configs)
    },
    {
      provide: ManagedPermissionService,
      inject: [ManagedPermissionSourceInstanceRepository, PermissionSourceAdapterRegistry, PermissionNormalizerRegistry, ManagedPermissionScopeProjector],
      useFactory: (permissionSources: ManagedPermissionSourceInstanceRepository, permissionAdapters: PermissionSourceAdapterRegistry, permissionNormalizers: PermissionNormalizerRegistry, projector: ManagedPermissionScopeProjector) => new ManagedPermissionService({ permissionSources, permissionAdapters, permissionNormalizers, projector })
    },
    SigningKeyProvider,
    {
      provide: ManagedSigningKeyRuntimeProvider,
      inject: [ManagedUpstreamIssuerRepository, ManagedUpstreamSigningKeyRepository, SigningKeyProvider],
      useFactory: (issuers: ManagedUpstreamIssuerRepository, signingKeys: ManagedUpstreamSigningKeyRepository, keyLoader: SigningKeyProvider) => new ManagedSigningKeyRuntimeProvider({ issuers, signingKeys, keyLoader })
    },
    {
      provide: ManagedUpstreamTokenIssuer,
      inject: [ManagedSigningKeyRuntimeProvider],
      useFactory: (signingKeys: ManagedSigningKeyRuntimeProvider) => new ManagedUpstreamTokenIssuer(signingKeys)
    },
    {
      provide: ManagedJwksService,
      inject: [ManagedUpstreamIssuerRepository, ManagedUpstreamSigningKeyRepository],
      useFactory: (issuers: ManagedUpstreamIssuerRepository, signingKeys: ManagedUpstreamSigningKeyRepository) => new ManagedJwksService({ issuers, signingKeys })
    },
    {
      provide: ManagedExchangeAuditWriter,
      inject: [ManagedExchangeAuditRepository],
      useFactory: (repository: ManagedExchangeAuditRepository) => new ManagedExchangeAuditWriter(repository)
    },
    {
      provide: ManagedIdentityExchangeService,
      inject: [ManagedIntegrationExchangeConfigRepository, ManagedIdentityProviderInstanceRepository, ManagedExchangeReadinessValidator, IdentityProviderAdapterRegistry, IntegrationAdmissionService, ManagedPermissionPolicyRepository, ManagedPermissionService, ManagedCanonicalizationService, ManagedUpstreamTokenIssuer, ManagedExchangeAuditWriter],
      useFactory: (configs: ManagedIntegrationExchangeConfigRepository, providers: ManagedIdentityProviderInstanceRepository, readiness: ManagedExchangeReadinessValidator, providerAdapters: IdentityProviderAdapterRegistry, admission: IntegrationAdmissionService, permissionPolicies: ManagedPermissionPolicyRepository, permissions: ManagedPermissionService, canonicalizer: ManagedCanonicalizationService, issuer: ManagedUpstreamTokenIssuer, audit: ManagedExchangeAuditWriter) => new ManagedIdentityExchangeService({ configs, providers, readiness, providerAdapters, admission, permissionPolicies, permissions, canonicalizer, issuer, audit })
    }
  ],
  exports: [ManagedIdentityExchangeService, ManagedExchangeAuditWriter, ManagedJwksService]
})
export class ManagedIdentityExchangeModule {}

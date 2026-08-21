import type { PermissionNormalizerRegistry, PermissionSourceAdapterRegistry } from '../domain/managed-exchange.domain';
import { IntegrationBindingRepository } from '../../integration-registry/integration-binding.repository';
import { TrustProfileRepository } from '../../integration-registry/trust-profile.repository';
import {
  ManagedIdentityProviderInstanceRepository, ManagedIntegrationAdmissionPolicyRepository,
  ManagedIntegrationExchangeConfigRepository, ManagedPermissionPolicyRepository,
  ManagedPermissionSourceInstanceRepository, ManagedUpstreamIssuerRepository,
  ManagedUpstreamSigningKeyRepository
} from './managed-exchange.repository';
import { ManagedExchangeReadinessValidator } from './managed-exchange-readiness.validator';

/** Actual Feature 005 read composition. All repository calls are active-only reads. */
export function createManagedExchangeReadinessValidator(input: Readonly<{
  bindings: IntegrationBindingRepository;
  configs: ManagedIntegrationExchangeConfigRepository;
  providers: ManagedIdentityProviderInstanceRepository;
  admissions: ManagedIntegrationAdmissionPolicyRepository;
  permissionPolicies: ManagedPermissionPolicyRepository;
  permissionSources: ManagedPermissionSourceInstanceRepository;
  issuers: ManagedUpstreamIssuerRepository;
  signingKeys: ManagedUpstreamSigningKeyRepository;
  trustProfiles: TrustProfileRepository;
  permissionAdapters: PermissionSourceAdapterRegistry;
  permissionNormalizers: PermissionNormalizerRegistry;
}>): ManagedExchangeReadinessValidator {
  return new ManagedExchangeReadinessValidator({
    findBinding: async (integrationId) => {
      const binding = await input.bindings.findByIntegrationId(integrationId);
      return binding ? Object.freeze({ enabled: binding.enabled }) : null;
    },
    findEnabledActiveConfigsByIntegrationId: (integrationId) => input.configs.findEnabledActiveByIntegrationId(integrationId),
    findEnabledActiveProviderById: (id) => input.providers.findEnabledActiveById(id),
    findEnabledActiveAdmissionPoliciesByConfigId: (configId) => input.admissions.findEnabledActiveByConfigId(configId),
    findEnabledActivePermissionPoliciesByConfigId: (configId) => input.permissionPolicies.findEnabledActiveByConfigId(configId),
    findEnabledActivePermissionSourceById: (id) => input.permissionSources.findEnabledActiveById(id),
    hasPermissionAdapter: (type) => Boolean(input.permissionAdapters.resolve(type)),
    hasPermissionNormalizer: (type) => Boolean(input.permissionNormalizers.resolve(type)),
    findEnabledActiveIssuers: () => input.issuers.findEnabledActive(),
    findEnabledActiveSigningKeysByIssuerId: (issuerId) => input.signingKeys.findEnabledActiveByIssuerId(issuerId),
    findTrustProfiles: (integrationId) => input.trustProfiles.findEnabledActiveByIntegrationId(integrationId)
  });
}

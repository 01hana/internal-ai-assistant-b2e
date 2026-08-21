import { ManagedExchangeActivationValidator } from '../managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { ManagedPermissionSourceInstanceRepository } from '../managed-identity-exchange/persistence/managed-exchange.repository';
import type { PermissionNormalizerRegistry, PermissionSourceAdapterRegistry } from '../managed-identity-exchange/domain/managed-exchange.domain';
import { VersionedManagedExchangeProvisionCommand } from './managed-exchange-control-plane';

/** Direct-only policy provisioning. A configured source is never inferred to be active. */
export class ProvisionManagedPermissionPolicyCommand extends VersionedManagedExchangeProvisionCommand {
  constructor(dependencies: Omit<ConstructorParameters<typeof VersionedManagedExchangeProvisionCommand>[0], 'kind' | 'validator'> & Readonly<{
    permissionSources: ManagedPermissionSourceInstanceRepository;
    permissionAdapters: PermissionSourceAdapterRegistry;
    permissionNormalizers: PermissionNormalizerRegistry;
    activationValidator?: ManagedExchangeActivationValidator;
  }>) {
    const validator = dependencies.activationValidator ?? new ManagedExchangeActivationValidator();
    super({
      kind: 'permission', repository: dependencies.repository, audit: dependencies.audit, invalidation: dependencies.invalidation,
      validator: async (input) => {
        const sourceId = sourceIdOf(input.permissionSourceInstanceId);
        if (!sourceId) return validator.validatePermissionPolicy(input, false);
        const source = await dependencies.permissionSources.findEnabledActiveById(sourceId);
        if (!source) throw new Error('configured permission source is not active');
        validator.validatePermissionSource(source);
        if (!dependencies.permissionAdapters.resolve(source.sourceType)) throw new Error('permission adapter unavailable');
        validator.validatePermissionPolicy(input, true);
        const normalizerType = input.normalizerType;
        if (typeof normalizerType !== 'string' || !normalizerType.trim() || !dependencies.permissionNormalizers.resolve(normalizerType)) {
          throw new Error('permission normalizer unavailable');
        }
      }
    });
  }
}

function sourceIdOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('invalid permission source id');
  return value.trim();
}

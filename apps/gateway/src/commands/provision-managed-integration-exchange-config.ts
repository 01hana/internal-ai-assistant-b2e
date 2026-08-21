import { ManagedExchangeProvisionError, VersionedManagedExchangeProvisionCommand, serverGeneratedSelector, type ControlPlaneAudit, type ManagedExchangeInvalidationHook } from './managed-exchange-control-plane';
import type { ManagedIntegrationExchangeConfigActivationValidator } from '../managed-identity-exchange/persistence/managed-integration-exchange-config-activation.validator';
import type { ManagedExchangeLifecycleRepository } from '../managed-identity-exchange/persistence/managed-exchange.repository';

export interface ManagedIntegrationConfigLifecycle {
  create(input: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;
  replace(input: Readonly<{ predecessorId: string; requestId: string; successor: Record<string, unknown> }>): Promise<Record<string, unknown>>;
  disable(input: Readonly<{ id: string; requestId: string }>): Promise<Record<string, unknown>>;
}
type ConfigInput = Readonly<Record<string, unknown>>;

/** Fixed config-only bridge; callers cannot supply a generic kind or bypass validator. */
export function createManagedIntegrationConfigLifecycle(dependencies: Readonly<{ repository: ManagedExchangeLifecycleRepository; audit: ControlPlaneAudit; invalidation: ManagedExchangeInvalidationHook; activationValidator: Pick<ManagedIntegrationExchangeConfigActivationValidator, 'validate'> }>): ManagedIntegrationConfigLifecycle {
  const command = new VersionedManagedExchangeProvisionCommand({
    kind: 'config', repository: dependencies.repository, audit: dependencies.audit, invalidation: dependencies.invalidation,
    validator: async (input) => dependencies.activationValidator.validate(withoutGeneratedSelector(input))
  });
  return Object.freeze({
    create: (input: Readonly<Record<string, unknown>>) => command.create(input),
    replace: (input: Readonly<{ predecessorId: string; requestId: string; successor: Record<string, unknown> }>) => command.replace(input),
    disable: (input: Readonly<{ id: string; requestId: string }>) => command.disable(input)
  });
}

/** Direct-only config lifecycle. Composition intentionally hides generic create/replace. */
export class ProvisionManagedIntegrationExchangeConfigCommand {
  constructor(private readonly lifecycle: ManagedIntegrationConfigLifecycle, private readonly activationValidator: Pick<ManagedIntegrationExchangeConfigActivationValidator, 'validate'>) {}
  async createConfig(input: ConfigInput): Promise<Record<string, unknown>> {
    rejectAuthorityFields(input); await this.activationValidator.validate(input); return this.lifecycle.create({ ...input, publicSelector: serverGeneratedSelector() });
  }
  async replaceConfig(input: Readonly<{ predecessorId: string; requestId: string; successor: ConfigInput }>): Promise<Record<string, unknown>> {
    rejectAuthorityFields(input.successor);
    await this.activationValidator.validate(input.successor);
    return this.lifecycle.replace({ predecessorId: input.predecessorId, requestId: input.requestId, successor: { ...input.successor, publicSelector: serverGeneratedSelector() } });
  }
  disableConfig(input: Readonly<{ id: string; requestId: string }>): Promise<Record<string, unknown>> { return this.lifecycle.disable(input); }
}
function rejectAuthorityFields(input: ConfigInput): void { if (['publicSelector', 'version', 'enabled', 'lifecycle', 'replacesConfigId'].some((field) => field in input)) throw new ManagedExchangeProvisionError(); }
function withoutGeneratedSelector(input: Record<string, unknown>): Record<string, unknown> { const { publicSelector: _publicSelector, ...payload } = input; return payload; }

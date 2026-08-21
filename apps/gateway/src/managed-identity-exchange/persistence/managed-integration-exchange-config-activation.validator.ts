import { ManagedExchangeActivationError } from './managed-exchange-activation.validator';

export type ConfigActivationDependencies = Readonly<{
  findBinding(integrationId: string): Promise<Readonly<{ enabled: boolean }> | null>;
  findProvider(id: string): Promise<Readonly<{ enabled: boolean; lifecycle: string }> | null>;
}>;

/** Server-side structural validation only; it never resolves a Customer. */
export class ManagedIntegrationExchangeConfigActivationValidator {
  constructor(private readonly dependencies: ConfigActivationDependencies) {}
  async validate(input: Readonly<Record<string, unknown>>): Promise<void> {
    if (['customerId', 'publicSelector', 'version', 'enabled', 'lifecycle', 'replacesConfigId', 'browserHostApp', 'browserOrganizationId'].some((key) => key in input)) throw new ManagedExchangeActivationError();
    const integrationId = text(input.integrationId); const providerInstanceId = text(input.providerInstanceId); text(input.canonicalHostApp);
    const binding = await this.dependencies.findBinding(integrationId);
    const provider = await this.dependencies.findProvider(providerInstanceId);
    if (!binding?.enabled || !provider?.enabled || provider.lifecycle !== 'active') throw new ManagedExchangeActivationError();
    if (input.organizationMode === 'verified') { if (input.fixedOrganizationId !== null && input.fixedOrganizationId !== undefined) throw new ManagedExchangeActivationError(); return; }
    if (input.organizationMode !== 'fixed_single_organization' || !textMaybe(input.fixedOrganizationId)) throw new ManagedExchangeActivationError();
  }
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new ManagedExchangeActivationError(); return value.trim(); }
function textMaybe(value: unknown): string | null { return value === null || value === undefined ? null : text(value); }

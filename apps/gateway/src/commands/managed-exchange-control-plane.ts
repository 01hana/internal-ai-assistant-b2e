import { randomUUID } from 'node:crypto';
import { ManagedExchangeActivationError, ManagedExchangeActivationValidator } from '../managed-identity-exchange/persistence/managed-exchange-activation.validator';
import type { ManagedExchangeLifecycleKind, ManagedExchangeLifecycleRepository } from '../managed-identity-exchange/persistence/managed-exchange.repository';

export type ManagedExchangeControlPlaneError = Error & Readonly<{ committed: boolean }>;
export class ManagedExchangeProvisionError extends Error {
  readonly committed: boolean = false;
  constructor() { super('Managed exchange provisioning cannot be completed.'); }
}
export class ManagedExchangeProvisionPostCommitError extends ManagedExchangeProvisionError {
  override readonly committed: boolean = true;
}
export interface ManagedExchangeInvalidationHook { invalidate(id: string): Promise<void>; }
export type ControlPlaneAudit = Readonly<{ append(input: Readonly<{ requestId: string; outcome: 'success'; reasonCode: string }>): Promise<void> }>;

/** Real repository-backed lifecycle: authority data is immutable once active. */
export class VersionedManagedExchangeProvisionCommand {
  constructor(private readonly dependencies: Readonly<{ kind: ManagedExchangeLifecycleKind; repository: ManagedExchangeLifecycleRepository; validator: (input: Record<string, unknown>) => void | Promise<void>; audit: ControlPlaneAudit; invalidation: ManagedExchangeInvalidationHook }>) {}
  async create(input: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> { return this.mutate('create', input); }
  async disable(input: Readonly<{ id: string; requestId: string }>): Promise<Record<string, unknown>> { return this.mutate('disable', input); }
  async replace(input: Readonly<{ predecessorId: string; requestId: string; successor: Record<string, unknown> }>): Promise<Record<string, unknown>> { return this.mutate('replace', input); }
  private async mutate(action: 'create' | 'disable' | 'replace', input: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const requestId = text(input.requestId); let result: Record<string, unknown>;
    try {
      result = await this.dependencies.repository.transaction(async (transaction) => {
        if (action === 'disable') return this.dependencies.repository.disable(this.dependencies.kind, text(input.id), transaction);
        const successor = action === 'replace' ? input.successor : input;
        if (!successor || typeof successor !== 'object') throw new ManagedExchangeProvisionError();
        await this.dependencies.validator(successor as Record<string, unknown>);
        if (action === 'create') return this.dependencies.repository.create(this.dependencies.kind, serverOwnedCreate(this.dependencies.kind, withoutControl(successor as Record<string, unknown>)), transaction);
        return this.dependencies.repository.replace(this.dependencies.kind, text(input.predecessorId), withoutControl(successor as Record<string, unknown>), transaction);
      });
    } catch { throw new ManagedExchangeProvisionError(); }
    const outcomes = await Promise.allSettled([this.dependencies.audit.append({ requestId, outcome: 'success', reasonCode: action }), this.dependencies.invalidation.invalidate(text(result.id))]);
    if (outcomes.some((outcome) => outcome.status === 'rejected')) throw new ManagedExchangeProvisionPostCommitError();
    return Object.freeze(result);
  }
}

export function serverGeneratedSelector(): string { return `mie_${randomUUID().replace(/-/g, '')}`; }
export function controlPlaneValidator(kind: 'provider' | 'admission' | 'source' | 'permission' | 'issuer' | 'key', validator = new ManagedExchangeActivationValidator()): (input: Record<string, unknown>) => void {
  return (input) => {
    if (kind === 'provider') validator.validateProvider(input, false);
    else if (kind === 'admission') validator.validateAdmission(input.anchorRequirements);
    else if (kind === 'source') validator.validatePermissionSource(input);
    else if (kind === 'permission') validator.validatePermissionPolicy(input, input.permissionSourceInstanceId !== null && input.permissionSourceInstanceId !== undefined);
    else if (kind === 'issuer') validator.validateIssuer(input);
    else validator.validateSigningKey(input);
  };
}
function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new ManagedExchangeProvisionError(); return value.trim(); }
function withoutControl(input: Record<string, unknown>): Record<string, unknown> { const { requestId: _requestId, action: _action, predecessorId: _predecessorId, successor: _successor, ...data } = input; return data; }
function serverOwnedCreate(kind: ManagedExchangeLifecycleKind, input: Record<string, unknown>): Record<string, unknown> {
  const replacement = ({ provider: 'replacesProviderId', config: 'replacesConfigId', admission: 'replacesPolicyId', source: 'replacesSourceId', permission: 'replacesPolicyId', issuer: 'replacesIssuerId', key: 'replacesKeyId' } as const)[kind];
  if (['version', 'enabled', 'lifecycle', replacement].some((field) => field in input)) throw new ManagedExchangeProvisionError();
  return { ...input, version: 1, enabled: true, lifecycle: 'active', [replacement]: null };
}

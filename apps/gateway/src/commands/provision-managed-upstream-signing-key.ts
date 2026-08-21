import { ManagedExchangeActivationValidator } from '../managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { GatewaySigningAuthorityReader } from '../managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { ManagedExchangeLifecycleRepository, type ManagedExchangeTransaction } from '../managed-identity-exchange/persistence/managed-exchange.repository';
import { ManagedExchangeProvisionError, ManagedExchangeProvisionPostCommitError, type ControlPlaneAudit, type ManagedExchangeInvalidationHook } from './managed-exchange-control-plane';

type KeyStatus = 'new' | 'published' | 'active' | 'retiring' | 'retired';
type KeyInput = Readonly<Record<string, unknown>>;

/** Direct-only managed-key command. Lifecycle storage remains in the shared managed lifecycle repository. */
export class ProvisionManagedUpstreamSigningKeyCommand {
  constructor(private readonly dependencies: Readonly<{
    repository: ManagedExchangeLifecycleRepository;
    audit: ControlPlaneAudit;
    invalidation: ManagedExchangeInvalidationHook;
    gatewaySigningAuthority: GatewaySigningAuthorityReader;
    activationValidator?: ManagedExchangeActivationValidator;
  }>) {}

  registerKey(input: KeyInput): Promise<Record<string, unknown>> {
    return this.mutate(input, async (transaction, clean) => this.dependencies.repository.create('key', { ...clean, status: 'new', enabled: false, lifecycle: 'draft', version: 1, replacesKeyId: null }, transaction));
  }

  transitionKey(input: Readonly<{ id: string; to: KeyStatus; requestId: string }>): Promise<Record<string, unknown>> {
    if (!isTransition(input.to)) return Promise.reject(new ManagedExchangeProvisionError());
    return this.mutate(input, async (transaction) => {
      const id = required(input.id);
      if (input.to === 'active') await this.assertActivationEligible(id, transaction);
      return this.dependencies.repository.transitionSigningKey(id, previous(input.to), input.to, transaction);
    });
  }

  disableKey(input: Readonly<{ id: string; requestId: string }>): Promise<Record<string, unknown>> {
    return this.mutate(input, (transaction) => this.dependencies.repository.transitionSigningKey(required(input.id), 'active', 'retiring', transaction));
  }

  replaceKey(input: Readonly<{ predecessorId: string; requestId: string; successor: KeyInput }>): Promise<Record<string, unknown>> {
    return this.mutate(input, async (transaction) => {
      const successor = cleanKey(input.successor);
      await this.validate(successor);
      return this.dependencies.repository.replaceSigningKey(required(input.predecessorId), successor, transaction);
    });
  }

  private async mutate(input: Readonly<Record<string, unknown>>, operation: (transaction: ManagedExchangeTransaction, clean: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const { requestId: rawRequestId, ...payload } = input;
    const requestId = required(rawRequestId); let result: Record<string, unknown>;
    try {
      result = await this.dependencies.repository.transaction(async (transaction) => {
        const validatesRegistration = !('successor' in payload) && !('id' in payload);
        const clean = validatesRegistration ? cleanKey(payload) : {};
        if (validatesRegistration) await this.validate(clean);
        return operation(transaction, clean);
      });
    } catch { throw new ManagedExchangeProvisionError(); }
    const after = await Promise.allSettled([this.dependencies.audit.append({ requestId, outcome: 'success', reasonCode: 'managed_signing_key' }), this.dependencies.invalidation.invalidate(required(result.id))]);
    if (after.some((item) => item.status === 'rejected')) throw new ManagedExchangeProvisionPostCommitError();
    return Object.freeze(result);
  }

  private async validate(input: Record<string, unknown>): Promise<void> {
    (this.dependencies.activationValidator ?? new ManagedExchangeActivationValidator()).validateSigningKey(input);
    await this.dependencies.gatewaySigningAuthority.assertDistinctKey(input);
  }

  private async assertActivationEligible(id: string, transaction: ManagedExchangeTransaction): Promise<void> {
    const persisted = await this.dependencies.repository.findById('key', id, transaction);
    if (!persisted || persisted.status !== 'published' || persisted.enabled !== false || persisted.lifecycle !== 'draft') {
      throw new ManagedExchangeProvisionError();
    }
    await this.validate(persisted);
  }
}

function cleanKey(input: KeyInput): Record<string, unknown> {
  const forbidden = ['requestId', 'status', 'enabled', 'lifecycle', 'version', 'replacesKeyId', 'predecessorId', 'successor'];
  if (forbidden.some((field) => field in input)) throw new ManagedExchangeProvisionError();
  return { ...input };
}
function previous(to: KeyStatus): KeyStatus { return ({ published: 'new', active: 'published', retiring: 'active', retired: 'retiring', new: 'new' } as const)[to]; }
function isTransition(value: unknown): value is Exclude<KeyStatus, 'new'> { return value === 'published' || value === 'active' || value === 'retiring' || value === 'retired'; }
function required(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new ManagedExchangeProvisionError(); return value.trim(); }

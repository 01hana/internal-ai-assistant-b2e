import {
  ManagedExchangeInfrastructureError,
  type PermissionSourceAdapter,
  type PermissionSourceAdapterRegistry as AdapterRegistry,
  type PermissionSourcePolicy,
  type ResolvePermissionInput,
  type TrustedPermissionMaterial,
  type VerifiedExternalIdentity
} from '../domain/managed-exchange.domain';

const INPUT_KEYS = ['admittedIdentity', 'trustedPermissionReference', 'trustedPermissionMaterial', 'serverOwnedIntegrationContext', 'serviceCredentialReference', 'permissionSourcePolicy', 'requestId'] as const;
const POLICY_KEYS = ['id', 'sourceType', 'adapterContractReference'] as const;
const CONTEXT_KEYS = ['integrationId', 'hostApp'] as const;
const MATERIAL_KEYS = ['kind', 'reference', 'values'] as const;
const IDENTITY_KEYS = ['subject', 'organization', 'anchors', 'trustedPermissionReference', 'trustedPermissionMaterial', 'providerSubjectReference'] as const;
const ANCHOR_KEYS = ['kind', 'value'] as const;

/** Fixed deployment permission-source adapter resolution. */
export class PermissionSourceAdapterRegistry implements AdapterRegistry {
  private readonly adapters: readonly PermissionSourceAdapter[];

  constructor(adapters: readonly PermissionSourceAdapter[]) {
    const sourceTypes = new Set<string>();
    for (const adapter of adapters) {
      if (typeof adapter.sourceType !== 'string' || adapter.sourceType.trim().length === 0 || sourceTypes.has(adapter.sourceType)) {
        throw new Error('Invalid permission source adapter registration.');
      }
      sourceTypes.add(adapter.sourceType);
    }
    this.adapters = Object.freeze([...adapters]);
  }

  resolve(sourceType: string): PermissionSourceAdapter | undefined {
    return this.adapters.find((adapter) => adapter.sourceType === sourceType);
  }

  async execute(input: ResolvePermissionInput): Promise<TrustedPermissionMaterial> {
    try {
      const safeInput = trustedInput(input);
      const adapter = this.resolve(safeInput.permissionSourcePolicy.sourceType);
      if (!adapter) throw new ManagedExchangeInfrastructureError();
      return await adapter.resolve(safeInput);
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function trustedInput(value: unknown): ResolvePermissionInput {
  if (!record(value) || !only(value, INPUT_KEYS)) throw new ManagedExchangeInfrastructureError();

  const safe: {
    admittedIdentity: VerifiedExternalIdentity;
    serverOwnedIntegrationContext: Readonly<{ integrationId: string; hostApp: string }>;
    permissionSourcePolicy: PermissionSourcePolicy;
    requestId: string;
    trustedPermissionReference?: string;
    trustedPermissionMaterial?: TrustedPermissionMaterial;
    serviceCredentialReference?: string;
  } = {
    admittedIdentity: identity(value.admittedIdentity),
    serverOwnedIntegrationContext: context(value.serverOwnedIntegrationContext),
    permissionSourcePolicy: policy(value.permissionSourcePolicy),
    requestId: text(value.requestId)
  };
  if (value.trustedPermissionReference !== undefined) safe.trustedPermissionReference = text(value.trustedPermissionReference);
  if (value.trustedPermissionMaterial !== undefined) safe.trustedPermissionMaterial = material(value.trustedPermissionMaterial);
  if (value.serviceCredentialReference !== undefined) safe.serviceCredentialReference = text(value.serviceCredentialReference);
  return Object.freeze(safe);
}

function policy(value: unknown): PermissionSourcePolicy {
  if (!record(value) || !exact(value, POLICY_KEYS)) throw new ManagedExchangeInfrastructureError();
  return Object.freeze({ id: text(value.id), sourceType: text(value.sourceType), adapterContractReference: text(value.adapterContractReference) });
}

function context(value: unknown): Readonly<{ integrationId: string; hostApp: string }> {
  if (!record(value) || !exact(value, CONTEXT_KEYS)) throw new ManagedExchangeInfrastructureError();
  return Object.freeze({ integrationId: text(value.integrationId), hostApp: text(value.hostApp) });
}

function material(value: unknown): TrustedPermissionMaterial {
  const candidate = materialShape(value);
  const safe: { kind: string; reference?: string; values?: readonly string[] } = { kind: text(candidate.kind) };
  if (candidate.reference !== undefined) safe.reference = text(candidate.reference);
  if (candidate.values !== undefined) safe.values = Object.freeze(candidate.values.map(text));
  return Object.freeze(safe);
}

function identity(value: unknown): VerifiedExternalIdentity {
  if (!record(value) || !only(value, IDENTITY_KEYS) || !('subject' in value) || !('anchors' in value)) throw new ManagedExchangeInfrastructureError();
  text(value.subject);
  if (value.organization !== undefined) text(value.organization);
  if (value.trustedPermissionReference !== undefined) text(value.trustedPermissionReference);
  if (value.providerSubjectReference !== undefined) text(value.providerSubjectReference);
  if (value.trustedPermissionMaterial !== undefined) materialShape(value.trustedPermissionMaterial);
  if (!Array.isArray(value.anchors) || value.anchors.length === 0) throw new ManagedExchangeInfrastructureError();
  for (const anchor of value.anchors) {
    if (!record(anchor) || !exact(anchor, ANCHOR_KEYS)) throw new ManagedExchangeInfrastructureError();
    text(anchor.kind);
    text(anchor.value);
  }
  return value as VerifiedExternalIdentity;
}

function materialShape(value: unknown): Readonly<{ kind: unknown; reference?: unknown; values?: unknown[] }> {
  if (!record(value) || !only(value, MATERIAL_KEYS) || !('kind' in value)) throw new ManagedExchangeInfrastructureError();
  text(value.kind);
  if (value.reference !== undefined) text(value.reference);
  if (value.values !== undefined) {
    if (!Array.isArray(value.values)) throw new ManagedExchangeInfrastructureError();
    value.values.forEach(text);
  }
  return value as Readonly<{ kind: unknown; reference?: unknown; values?: unknown[] }>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeInfrastructureError();
  const normalized = value.trim();
  if (!normalized || [...normalized].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  })) throw new ManagedExchangeInfrastructureError();
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

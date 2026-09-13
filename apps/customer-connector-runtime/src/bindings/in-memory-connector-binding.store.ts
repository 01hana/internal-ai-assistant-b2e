import { createHash, randomBytes as secureRandomBytes } from 'node:crypto';
import { boundedJsonByteLength, validateBoundedJsonValue } from '@internal-ai-assistant/connector-runtime-contract';
import {
  BINDING_FALLBACK_TTL_SECONDS,
  BINDING_MAX_TTL_SECONDS,
  BINDING_MIN_TTL_SECONDS,
  BINDING_PROVIDER_EXPIRY_SAFETY_SECONDS,
  BINDING_PROVIDER_METADATA_MAX_BYTES,
  BINDING_REFERENCE_RANDOM_BYTES,
  MAX_CONCURRENT_BINDING_LEASES,
  type BindingMintInput,
  type BindingResolutionExpectation,
  type InvocationBindingExpectation,
  type BindingResult,
  type BindingStoreLimits,
  type ConnectorBindingLease,
  type MintedConnectorBinding,
  type ProtectedBindingView,
  type StoredConnectorBindingRecord
} from './binding.types';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HANDLE = /^\S{1,256}$/;
const MAX_REFERENCE_ATTEMPTS = 3;

export class InMemoryConnectorBindingStore {
  private readonly records = new Map<string, StoredConnectorBindingRecord>();
  private readonly activeByTuple = new Map<string, string>();
  private readonly generationByTuple = new Map<string, number>();
  private sweepOffset = 0;

  constructor(
    readonly limits: BindingStoreLimits,
    private readonly seams: Readonly<{
      nowSeconds?: () => number;
      randomBytes?: (size: number) => Uint8Array;
      hashReference?: (reference: string) => string;
    }> = {}
  ) {
    if (!validLimits(limits)) throw new Error('Invalid binding store limits.');
  }

  get isOperational(): boolean { return true; }
  get size(): number { return this.records.size; }

  mint(input: BindingMintInput): BindingResult<MintedConnectorBinding & Readonly<{ replaced?: StoredConnectorBindingRecord }>> {
    const now = this.now();
    const normalized = normalizeMintInput(input);
    if (!normalized) return failure('CONNECTOR_BINDING_INVALID');
    const expiresAt = bindingExpiry(now, input.providerExpiresAt);
    if (expiresAt === undefined) return failure('CONNECTOR_BINDING_INVALID');

    const tupleKey = bindingTupleKey(normalized);
    const scopeKey = bindingScopeKey(normalized);
    const priorVerifier = this.activeByTuple.get(tupleKey);
    const prior = priorVerifier === undefined ? undefined : this.records.get(priorVerifier);
    const effectiveSize = this.records.size - (prior ? 1 : 0);
    if (effectiveSize >= this.limits.maxEntries || this.scopeCount(scopeKey, prior?.referenceVerifier) >= this.limits.scopeMaxEntries) {
      return failure('CONNECTOR_UNAVAILABLE');
    }

    let connectorContextRef: string | undefined;
    let referenceVerifier: string | undefined;
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
      const entropy = this.random(BINDING_REFERENCE_RANDOM_BYTES);
      if (entropy.byteLength !== BINDING_REFERENCE_RANDOM_BYTES) return failure('CONNECTOR_UNAVAILABLE');
      const candidate = `ccr_${Buffer.from(entropy).toString('base64url')}`;
      const verifier = this.hash(candidate);
      if (!this.records.has(verifier)) {
        connectorContextRef = candidate;
        referenceVerifier = verifier;
        break;
      }
    }
    if (!connectorContextRef || !referenceVerifier) return failure('CONNECTOR_UNAVAILABLE');

    const bindingGeneration = (this.generationByTuple.get(tupleKey) ?? 0) + 1;
    if (prior) {
      prior.status = 'revoked';
      for (const controller of prior.leaseAbortControllers) controller.abort();
      this.records.delete(prior.referenceVerifier);
    }
    const record: StoredConnectorBindingRecord = {
      referenceVerifier,
      tupleKey,
      scopeKey,
      trustedContext: normalized.trustedContext,
      bootstrapProviderKey: normalized.bootstrapProviderKey,
      credentialProviderKey: normalized.credentialProviderKey,
      opaqueCredentialHandle: normalized.opaqueCredentialHandle,
      credentialGeneration: normalized.credentialGeneration,
      providerMetadata: normalized.providerMetadata,
      createdAt: now,
      expiresAt,
      bindingGeneration,
      status: 'active',
      activeLeases: 0,
      leaseAbortControllers: new Set()
    };
    this.records.set(referenceVerifier, record);
    this.activeByTuple.set(tupleKey, referenceVerifier);
    this.generationByTuple.set(tupleKey, bindingGeneration);
    return success(Object.freeze({
      connectorContextRef, expiresAt, expiresIn: expiresAt - now, bindingGeneration,
      ...(prior === undefined ? {} : { replaced: prior })
    }));
  }

  resolve(reference: string, expectation: BindingResolutionExpectation): BindingResult<ProtectedBindingView> {
    const record = this.resolveRecord(reference, expectation);
    return record ? success(protectedView(record)) : failure('CONNECTOR_BINDING_INVALID');
  }

  acquire(reference: string, expectation: BindingResolutionExpectation): BindingResult<ConnectorBindingLease> {
    const record = this.resolveRecord(reference, expectation);
    if (!record) return failure('CONNECTOR_BINDING_INVALID');
    if (record.activeLeases >= MAX_CONCURRENT_BINDING_LEASES) return failure('CONNECTOR_BINDING_BUSY');
    const controller = new AbortController();
    record.activeLeases += 1;
    record.leaseAbortControllers.add(controller);
    let released = false;
    return success(Object.freeze({
      value: protectedView(record),
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        record.leaseAbortControllers.delete(controller);
        record.activeLeases = Math.max(0, record.activeLeases - 1);
      }
    }));
  }

  acquireForInvocation(reference: string, expectation: InvocationBindingExpectation): BindingResult<ConnectorBindingLease> {
    const record = this.resolveInvocationRecord(reference, expectation);
    if (!record) return failure('CONNECTOR_BINDING_INVALID');
    if (record.activeLeases >= MAX_CONCURRENT_BINDING_LEASES) return failure('CONNECTOR_BINDING_BUSY');
    const controller = new AbortController();
    record.activeLeases += 1; record.leaseAbortControllers.add(controller);
    let released = false;
    return success(Object.freeze({ value: protectedView(record), signal: controller.signal, release: () => {
      if (released) return; released = true; record.leaseAbortControllers.delete(controller); record.activeLeases = Math.max(0, record.activeLeases - 1);
    } }));
  }

  revoke(reference: string): StoredConnectorBindingRecord | undefined {
    const verifier = typeof reference === 'string' ? this.hash(reference) : '';
    return this.removeByVerifier(verifier);
  }

  removeIfExpired(reference: string): StoredConnectorBindingRecord | undefined {
    if (typeof reference !== 'string' || !reference.startsWith('ccr_')) return undefined;
    const verifier = this.hash(reference);
    const record = this.records.get(verifier);
    return record && record.expiresAt <= this.now() ? this.removeByVerifier(verifier) : undefined;
  }

  sweepExpired(maximum = this.limits.sweepBatchSize): readonly StoredConnectorBindingRecord[] {
    const cap = Math.min(Math.max(0, Math.trunc(maximum)), this.limits.sweepBatchSize);
    if (cap === 0 || this.records.size === 0) return Object.freeze([]);
    const keys = [...this.records.keys()];
    const removed: StoredConnectorBindingRecord[] = [];
    const inspected = Math.min(cap, keys.length);
    for (let index = 0; index < inspected; index += 1) {
      const key = keys[(this.sweepOffset + index) % keys.length]!;
      const record = this.records.get(key);
      if (record && record.expiresAt <= this.now()) {
        const value = this.removeByVerifier(key);
        if (value) removed.push(value);
      }
    }
    this.sweepOffset = keys.length === 0 ? 0 : (this.sweepOffset + inspected) % keys.length;
    return Object.freeze(removed);
  }

  clear(): readonly StoredConnectorBindingRecord[] {
    const removed = [...this.records.values()];
    for (const record of removed) {
      record.status = 'revoked';
      for (const controller of record.leaseAbortControllers) controller.abort();
    }
    this.records.clear();
    this.activeByTuple.clear();
    this.generationByTuple.clear();
    return Object.freeze(removed);
  }

  private resolveRecord(reference: string, expectation: BindingResolutionExpectation): StoredConnectorBindingRecord | undefined {
    if (typeof reference !== 'string' || !reference.startsWith('ccr_')) return undefined;
    const verifier = this.hash(reference);
    const record = this.records.get(verifier);
    if (!record || record.status !== 'active') return undefined;
    if (record.expiresAt <= this.now()) return undefined;
    if (!expectationMatches(record, expectation)) return undefined;
    if (this.activeByTuple.get(record.tupleKey) !== verifier || this.generationByTuple.get(record.tupleKey) !== record.bindingGeneration) return undefined;
    return record;
  }

  private resolveInvocationRecord(reference: string, expectation: InvocationBindingExpectation): StoredConnectorBindingRecord | undefined {
    if (typeof reference !== 'string' || !reference.startsWith('ccr_')) return undefined;
    const verifier = this.hash(reference); const record = this.records.get(verifier);
    if (!record || record.status !== 'active' || record.expiresAt <= this.now()) return undefined;
    const actual = record.trustedContext; const expected = expectation.trustedContext;
    if (actual.customerId !== expected.customerId || actual.integrationId !== expected.integrationId || actual.hostApp !== expected.hostApp ||
        actual.connectorInstanceId !== expected.connectorInstanceId || actual.organizationId !== expected.organizationId || actual.actorId !== expected.actorId) return undefined;
    if (this.activeByTuple.get(record.tupleKey) !== verifier || this.generationByTuple.get(record.tupleKey) !== record.bindingGeneration) return undefined;
    return record;
  }

  private removeByVerifier(verifier: string): StoredConnectorBindingRecord | undefined {
    const record = this.records.get(verifier);
    if (!record) return undefined;
    record.status = 'revoked';
    for (const controller of record.leaseAbortControllers) controller.abort();
    this.records.delete(verifier);
    if (this.activeByTuple.get(record.tupleKey) === verifier) this.activeByTuple.delete(record.tupleKey);
    return record;
  }

  private scopeCount(scopeKey: string, excluded?: string): number {
    let count = 0;
    for (const [verifier, record] of this.records) {
      if (verifier !== excluded && record.status === 'active' && record.scopeKey === scopeKey) count += 1;
    }
    return count;
  }

  private now(): number { return this.seams.nowSeconds?.() ?? Math.floor(Date.now() / 1_000); }
  private random(size: number): Uint8Array { return this.seams.randomBytes?.(size) ?? secureRandomBytes(size); }
  private hash(reference: string): string {
    return this.seams.hashReference?.(reference) ?? createHash('sha256').update(reference).digest('base64url');
  }
}

type NormalizedBindingMintInput = Omit<BindingMintInput, 'providerMetadata'> & Readonly<{ providerMetadata: object }>;

function normalizeMintInput(input: BindingMintInput): NormalizedBindingMintInput | undefined {
  try {
    if (!validContext(input.trustedContext) || !identifier(input.bootstrapProviderKey) || !identifier(input.credentialProviderKey) ||
        typeof input.opaqueCredentialHandle !== 'string' || !HANDLE.test(input.opaqueCredentialHandle) || !identifier(input.credentialGeneration) ||
        !validateBoundedJsonValue(input.providerMetadata) || typeof input.providerMetadata !== 'object' || input.providerMetadata === null || Array.isArray(input.providerMetadata) ||
        boundedJsonByteLength(input.providerMetadata) > BINDING_PROVIDER_METADATA_MAX_BYTES) return undefined;
    const metadata = deepFreeze(JSON.parse(JSON.stringify(input.providerMetadata)) as object);
    return Object.freeze({ ...input, trustedContext: Object.freeze({ ...input.trustedContext }), providerMetadata: metadata });
  } catch {
    return undefined;
  }
}

function bindingExpiry(now: number, providerExpiresAt?: number): number | undefined {
  if (!Number.isInteger(now)) return undefined;
  if (providerExpiresAt === undefined) return now + BINDING_FALLBACK_TTL_SECONDS;
  if (!Number.isInteger(providerExpiresAt)) return undefined;
  const expiresAt = Math.min(now + BINDING_MAX_TTL_SECONDS, providerExpiresAt - BINDING_PROVIDER_EXPIRY_SAFETY_SECONDS);
  return expiresAt - now >= BINDING_MIN_TTL_SECONDS ? expiresAt : undefined;
}

function bindingTupleKey(input: BindingMintInput): string {
  const context = input.trustedContext;
  return [context.customerId, context.integrationId, context.hostApp, context.connectorInstanceId,
    context.organizationId ?? '', context.actorId ?? '', input.bootstrapProviderKey, input.credentialProviderKey].join('\0');
}

function bindingScopeKey(input: BindingMintInput): string {
  const context = input.trustedContext;
  return [context.customerId, input.bootstrapProviderKey, context.organizationId ?? '', context.actorId ?? ''].join('\0');
}

function expectationMatches(record: StoredConnectorBindingRecord, expectation: BindingResolutionExpectation): boolean {
  const actual = record.trustedContext;
  const expected = expectation.trustedContext;
  return actual.customerId === expected.customerId && actual.integrationId === expected.integrationId && actual.hostApp === expected.hostApp &&
    actual.connectorInstanceId === expected.connectorInstanceId && actual.organizationId === expected.organizationId && actual.actorId === expected.actorId &&
    record.bootstrapProviderKey === expectation.bootstrapProviderKey && record.credentialProviderKey === expectation.credentialProviderKey &&
    (expectation.bindingGeneration === undefined || record.bindingGeneration === expectation.bindingGeneration) &&
    (expectation.credentialGeneration === undefined || record.credentialGeneration === expectation.credentialGeneration);
}

function protectedView(record: StoredConnectorBindingRecord): ProtectedBindingView {
  return Object.freeze({
    trustedContext: record.trustedContext,
    bootstrapProviderKey: record.bootstrapProviderKey,
    credentialProviderKey: record.credentialProviderKey,
    opaqueCredentialHandle: record.opaqueCredentialHandle,
    credentialGeneration: record.credentialGeneration,
    providerMetadata: record.providerMetadata,
    bindingGeneration: record.bindingGeneration,
    expiresAt: record.expiresAt
  });
}

function validContext(value: BindingMintInput['trustedContext']): boolean {
  return !!value && identifier(value.customerId) && identifier(value.integrationId) && identifier(value.hostApp) && identifier(value.connectorInstanceId) &&
    (value.organizationId === undefined || identifier(value.organizationId)) && (value.actorId === undefined || identifier(value.actorId));
}
function identifier(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }
function validLimits(value: BindingStoreLimits): boolean {
  return Number.isInteger(value.maxEntries) && value.maxEntries > 0 && value.maxEntries <= 100_000 &&
    Number.isInteger(value.scopeMaxEntries) && value.scopeMaxEntries > 0 && value.scopeMaxEntries <= value.maxEntries &&
    Number.isInteger(value.sweepBatchSize) && value.sweepBatchSize > 0 && value.sweepBatchSize <= value.maxEntries;
}
function success<T>(value: T): BindingResult<T> { return Object.freeze({ ok: true, value }); }
function failure(code: 'CONNECTOR_BINDING_INVALID' | 'CONNECTOR_BINDING_BUSY' | 'CONNECTOR_UNAVAILABLE'): BindingResult<never> {
  return Object.freeze({ ok: false, code });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

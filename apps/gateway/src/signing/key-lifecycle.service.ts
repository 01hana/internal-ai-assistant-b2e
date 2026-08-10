import { exportJWK, type KeyLike } from 'jose';
import { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { ActiveSigningKeyRecord, GatewaySigningKeyRecord, GatewaySigningKeyTransaction } from './gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';
import type { KeyRetirementPolicy } from './key-retirement-policy';

type KeyStatus = 'new' | 'published' | 'active' | 'retiring' | 'retired';
type SigningKeyProvider = Readonly<{ load(reference: string): Promise<KeyLike> }>;
type SigningKeyRepository = Readonly<{
  transaction<T>(callback: (transaction: GatewaySigningKeyTransaction) => Promise<T>): Promise<T>;
  findByKid(kid: string, transaction: GatewaySigningKeyTransaction): Promise<GatewaySigningKeyRecord | null>;
  findActive(transaction: GatewaySigningKeyTransaction): Promise<ActiveSigningKeyRecord | null>;
  create(data: Record<string, unknown>, transaction: GatewaySigningKeyTransaction): Promise<GatewaySigningKeyRecord>;
  update(kid: string, data: Record<string, unknown>, transaction: GatewaySigningKeyTransaction): Promise<GatewaySigningKeyRecord>;
}>;

export type RegisterSigningKeyInput = Readonly<{ kid: string; keyReference: string; requestId: string }>;
export type KeyTransitionInput = Readonly<{ kid: string; to: KeyStatus; requestId: string }>;

export class KeyLifecycleService {
  constructor(private readonly dependencies: Readonly<{
    repository: SigningKeyRepository;
    signingKeyProvider: SigningKeyProvider;
    retirementPolicy: KeyRetirementPolicy;
    now: () => Date;
  }>) {}

  async register(input: RegisterSigningKeyInput): Promise<GatewaySigningKeyRecord> {
    const normalized = normalizeRegistration(input);
    try {
      const handle = await this.dependencies.signingKeyProvider.load(normalized.keyReference);
      const publicJwk = await derivePublicJwk(handle, normalized.kid);
      return await this.dependencies.repository.transaction(async (transaction) => {
        if (await this.dependencies.repository.findByKid(normalized.kid, transaction)) throw new IdentityServiceUnavailableError();
        const created = await this.dependencies.repository.create({
          kid: normalized.kid,
          keyReference: normalized.keyReference,
          publicJwk,
          status: 'new'
        }, transaction);
        await appendAudit(transaction, normalized.requestId, 'signing_key_registered', 'success', 'registered', normalized.kid);
        return created;
      });
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }

  transition(input: KeyTransitionInput): Promise<GatewaySigningKeyRecord> {
    const normalized = normalizeTransition(input);
    if (normalized.to !== 'published') return Promise.reject(new IdentityServiceUnavailableError());
    return this.dependencies.repository.transaction((transaction) => this.transitionInTransaction(transaction, normalized));
  }

  async transitionInTransaction(transaction: GatewaySigningKeyTransaction, input: KeyTransitionInput): Promise<GatewaySigningKeyRecord> {
    const normalized = normalizeTransition(input);
    try {
      const current = await this.dependencies.repository.findByKid(normalized.kid, transaction);
      if (!current || !isLegalTransition(current.status, normalized.to)) throw new IdentityServiceUnavailableError();
      if (normalized.to === 'active') {
        const active = await this.dependencies.repository.findActive(transaction);
        if (active && active.kid !== current.kid) throw new IdentityServiceUnavailableError();
      }
      const now = this.dependencies.now();
      const data = transitionData(normalized.to, now, this.dependencies.retirementPolicy);
      const next = await this.dependencies.repository.update(normalized.kid, data, transaction);
      await appendAudit(transaction, normalized.requestId, eventFor(normalized.to), 'success', reasonFor(normalized.to), normalized.kid);
      return next;
    } catch (error) {
      if (error instanceof IdentityServiceUnavailableError) throw error;
      throw new IdentityServiceUnavailableError();
    }
  }

  /**
   * Rotation-only compensation after its topology check has already established
   * that this row is the former active key.  It is intentionally separate from
   * the public state-machine transition API: callers cannot use it to bypass
   * the normal forward-only lifecycle graph.
   */
  async restorePriorActiveInTransaction(transaction: GatewaySigningKeyTransaction, input: Readonly<{ kid: string; requestId: string }>): Promise<GatewaySigningKeyRecord> {
    const normalized = normalizeRestore(input);
    try {
      const current = await this.dependencies.repository.findByKid(normalized.kid, transaction);
      if (!current || current.status !== 'retiring') throw new IdentityServiceUnavailableError();
      const active = await this.dependencies.repository.findActive(transaction);
      if (active) throw new IdentityServiceUnavailableError();
      const restored = await this.dependencies.repository.update(normalized.kid, {
        status: 'active',
        activatedAt: this.dependencies.now(),
        retireAfter: null,
        retiredAt: null
      }, transaction);
      await appendAudit(transaction, normalized.requestId, 'signing_key_restored', 'success', 'restored', normalized.kid);
      return restored;
    } catch (error) {
      if (error instanceof IdentityServiceUnavailableError) throw error;
      throw new IdentityServiceUnavailableError();
    }
  }
}

function normalizeRegistration(input: RegisterSigningKeyInput): RegisterSigningKeyInput {
  if (!isExactKeys(input, ['kid', 'keyReference', 'requestId'])) throw new IdentityServiceUnavailableError();
  return Object.freeze({ kid: required(input.kid), keyReference: required(input.keyReference), requestId: required(input.requestId) });
}

function normalizeTransition(input: KeyTransitionInput): KeyTransitionInput {
  if (!isExactKeys(input, ['kid', 'to', 'requestId']) || !isStatus(input.to)) throw new IdentityServiceUnavailableError();
  return Object.freeze({ kid: required(input.kid), to: input.to, requestId: required(input.requestId) });
}

function normalizeRestore(input: Readonly<{ kid: string; requestId: string }>): Readonly<{ kid: string; requestId: string }> {
  if (!isExactKeys(input, ['kid', 'requestId'])) throw new IdentityServiceUnavailableError();
  return Object.freeze({ kid: required(input.kid), requestId: required(input.requestId) });
}

async function derivePublicJwk(handle: KeyLike, kid: string) {
  const derived = await exportJWK(handle);
  if (!isNonBlank(derived.n) || !isNonBlank(derived.e)) throw new IdentityServiceUnavailableError();
  return Object.freeze({ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: derived.n, e: derived.e });
}

function transitionData(to: KeyStatus, now: Date, policy: KeyRetirementPolicy): Record<string, unknown> {
  if (to === 'published') return { status: 'published' };
  if (to === 'active') return { status: 'active', activatedAt: now, retireAfter: null, retiredAt: null };
  if (to === 'retiring') return { status: 'retiring', retireAfter: policy.calculateRetireAfter(now) };
  return { status: 'retired', retiredAt: now };
}

function isLegalTransition(from: KeyStatus, to: KeyStatus): boolean {
  return (from === 'new' && to === 'published') || (from === 'published' && to === 'active') || (from === 'active' && to === 'retiring') || (from === 'retiring' && to === 'retired');
}

function eventFor(to: KeyStatus): string {
  return `signing_key_${to === 'new' ? 'registered' : to}`;
}

function reasonFor(to: KeyStatus): string {
  return to;
}

async function appendAudit(transaction: GatewaySigningKeyTransaction, requestId: string, eventType: string, outcome: string, reasonCode: string, kid: string) {
  await new GatewayIdentityAuditWriter(transaction).append({ requestId, eventType, outcome, reasonCode, kid });
}

function isExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function required(value: unknown): string {
  if (!isNonBlank(value) || containsControlCharacter(value)) throw new IdentityServiceUnavailableError();
  return value.trim();
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function isStatus(value: unknown): value is KeyStatus {
  return value === 'new' || value === 'published' || value === 'active' || value === 'retiring' || value === 'retired';
}

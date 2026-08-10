import { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { GatewaySigningKeyRecord, GatewaySigningKeyRepository, GatewaySigningKeyTransaction } from './gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';
import type { KeyLifecycleService } from './key-lifecycle.service';
import type { KeyRetirementPolicy } from './key-retirement-policy';
import type { SigningKeyPropagationVerifier } from './signing-key-propagation-verifier';

type RotationRepository = Pick<GatewaySigningKeyRepository, 'transaction' | 'findByKid' | 'findActive' | 'update'>;
type LifecyclePrimitive = Pick<KeyLifecycleService, 'transitionInTransaction' | 'restorePriorActiveInTransaction'>;
type CompensationAuditWriter = Pick<GatewayIdentityAuditWriter, 'append'>;

export class KeyRotationService {
  constructor(private readonly dependencies: Readonly<{
    repository: RotationRepository;
    lifecycle: LifecyclePrimitive;
    retirementPolicy: KeyRetirementPolicy;
    propagationVerifier: SigningKeyPropagationVerifier;
    compensationAuditWriter: CompensationAuditWriter;
    now: () => Date;
  }>) {}

  async activatePublished(input: Readonly<{ kid: string; requestId: string }>): Promise<Readonly<{ activeKid: string }>> {
    const normalized = normalize(input, ['kid', 'requestId']) as Readonly<{ kid: string; requestId: string }>;
    const published = await this.readPublished(normalized.kid);
    try {
      await this.dependencies.propagationVerifier.verifyPublished({ kid: published.kid, publicJwk: published.publicJwk });
    } catch {
      throw new IdentityServiceUnavailableError();
    }

    let priorKid: string | undefined;
    await this.dependencies.repository.transaction(async (transaction) => {
      const candidate = await this.dependencies.repository.findByKid(normalized.kid, transaction);
      if (!candidate || candidate.status !== 'published') throw new IdentityServiceUnavailableError();
      const prior = await this.dependencies.repository.findActive(transaction);
      priorKid = prior?.kid;
      if (prior) await this.dependencies.lifecycle.transitionInTransaction(transaction, { kid: prior.kid, to: 'retiring', requestId: normalized.requestId });
      await this.dependencies.lifecycle.transitionInTransaction(transaction, { kid: candidate.kid, to: 'active', requestId: normalized.requestId });
      await appendAudit(transaction, normalized.requestId, 'signing_key_activated', 'success', 'activated', candidate.kid);
    });

    try {
      await this.dependencies.propagationVerifier.verifyActivated({ kid: published.kid, publicJwk: published.publicJwk });
    } catch {
      await this.compensateFailedActivation({ priorKid, candidateKid: normalized.kid, requestId: normalized.requestId });
      throw new IdentityServiceUnavailableError();
    }
    return Object.freeze({ activeKid: normalized.kid });
  }

  async retire(input: Readonly<{ kid: string; requestId: string }>): Promise<GatewaySigningKeyRecord> {
    const normalized = normalize(input, ['kid', 'requestId']) as Readonly<{ kid: string; requestId: string }>;
    return this.dependencies.repository.transaction(async (transaction) => {
      try {
        const key = await this.dependencies.repository.findByKid(normalized.kid, transaction);
        if (!key || key.status !== 'retiring' || !key.retireAfter || !this.dependencies.retirementPolicy.isRetirementEligible({ retireAfter: key.retireAfter, now: this.dependencies.now() })) {
          throw new IdentityServiceUnavailableError();
        }
        const retired = await this.dependencies.lifecycle.transitionInTransaction(transaction, { kid: key.kid, to: 'retired', requestId: normalized.requestId });
        await appendAudit(transaction, normalized.requestId, 'signing_key_retired', 'success', 'retired', key.kid);
        return retired;
      } catch (error) {
        if (error instanceof IdentityServiceUnavailableError) throw error;
        throw new IdentityServiceUnavailableError();
      }
    });
  }

  rollbackToPriorActive(input: Readonly<{ priorKid: string; candidateKid: string; requestId: string }>): Promise<Readonly<{ activeKid: string }>> {
    const normalized = normalize(input, ['priorKid', 'candidateKid', 'requestId']) as Readonly<{ priorKid: string; candidateKid: string; requestId: string }>;
    return this.compensateFailedActivation({
      priorKid: normalized.priorKid,
      candidateKid: normalized.candidateKid,
      requestId: normalized.requestId
    }).then(() => Object.freeze({ activeKid: normalized.priorKid }));
  }

  private async readPublished(kid: string): Promise<GatewaySigningKeyRecord> {
    return this.dependencies.repository.transaction(async (transaction) => {
      const candidate = await this.dependencies.repository.findByKid(kid, transaction);
      if (!candidate || candidate.status !== 'published') throw new IdentityServiceUnavailableError();
      return candidate;
    });
  }

  private async compensateFailedActivation(input: Readonly<{ priorKid?: string; candidateKid: string; requestId: string }>): Promise<void> {
    const compensationTime = this.dependencies.now();
    try {
      await this.dependencies.repository.transaction(async (transaction) => {
        const candidate = await this.dependencies.repository.findByKid(input.candidateKid, transaction);
        const active = await this.dependencies.repository.findActive(transaction);
        if (!candidate || candidate.status !== 'active' || !active || active.kid !== candidate.kid) throw new IdentityServiceUnavailableError();
        const retireAfter = this.dependencies.retirementPolicy.calculateRetireAfter(compensationTime);
        await this.dependencies.repository.update(candidate.kid, {
          status: 'retiring',
          retireAfter,
          retiredAt: null
        }, transaction);
        if (input.priorKid) {
          const prior = await this.dependencies.repository.findByKid(input.priorKid, transaction);
          if (!prior || prior.status !== 'retiring') throw new IdentityServiceUnavailableError();
          await this.dependencies.repository.update(prior.kid, {
            status: 'active',
            activatedAt: compensationTime,
            retireAfter: null,
            retiredAt: null
          }, transaction);
        }
      });
    } catch (error) {
      if (error instanceof IdentityServiceUnavailableError) throw error;
      throw new IdentityServiceUnavailableError();
    }

    try {
      await this.dependencies.compensationAuditWriter.append({
        requestId: input.requestId,
        eventType: 'signing_key_activation_compensated',
        outcome: 'failed',
        reasonCode: 'post_activation_proof_failed',
        kid: input.candidateKid
      });
    } catch {
      // The safety state is already committed; a failed audit must not revive an active key.
      throw new IdentityServiceUnavailableError();
    }
  }
}

async function appendAudit(transaction: GatewaySigningKeyTransaction, requestId: string, eventType: string, outcome: string, reasonCode: string, kid: string) {
  await new GatewayIdentityAuditWriter(transaction).append({ requestId, eventType, outcome, reasonCode, kid });
}

function normalize(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== keys.length || !Object.keys(value).every((key) => keys.includes(key))) {
    throw new IdentityServiceUnavailableError();
  }
  const normalized: Record<string, unknown> = {};
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key];
    if (key === 'now') {
      if (!(field instanceof Date) || Number.isNaN(field.getTime())) throw new IdentityServiceUnavailableError();
      normalized[key] = field;
    } else {
      if (typeof field !== 'string' || !field.trim() || containsControlCharacter(field)) throw new IdentityServiceUnavailableError();
      normalized[key] = field.trim();
    }
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

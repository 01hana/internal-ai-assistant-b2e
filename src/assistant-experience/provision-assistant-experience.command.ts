import { parseAssistantExperiencePayload } from './assistant-experience.parser';
import { AssistantExperienceConfigStore, experienceChecksum } from './assistant-experience.repository';
import type { AssistantExperiencePayloadV1, ExperienceConfigError } from './assistant-experience.types';

export interface ExperiencePayloadValidator {
  validate(payload: AssistantExperiencePayloadV1): Promise<readonly ExperienceConfigError[]>;
}

export type ProvisionExperienceOutcome = 'VALIDATED' | 'ACTIVATED' | 'REACTIVATED' | 'UNCHANGED';

export interface ProvisionExperienceResult {
  readonly outcome: ProvisionExperienceOutcome;
  readonly customerId: string;
  readonly integrationId: string;
  readonly configVersion: string;
  readonly checksum: string;
}

export type ProvisionExperienceErrorCode =
  | 'INVALID_PAYLOAD' | 'UNVERIFIED_CONTENT' | 'PACK_MISMATCH' | 'CUSTOMER_NOT_FOUND' | 'VERSION_CONFLICT';

export class ProvisionAssistantExperienceError extends Error {
  constructor(readonly code: ProvisionExperienceErrorCode, readonly errors: readonly ExperienceConfigError[] = []) {
    super(code);
    this.name = 'ProvisionAssistantExperienceError';
  }
}

/**
 * Validates an experience configuration file and activates it. Nothing is written unless every check passes.
 * Re-running the same version with the same content is a no-op; the same version with different content is rejected.
 */
export class ProvisionAssistantExperienceCommand {
  constructor(private readonly store: AssistantExperienceConfigStore, private readonly validator: ExperiencePayloadValidator) {}

  async execute(input: unknown, options: Readonly<{ checkOnly: boolean; allowUnverified: boolean }>): Promise<ProvisionExperienceResult> {
    const parsed = parseAssistantExperiencePayload(input);
    if (!parsed.ok) throw new ProvisionAssistantExperienceError('INVALID_PAYLOAD', parsed.errors);
    const payload = parsed.payload;
    if (payload.semanticReviewStatus !== 'HUMAN_VERIFIED' && !options.allowUnverified) {
      throw new ProvisionAssistantExperienceError('UNVERIFIED_CONTENT', [{ path: '$.semanticReviewStatus', code: 'NOT_HUMAN_VERIFIED' }]);
    }
    const packErrors = await this.validator.validate(payload);
    if (packErrors.length > 0) throw new ProvisionAssistantExperienceError('PACK_MISMATCH', packErrors);

    const checksum = experienceChecksum(payload);
    const result = (outcome: ProvisionExperienceOutcome): ProvisionExperienceResult => Object.freeze({ outcome,
      customerId: payload.customerId, integrationId: payload.integrationId, configVersion: payload.configVersion, checksum });

    if (!(await this.store.customerExists(payload.customerId))) throw new ProvisionAssistantExperienceError('CUSTOMER_NOT_FOUND');
    const existing = await this.store.findVersion(payload.customerId, payload.integrationId, payload.configVersion);
    if (existing && existing.checksum !== checksum) {
      throw new ProvisionAssistantExperienceError('VERSION_CONFLICT', [{ path: '$.configVersion', code: 'CONTENT_CHANGED_WITHOUT_NEW_VERSION' }]);
    }
    if (options.checkOnly) return result('VALIDATED');
    const active = await this.store.findActive(payload.customerId, payload.integrationId);
    if (existing && active?.id === existing.id) return result('UNCHANGED');
    await this.store.activate(payload, checksum);
    return result(existing ? 'REACTIVATED' : 'ACTIVATED');
  }
}

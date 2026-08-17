import { isIP } from 'node:net';

export type TrustProfileActivationInput = Readonly<{
  id: string;
  integrationId: string;
  expectedIssuer: string;
  expectedAudience: string;
  jwksUri: string;
  algorithm: string;
  enabled: boolean;
  lifecycle: string;
  version: number;
  replacesProfileId?: string | null;
}>;

type ActivationRepository = Readonly<{
  findBindingByIntegrationId(integrationId: string): Promise<unknown>;
  findEnabledExactPolicy(input: TrustProfileActivationInput): Promise<readonly unknown[]>;
  findById?(id: string): Promise<{ integrationId: string; version: number } | null>;
}>;

export interface JwksSourceRegistrationPolicy {
  validate(value: string): void;
}

/** Batch 1 registration policy only. DNS, redirects, and connection-time checks belong to Batch 3. */
export class ProductionJwksSourceRegistrationPolicy implements JwksSourceRegistrationPolicy {
  validate(value: string): void {
    let url: URL;
    try { url = new URL(value); } catch { throw new TrustProfileActivationError(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || unsafeHost(url.hostname)) {
      throw new TrustProfileActivationError();
    }
  }
}

export class TrustProfileActivationValidator {
  constructor(private readonly dependencies: Readonly<{ repository: ActivationRepository; jwksSourcePolicy: JwksSourceRegistrationPolicy }>) {}

  async validate(input: TrustProfileActivationInput): Promise<TrustProfileActivationInput> {
    const profile = normalize(input);
    this.dependencies.jwksSourcePolicy.validate(profile.jwksUri);
    const binding = await this.dependencies.repository.findBindingByIntegrationId(profile.integrationId);
    if (!binding) throw new TrustProfileActivationError();
    if (profile.replacesProfileId) await this.validateReplacement(profile);
    if (profile.enabled && profile.lifecycle === 'active') {
      const duplicates = await this.dependencies.repository.findEnabledExactPolicy(profile);
      if (duplicates.length > 0) throw new TrustProfileActivationError();
    }
    return Object.freeze(profile);
  }

  private async validateReplacement(profile: TrustProfileActivationInput) {
    if (profile.replacesProfileId === profile.id) throw new TrustProfileActivationError();
    if (!this.dependencies.repository.findById) throw new TrustProfileActivationError();
    const predecessor = await this.dependencies.repository.findById(profile.replacesProfileId!);
    if (!predecessor || predecessor.integrationId !== profile.integrationId || predecessor.version >= profile.version) throw new TrustProfileActivationError();
  }
}

function normalize(input: TrustProfileActivationInput): TrustProfileActivationInput {
  const allowed = ['id', 'integrationId', 'expectedIssuer', 'expectedAudience', 'jwksUri', 'algorithm', 'enabled', 'lifecycle', 'version', 'replacesProfileId'];
  if (!input || typeof input !== 'object' || Object.keys(input as object).some((key) => !allowed.includes(key))) throw new TrustProfileActivationError();
  const profile = {
    id: required(input.id), integrationId: required(input.integrationId), expectedIssuer: required(input.expectedIssuer), expectedAudience: required(input.expectedAudience), jwksUri: required(input.jwksUri),
    algorithm: required(input.algorithm), enabled: input.enabled, lifecycle: required(input.lifecycle), version: input.version,
    replacesProfileId: input.replacesProfileId === undefined || input.replacesProfileId === null ? undefined : required(input.replacesProfileId)
  };
  if (profile.algorithm !== 'RS256' || typeof profile.enabled !== 'boolean' || !Number.isSafeInteger(profile.version) || profile.version < 1) throw new TrustProfileActivationError();
  if (!['draft', 'active', 'disabled', 'replaced'].includes(profile.lifecycle)) throw new TrustProfileActivationError();
  if ((profile.lifecycle === 'active') !== profile.enabled) throw new TrustProfileActivationError();
  if (profile.replacesProfileId && profile.version < 2) throw new TrustProfileActivationError();
  if (profile.lifecycle === 'replaced' && profile.enabled) throw new TrustProfileActivationError();
  return profile;
}

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].some((character) => (character.codePointAt(0) ?? 0) <= 31 || character.codePointAt(0) === 127)) throw new TrustProfileActivationError();
  return value.trim();
}

function unsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  const normalized = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (isIP(normalized)) return true;
  return false;
}

export class TrustProfileActivationError extends Error {
  constructor() { super('Trust profile activation cannot be completed.'); }
}

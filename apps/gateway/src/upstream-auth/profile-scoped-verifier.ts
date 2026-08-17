import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createVerifiedUpstreamIdentity, type VerifiedUpstreamIdentity } from './verified-upstream-identity';
import type { JwksTransport } from './jwks-transport.adapter';
import { registeredTimeFailure } from './upstream-time-policy';

type Profile = Readonly<{ id: string; expectedIssuer: string; expectedAudience: string; jwksUri: string; algorithm: string }>;
type Input = Readonly<{ profile: Profile; token: string; clockToleranceSeconds: number }>;
type CacheEntry = { keySet: ReturnType<typeof createLocalJWKSet>; loadedAt: number; lastRefreshAt: number };
const CACHE_MAX_AGE_MS = 600_000;
const REFRESH_COOLDOWN_MS = 30_000;

export class ProfileScopedVerifier {
  private readonly cache = new Map<string, CacheEntry>();
  constructor(private readonly dependencies: Readonly<{ transport: JwksTransport; now?: () => number }>) {}
  async verify(input: Input): Promise<VerifiedUpstreamIdentity> {
    if (input.profile.algorithm !== 'RS256' || !Number.isInteger(input.clockToleranceSeconds) || input.clockToleranceSeconds < 0 || input.clockToleranceSeconds > 300) throw new ProfileScopedVerificationError('credential');
    let header: ReturnType<typeof decodeProtectedHeader>;
    try { header = decodeProtectedHeader(input.token); } catch { throw new ProfileScopedVerificationError('credential'); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) throw new ProfileScopedVerificationError('credential');
    const key = `${input.profile.id}\u0000${input.profile.jwksUri}`;
    let entry = await this.keySet(key, input.profile.jwksUri, false);
    try { return await verify(input, entry.keySet); } catch (error) {
      if (!noMatchingKey(error) || this.now() - entry.lastRefreshAt < REFRESH_COOLDOWN_MS) throw profileError(error);
      entry = await this.keySet(key, input.profile.jwksUri, true);
      try { return await verify(input, entry.keySet); } catch (retryError) { throw profileError(retryError); }
    }
  }
  private async keySet(key: string, uri: string, force: boolean): Promise<CacheEntry> {
    const current = this.cache.get(key);
    if (!force && current && this.now() - current.loadedAt < CACHE_MAX_AGE_MS) return current;
    try { const entry = { keySet: createLocalJWKSet(await this.dependencies.transport.fetch(uri)), loadedAt: this.now(), lastRefreshAt: this.now() }; this.cache.set(key, entry); return entry; } catch { throw new ProfileScopedVerificationError('infrastructure'); }
  }
  private now() { return this.dependencies.now?.() ?? Date.now(); }
}
async function verify(input: Input, keySet: ReturnType<typeof createLocalJWKSet>): Promise<VerifiedUpstreamIdentity> { const { payload } = await jwtVerify(input.token, keySet, { algorithms: ['RS256'], issuer: input.profile.expectedIssuer, audience: input.profile.expectedAudience, clockTolerance: input.clockToleranceSeconds }); if (registeredTimeFailure(payload, input.clockToleranceSeconds)) throw new ProfileScopedVerificationError('credential'); return createVerifiedUpstreamIdentity(payload as Record<string, unknown>); }
function noMatchingKey(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ERR_JWKS_NO_MATCHING_KEY'; }
function profileError(error: unknown): ProfileScopedVerificationError { return error instanceof ProfileScopedVerificationError ? error : new ProfileScopedVerificationError('credential'); }
export class ProfileScopedVerificationError extends Error { constructor(readonly category: 'credential' | 'infrastructure') { super('Profile verification cannot be completed.'); this.name = 'ProfileScopedVerificationError'; } }

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const policyPath = resolve(__dirname, '../../src/signing/key-retirement-policy.ts');
type RetirementDependencies = Readonly<{
  finalOldTokenLifetimeSeconds: number;
  backendClockToleranceSeconds: number;
  remoteJwksCacheSeconds: number;
  remoteJwksCooldownSeconds: number;
  propagationMarginSeconds: number;
  enforcedMinimumOverlapSeconds: number;
  httpCacheControlSeconds: number;
}>;

const CURRENT_DEPENDENCIES: RetirementDependencies = Object.freeze({
  finalOldTokenLifetimeSeconds: 300,
  backendClockToleranceSeconds: 300,
  remoteJwksCacheSeconds: 600,
  remoteJwksCooldownSeconds: 30,
  propagationMarginSeconds: 60,
  enforcedMinimumOverlapSeconds: 1500,
  httpCacheControlSeconds: 60
});

type RetirementPolicy = Readonly<{
  observedMinimumSeconds(): number;
  assertConfigurationCompatible(): void;
  calculateRetireAfter(retiringAt: Date): Date;
  isRetirementEligible(input: Readonly<{ retireAfter: Date; now: Date }>): boolean;
}>;

describe('Signing-key retirement policy contract (T055)', () => {
  it('requires the Phase 6 retirement-policy production surface', () => {
    expect(existsSync(policyPath)).toBe(true);
  });

  it('accounts for the locked Remote-JWKS cache and cooldown, not HTTP Cache-Control', () => {
    const policy = createPolicy(CURRENT_DEPENDENCIES);

    expect(policy.observedMinimumSeconds()).toBe(1290);
    expect(policy.calculateRetireAfter(new Date('2026-08-10T00:00:00.000Z'))).toEqual(new Date('2026-08-10T00:25:00.000Z'));
    expect(CURRENT_DEPENDENCIES.remoteJwksCacheSeconds).toBe(600);
    expect(CURRENT_DEPENDENCIES.remoteJwksCooldownSeconds).toBe(30);
    expect(CURRENT_DEPENDENCIES.httpCacheControlSeconds).toBe(60);
  });

  it('is ineligible at 24m59s and eligible exactly at the enforced 25-minute boundary', () => {
    const policy = createPolicy(CURRENT_DEPENDENCIES);
    const retiringAt = new Date('2026-08-10T00:00:00.000Z');
    const retireAfter = policy.calculateRetireAfter(retiringAt);

    expect(policy.isRetirementEligible({ retireAfter, now: new Date('2026-08-10T00:24:59.000Z') })).toBe(false);
    expect(policy.isRetirementEligible({ retireAfter, now: new Date('2026-08-10T00:25:00.000Z') })).toBe(true);
  });

  it('rejects configuration drift that would make the fixed 25-minute overlap unsafe', () => {
    const unsafe = { ...CURRENT_DEPENDENCIES, remoteJwksCacheSeconds: 1000 };
    const policy = createPolicy(unsafe);

    expect(() => policy.assertConfigurationCompatible()).toThrow();
  });
});

function createPolicy(input: RetirementDependencies): RetirementPolicy {
  if (!existsSync(policyPath)) throw new Error('Required Phase 6 lifecycle production surface missing: KeyRetirementPolicy.');
  const target = require(policyPath) as {
    KeyRetirementPolicy?: new (input: RetirementDependencies) => RetirementPolicy;
  };
  if (!target.KeyRetirementPolicy) throw new Error('Required Phase 6 lifecycle production surface missing: KeyRetirementPolicy.');
  return new target.KeyRetirementPolicy(input);
}

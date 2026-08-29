import { KeyLifecycleService } from '../../src/jwks/key-lifecycle.service';
import { rsaSigningFixture } from '../signing/signing-fixtures';

describe('Bridge retiring-key overlap policy', () => {
  const lifecycle = new KeyLifecycleService();

  it('uses the 1500-second baseline and exact eligibility boundary', () => {
    expect(lifecycle.requiredOverlap()).toBe(1500);
    expect(lifecycle.isRetirementEligible(1000, 2499)).toBe(false);
    expect(lifecycle.isRetirementEligible(1000, 2500)).toBe(true);
  });

  it('recalculates when configured bounds exceed the minimum', () => {
    const bounds = { tokenLifetime: 600, clockTolerance: 300, jwksCacheAge: 600, unknownKidCooldown: 30, propagationMargin: 60 };
    expect(lifecycle.requiredOverlap(bounds)).toBe(1590);
    expect(lifecycle.isRetirementEligible(1000, 2589, bounds)).toBe(false);
    expect(lifecycle.isRetirementEligible(1000, 2590, bounds)).toBe(true);
  });

  it.each([-1, 1.5, NaN, Infinity])('rejects invalid timestamp or bound %s', (invalid) => {
    expect(() => lifecycle.isRetirementEligible(invalid, 2500)).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.isRetirementEligible(1000, invalid)).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.requiredOverlap({ tokenLifetime: invalid, clockTolerance: 300, jwksCacheAge: 600, unknownKidCooldown: 30, propagationMargin: 60 })).toThrow('bridge_jwks_invalid');
  });

  it('requires last-issuance evidence before removing a retiring key', () => {
    const active = rsaSigningFixture('active');
    const retiring = rsaSigningFixture('retiring');
    const previous = [active.record, { ...retiring.record, status: 'retiring' as const }];
    const next = [active.record];
    expect(() => lifecycle.validateTransition(previous, next)).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.validateTransition(previous, next, { retiring: { lastIssuedAt: 1000, now: 2499 } })).toThrow('bridge_jwks_invalid');
    expect(() => lifecycle.validateTransition(previous, next, { retiring: { lastIssuedAt: 1000, now: 2500 } })).not.toThrow();
  });
});

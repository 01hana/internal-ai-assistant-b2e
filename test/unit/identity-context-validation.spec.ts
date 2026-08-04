import { resolve } from 'node:path';
import {
  CanonicalIdentityClaims,
  createInternalIdentityJwtFixture,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

describe('verified canonical identity claim validation (T007 contract)', () => {
  const fixture = createInternalIdentityJwtFixture();
  const valid = fixture.canonicalClaims.customerA;
  const requiredStrings: Array<keyof Pick<CanonicalIdentityClaims, 'customer_id' | 'integration_id' | 'sub' | 'org_id' | 'host_app' | 'jti'>> = [
    'customer_id', 'integration_id', 'sub', 'org_id', 'host_app', 'jti'
  ];

  it.each(requiredStrings)('returns 403 when required string claim %s is missing', (claim) => {
    expectContextInvalid(omit(valid, claim));
  });

  it.each(requiredStrings)('returns 403 when required string claim %s is wrong type, empty, or blank', (claim) => {
    expectContextInvalid({ ...valid, [claim]: 42 });
    expectContextInvalid({ ...valid, [claim]: '' });
    expectContextInvalid({ ...valid, [claim]: '   ' });
  });

  it.each(['roles', 'permission_scopes'] as const)('returns 403 when %s is not a string array', (claim) => {
    expectContextInvalid({ ...valid, [claim]: 'orders:read' });
    expectContextInvalid({ ...valid, [claim]: ['orders:read', ' '] });
    expectContextInvalid({ ...valid, [claim]: [''] });
  });

  it.each([
    ['roles', [123]],
    ['roles', ['planner', false]],
    ['permission_scopes', [null]],
    ['permission_scopes', ['orders:read', 42]]
  ])('returns 403 when %s contains a non-string element', (claim, value) => {
    expectContextInvalid({ ...valid, [claim]: value });
  });

  it('accepts verified canonical claims with either or both authorization arrays empty', () => {
    const validate = loadCanonicalClaimValidator();
    expect(validate({ claims: { ...valid, roles: [] }, issuer: TEST_GATEWAY_ISSUER })).toMatchObject({
      customer: { customerId: 'customer-a' }
    });
    expect(validate({ claims: { ...valid, permission_scopes: [] }, issuer: TEST_GATEWAY_ISSUER })).toMatchObject({
      customer: { customerId: 'customer-a' }
    });
    expect(validate({ claims: { ...valid, roles: [], permission_scopes: [] }, issuer: TEST_GATEWAY_ISSUER })).toMatchObject({
      customer: { customerId: 'customer-a' }
    });
  });

  it('maps verified claims and verified issuer metadata without retaining a raw token or requestId', () => {
    const validate = loadCanonicalClaimValidator();
    const context = validate({
      claims: {
        ...valid,
        requestId: 'must-not-be-a-claim',
        authorization: 'Bearer must-not-be-a-claim'
      },
      issuer: TEST_GATEWAY_ISSUER
    });

    expect(context).toMatchObject({
      customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
      organization: { organizationId: 'org-shared' },
      hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes: ['orders:read'] },
      auth: { tokenId: 'jwt-customer-a', gatewayIssuer: TEST_GATEWAY_ISSUER }
    });
    expect(JSON.stringify(context)).not.toContain('must-not-be-a-claim');
  });
});

function expectContextInvalid(claims: Record<string, unknown>) {
  const validate = loadCanonicalClaimValidator();
  expect(() => validate({ claims, issuer: TEST_GATEWAY_ISSUER })).toThrow(
    expect.objectContaining({ status: 403, code: 'IDENTITY_CONTEXT_INVALID' })
  );
}

function loadCanonicalClaimValidator(): (input: {
  claims: Record<string, unknown>;
  issuer: string;
}) => Record<string, unknown> {
  const modulePath = resolve(__dirname, '../../src/identity/identity-context.validator');
  const target = requireTargetModule(
    modulePath,
    'T013/T014 not implemented: canonical verified-claim validator is unavailable to T007 tests.'
  );
  const validator = target.validateVerifiedInternalIdentityClaims;
  if (typeof validator !== 'function') {
    throw new Error('Expected export validateVerifiedInternalIdentityClaims is unavailable.');
  }
  return validator as (input: { claims: Record<string, unknown>; issuer: string }) => Record<string, unknown>;
}

function omit<T extends Record<string, unknown>, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

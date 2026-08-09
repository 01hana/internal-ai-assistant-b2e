import { GATEWAY_IDENTITY_FIXTURES } from '../support/gateway-identity-fixtures';

describe('Feature 003 synthetic A/B gateway identity fixtures (T020)', () => {
  it('shares lower-level upstream identity while keeping explicit Customer and integration bindings distinct', () => {
    const { customerA, customerB, shared } = GATEWAY_IDENTITY_FIXTURES;
    expect(customerA.customerId).not.toBe(customerB.customerId);
    expect(customerA.integrationId).not.toBe(customerB.integrationId);
    expect(shared).toEqual({
      organizationId: 'org-shared',
      actorId: 'actor-shared',
      hostApp: 'admin',
      roles: ['planner'],
      permissionScopes: ['orders:read']
    });
  });

  it('contains no token, credential, or signing material', () => {
    expect(JSON.stringify(GATEWAY_IDENTITY_FIXTURES)).not.toMatch(/jwt|token|secret|private|credential|bearer/i);
  });
});

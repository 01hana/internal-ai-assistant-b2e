import { validateRequestIdentityContext, assertSameCompanyBoundary } from '../../src/identity/identity-context.validator';

describe('organization boundary integration baseline', () => {
  it('fails closed when resource organization or host app differs from request identity', () => {
    const identity = validateRequestIdentityContext({
      requestId: 'req-boundary',
      actorId: 'actor-001',
      hostApp: 'erp',
      organizationId: 'org-001',
      role: 'planner',
      permissionScopes: ['orders:read']
    });

    expect(() => assertSameCompanyBoundary(identity, { organizationId: 'org-002', hostApp: 'erp' })).toThrow(
      /Missing or invalid identity context/
    );
    expect(() => assertSameCompanyBoundary(identity, { organizationId: 'org-001', hostApp: 'wms' })).toThrow(
      /Missing or invalid identity context/
    );
  });
});

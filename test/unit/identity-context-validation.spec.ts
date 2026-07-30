import { IdentityContextException } from '../../src/identity/identity.errors';
import {
  assertSameCompanyBoundary,
  validateRequestIdentityContext
} from '../../src/identity/identity-context.validator';

const validHeaders = {
  requestId: 'req-identity-001',
  actorId: 'actor-001',
  hostApp: 'erp',
  organizationId: 'org-001',
  role: 'planner',
  permissionScopes: ['orders:read', 'inventory:read']
};

describe('identity context validation', () => {
  it('accepts a complete request identity context', () => {
    expect(validateRequestIdentityContext(validHeaders)).toEqual({
      requestId: 'req-identity-001',
      actor: {
        actorId: 'actor-001',
        role: 'planner',
        permissionScopes: ['orders:read', 'inventory:read']
      },
      hostApp: {
        hostApp: 'erp'
      },
      company: {
        organizationId: 'org-001'
      }
    });
  });

  it('rejects missing required identity fields', () => {
    expect(() => validateRequestIdentityContext({ ...validHeaders, actorId: '' })).toThrow(IdentityContextException);
    expect(() => validateRequestIdentityContext({ ...validHeaders, hostApp: undefined })).toThrow(
      IdentityContextException
    );
    expect(() => validateRequestIdentityContext({ ...validHeaders, organizationId: ' ' })).toThrow(
      IdentityContextException
    );
    expect(() => validateRequestIdentityContext({ ...validHeaders, permissionScopes: [] })).toThrow(
      IdentityContextException
    );
    expect(() => validateRequestIdentityContext({ ...validHeaders, requestId: undefined })).toThrow(
      IdentityContextException
    );
  });

  it('rejects cross organization or host app resources before data use', () => {
    const identity = validateRequestIdentityContext(validHeaders);

    expect(() => assertSameCompanyBoundary(identity, { organizationId: 'org-002', hostApp: 'erp' })).toThrow(
      IdentityContextException
    );
    expect(() => assertSameCompanyBoundary(identity, { organizationId: 'org-001', hostApp: 'mes' })).toThrow(
      IdentityContextException
    );
  });
});

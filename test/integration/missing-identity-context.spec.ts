import { ExecutionContext } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { REQUEST_ID_PROPERTY } from '../../src/common/request-id/request-id.constants';
import { RequestIdMiddleware } from '../../src/common/request-id/request-id.middleware';
import {
  getIdentityContext,
  IdentityRequest
} from '../../src/identity/identity-context.extractor';
import { IdentityGuard } from '../../src/identity/identity.guard';
import {
  createInternalIdentityJwtFixture,
  InternalTokenClaims,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';
import {
  createInternalIdentityTestingModule,
  INTERNAL_IDENTITY_TEST_CONFIG
} from '../support/internal-identity-test-module.helper';
import {
  createAuthorizedInternalIdentityHeaders,
  createLegacyPublicIdentityHeaders
} from '../support/us1-test-app.helper';

describe('internal identity boundary integration (T009 contract)', () => {
  const fixture = createInternalIdentityJwtFixture();
  const canonicalClaims: Partial<InternalTokenClaims> = {
    customer_id: 'customer-a',
    integration_id: 'integration-erp',
    sub: 'actor-shared',
    org_id: 'org-shared',
    host_app: 'erp'
  };
  let moduleRef: TestingModule;
  let guard: IdentityGuard;

  beforeAll(async () => {
    const testModule = await createInternalIdentityTestingModule({
      issuer: TEST_GATEWAY_ISSUER,
      audience: TEST_BACKEND_AUDIENCE,
      jwks: fixture.jwks
    });
    moduleRef = testModule.moduleRef;
    guard = moduleRef.get(IdentityGuard);
    expect(testModule.internalIdentity).toEqual({
      issuer: TEST_GATEWAY_ISSUER,
      audience: TEST_BACKEND_AUDIENCE,
      jwks: fixture.jwks
    });
    expect(moduleRef.get(INTERNAL_IDENTITY_TEST_CONFIG)).toBe(testModule.internalIdentity);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('rejects complete public identity headers when no internal JWT exists', async () => {
    const request = createIdentityRequest({
      headers: createLegacyPublicIdentityHeaders()
    });

    await expect(evaluateGuard(guard, request)).rejects.toMatchObject({
      status: 401,
      code: 'IDENTITY_TOKEN_INVALID'
    });
    expect(getIdentityContext(request)).toBeUndefined();
  });

  it('does not fall back to public headers when a JWT has an invalid signature', async () => {
    const invalidToken = fixture.tamper(fixture.sign({ claims: canonicalClaims }));
    const request = createIdentityRequest({
      headers: {
        ...createLegacyPublicIdentityHeaders(),
        authorization: `Bearer ${invalidToken}`
      }
    });

    await expect(evaluateGuard(guard, request)).rejects.toMatchObject({
      status: 401,
      code: 'IDENTITY_TOKEN_INVALID'
    });
    expect(getIdentityContext(request)).toBeUndefined();
  });

  it('ignores public identity headers rather than letting them supplement or override signed claims', async () => {
    const request = createIdentityRequest({
      requestId: 'req-header-conflict',
      headers: {
        ...createLegacyPublicIdentityHeaders({
          'x-customer-id': 'customer-header-conflict',
          'x-actor-id': 'actor-header-conflict',
          'x-role': 'admin',
          'x-organization-id': 'org-header-conflict',
          'x-host-app': 'host-header-conflict',
          'x-permission-scopes': 'all:read'
        }),
        authorization: `Bearer ${fixture.sign({ claims: canonicalClaims })}`
      }
    });

    await expect(evaluateGuard(guard, request)).resolves.toBe(true);
    expect(getIdentityContext(request)).toMatchObject({
      customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
      organization: { organizationId: 'org-shared' },
      hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes: ['orders:read'] }
    });
  });

  it('accepts a valid JWT without x-request-id and keeps normalized requestId out of canonical claims', async () => {
    const request = createIdentityRequest({
      headers: {
        authorization: `Bearer ${fixture.sign({ claims: canonicalClaims })}`
      }
    });
    normalizeRequestId(request);

    await expect(evaluateGuard(guard, request)).resolves.toBe(true);
    expect(request[REQUEST_ID_PROPERTY]).toEqual(expect.any(String));
    expect(getIdentityContext(request)).toMatchObject({
      requestId: request[REQUEST_ID_PROPERTY],
      customer: { customerId: 'customer-a' },
      organization: { organizationId: 'org-shared' },
      actor: { actorId: 'actor-shared' }
    });
  });

  it('keeps authorized and legacy test header helpers mutually exclusive', () => {
    const authorized = createAuthorizedInternalIdentityHeaders(fixture, {
      claims: canonicalClaims,
      requestId: 'req-authorized-only'
    });
    const legacy = createLegacyPublicIdentityHeaders({
      Authorization: 'Bearer must-be-discarded'
    });

    expect(Object.keys(authorized).map((name) => name.toLowerCase()).sort()).toEqual([
      'authorization',
      'x-request-id'
    ]);
    expect(authorized.authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    expect(Object.keys(legacy).map((name) => name.toLowerCase())).not.toContain('authorization');
  });
});

function createIdentityRequest(input: {
  requestId?: string;
  headers: Record<string, string>;
}): IdentityRequest {
  const normalizedHeaders = new Map(
    Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    [REQUEST_ID_PROPERTY]: input.requestId,
    header: (name: string) => normalizedHeaders.get(name.toLowerCase())
  } as IdentityRequest;
}

function normalizeRequestId(request: IdentityRequest) {
  new RequestIdMiddleware().use(
    request,
    { setHeader: jest.fn() } as never,
    jest.fn()
  );
}

function createExecutionContext(request: IdentityRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

function evaluateGuard(guard: IdentityGuard, request: IdentityRequest): Promise<boolean> {
  return Promise.resolve().then(() => guard.canActivate(createExecutionContext(request)));
}

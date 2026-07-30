import { ExecutionContext } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { REQUEST_ID_PROPERTY } from '../../src/common/request-id/request-id.constants';
import {
  IdentityContextExtractor,
  IdentityRequest,
  getIdentityContext
} from '../../src/identity/identity-context.extractor';
import { IdentityGuard } from '../../src/identity/identity.guard';

describe('missing identity context integration', () => {
  const extractor = new IdentityContextExtractor();
  const tokenVerifier = {
    verify: jest.fn(async () => ({
      subject: 'actor-001',
      organizationId: 'org-001',
      role: 'planner',
      permissionScopes: ['orders:read', 'inventory:read'],
      hostApp: 'erp',
      tokenId: 'token-001'
    }))
  };
  const guard = new IdentityGuard(extractor, tokenVerifier);

  it('rejects requests that do not include a bearer token through the shared error envelope', async () => {
    const request = createIdentityRequest({
      requestId: 'req-missing-identity',
      headers: {}
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    try {
      await guard.canActivate(createExecutionContext(request));
      throw new Error('Expected guard to reject missing identity.');
    } catch (error) {
      new GlobalExceptionFilter().catch(error, createArgumentsHost(request, response));
    }

    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-missing-identity',
        error: expect.objectContaining({
          code: 'IDENTITY_TOKEN_INVALID',
          message: 'Missing or invalid identity token.'
        })
      })
    );
  });

  it('accepts a verified token and ignores client-supplied identity headers', async () => {
    const request = createIdentityRequest({
      requestId: 'req-valid-identity',
      headers: {
        authorization: 'Bearer trusted-token',
        'x-actor-id': 'actor-001',
        'x-host-app': 'attacker-app',
        'x-organization-id': 'attacker-org',
        'x-role': 'admin',
        'x-permission-scopes': 'everything:read'
      }
    });

    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true);
    expect(getIdentityContext(request)).toMatchObject({
      requestId: 'req-valid-identity',
      actor: {
        actorId: 'actor-001',
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
});

function createIdentityRequest(input: { requestId: string; headers: Record<string, string> }): IdentityRequest {
  const normalizedHeaders = new Map(Object.entries(input.headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    [REQUEST_ID_PROPERTY]: input.requestId,
    header: (name: string) => normalizedHeaders.get(name.toLowerCase())
  } as IdentityRequest;
}

function createExecutionContext(request: IdentityRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

function createArgumentsHost(request: IdentityRequest, response: { status: jest.Mock; json: jest.Mock }) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response
    })
  } as never;
}

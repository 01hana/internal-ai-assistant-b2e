import type { ExecutionContext } from '@nestjs/common';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { GatewayBackendClient } from '../../apps/gateway/src/backend-client/gateway-backend-client.service';
import { GatewayTrustChainHandler } from '../../apps/gateway/src/backend-client/gateway-trust-chain.handler';
import { CanonicalIdentityResolver } from '../../apps/gateway/src/integration-registry/canonical-identity-resolver.service';
import { InternalIdentityTokenIssuer } from '../../apps/gateway/src/identity/internal-identity-token-issuer.service';
import { MultiProfileUpstreamTokenVerifier } from '../../apps/gateway/src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../apps/gateway/src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../apps/gateway/src/upstream-auth/routing-metadata.parser';
import { REQUEST_ID_PROPERTY } from '../../src/common/request-id/request-id.constants';
import { HostIntegrationRequestFactory, createCustomerScopeFromHostIntegrationContext } from '../../src/host-integration/host-integration-request.factory';
import { getIdentityContext } from '../../src/identity/identity-context.accessor';
import { IdentityGuard } from '../../src/identity/identity.guard';
import { createStaticInternalIdentityTokenVerifier } from '../../src/identity/internal-identity-token-verifier';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';

const REQUEST_ID = 'req-local-permission-scope-propagation';
const REQUIRED_SCOPE = 'menu:SCM_DASHBOARD:read';

describe('real Gateway to Backend permission-scope propagation', () => {
  it('preserves the canonical dashboard scope through verification, issuance, Backend identity, CustomerScope, and precheck', async () => {
    const upstreamKeys = await generateKeyPair('RS256');
    const upstreamPublicJwk = await exportJWK(upstreamKeys.publicKey);
    const upstreamIssuer = 'https://local-upstream.test';
    const upstreamAudience = 'local-gateway';
    const upstreamToken = await new SignJWT({
      integration_id: 'shinmone-scm-assistant-local',
      sub: 'actor-local',
      org_id: 'organization-local',
      host_app: 'shinmone-scm',
      roles: [],
      permission_scopes: [REQUIRED_SCOPE]
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'local-upstream-key' })
      .setIssuer(upstreamIssuer)
      .setAudience(upstreamAudience)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(upstreamKeys.privateKey);
    const profileVerifier = new ProfileScopedVerifier({
      transport: {
        fetch: async () => ({
          keys: [{ ...upstreamPublicJwk, kid: 'local-upstream-key', alg: 'RS256', use: 'sig' }]
        })
      }
    });
    const profile = {
      id: 'local-profile',
      integrationId: 'shinmone-scm-assistant-local',
      expectedIssuer: upstreamIssuer,
      expectedAudience: upstreamAudience,
      jwksUri: 'https://local-upstream.test/jwks',
      algorithm: 'RS256',
      enabled: true,
      lifecycle: 'active'
    };
    const productionUpstreamTokenVerifier = new MultiProfileUpstreamTokenVerifier({
      parser: new RoutingMetadataParser(),
      candidateResolver: { resolve: async () => [profile] } as never,
      profileVerifier,
      clockToleranceSeconds: 0
    });
    let verifiedUpstreamScopes: readonly string[] | undefined;
    const upstreamTokenVerifier = {
      verify: async (input: Parameters<MultiProfileUpstreamTokenVerifier['verify']>[0]) => {
        const identity = await productionUpstreamTokenVerifier.verify(input);
        verifiedUpstreamScopes = identity.permissionScopes;
        return identity;
      }
    };
    const productionCanonicalIdentityResolver = new CanonicalIdentityResolver(
      {
        findByIntegrationId: async () => ({
          integrationId: 'shinmone-scm-assistant-local',
          customerId: 'customer-shinmone-scm-local',
          allowedHostApp: 'shinmone-scm',
          enabled: true
        })
      } as never,
      { append: async () => ({}) } as never
    );
    let canonicalGatewayScopes: readonly string[] | undefined;
    const canonicalIdentityResolver = {
      resolve: async (input: Parameters<CanonicalIdentityResolver['resolve']>[0]) => {
        const identity = await productionCanonicalIdentityResolver.resolve(input);
        canonicalGatewayScopes = identity.permissionScopes;
        return identity;
      }
    };

    const internalKeys = await generateKeyPair('RS256');
    const internalPublicJwk = await exportJWK(internalKeys.publicKey);
    const internalIssuer = 'https://local-gateway.test';
    const internalAudience = 'local-backend';
    const internalTokenIssuer = new InternalIdentityTokenIssuer(
      { internalIssuer, internalAudience, internalTokenTtlSeconds: 300 },
      {
        resolveActiveSigningKey: async () => ({
          kid: 'local-internal-key',
          privateKey: internalKeys.privateKey
        })
      }
    );
    const backendVerifier = createStaticInternalIdentityTokenVerifier({
      issuer: internalIssuer,
      audience: internalAudience,
      jwks: {
        keys: [{ ...internalPublicJwk, kid: 'local-internal-key', alg: 'RS256', use: 'sig' }]
      }
    });
    let internalJwtScopes: unknown;
    let backendIdentityScopes: readonly string[] | undefined;
    let customerScopeScopes: readonly string[] | undefined;
    let precheckResult: unknown;
    const gatewayBackendClient = new GatewayBackendClient({
      backendBaseUrl: 'https://local-backend.test',
      timeoutMilliseconds: 5000,
      internalTokenIssuer,
      createTimeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
      createAbortController: () => new AbortController(),
      fetch: async (_url, init) => {
        const compactInternalJwt = init.headers.authorization.replace(/^Bearer /, '');
        internalJwtScopes = decodeJwt(compactInternalJwt).permission_scopes;
        const request = {
          header: (name: string) =>
            name.toLowerCase() === 'authorization' ? init.headers.authorization : undefined,
          [REQUEST_ID_PROPERTY]: REQUEST_ID
        } as never;
        await new IdentityGuard(backendVerifier).canActivate({
          switchToHttp: () => ({ getRequest: () => request })
        } as unknown as ExecutionContext);
        const identityContext = getIdentityContext(request)!;
        backendIdentityScopes = identityContext.actor.permissionScopes;
        const host = new HostIntegrationRequestFactory().createHostContext(identityContext);
        const customerScope = createCustomerScopeFromHostIntegrationContext(host);
        customerScopeScopes = customerScope.permissionScopes;
        precheckResult = await new ToolPermissionPrecheckService({
          append: jest.fn(),
          appendCustomerToolEvent: jest.fn()
        } as never).checkResolvedCustomerTool({
          requestId: REQUEST_ID,
          sessionId: 'session-local',
          messageId: 'message-local',
          identityContext,
          customerScope,
          resolvedTool: {
            tool: {
              id: 'tool-local',
              key: 'work-orders.monthly-new-count',
              name: 'work-orders.monthly-new-count',
              version: '1.0.0',
              description: 'reference',
              operation: ToolOperation.read,
              riskLevel: RiskLevel.low,
              active: true,
              connectorKey: 'business',
              timeoutMs: 5000,
              requiredPermissionScopes: [REQUIRED_SCOPE],
              inputSchema: { required: [] },
              outputSchema: { required: [] },
              hasSideEffect: false,
              requiresConfirmation: false,
              requiresApproval: false
            },
            requiredRoles: [],
            requiredPermissionScopes: []
          }
        });
        return { ok: true, status: 201, json: async () => ({ ok: true }) };
      }
    });
    const handler = new GatewayTrustChainHandler({
      upstreamTokenVerifier,
      canonicalIdentityResolver,
      gatewayBackendClient
    });

    await handler.createSession({
      authorization: `Bearer ${upstreamToken}`,
      requestId: REQUEST_ID
    });

    expect(decodeJwt(upstreamToken).permission_scopes).toEqual([REQUIRED_SCOPE]);
    expect(verifiedUpstreamScopes).toEqual([REQUIRED_SCOPE]);
    expect(canonicalGatewayScopes).toEqual([REQUIRED_SCOPE]);
    expect(internalJwtScopes).toEqual([REQUIRED_SCOPE]);
    expect(backendIdentityScopes).toEqual([REQUIRED_SCOPE]);
    expect(customerScopeScopes).toEqual([REQUIRED_SCOPE]);
    expect(precheckResult).toEqual({ allowed: true });
  });
});

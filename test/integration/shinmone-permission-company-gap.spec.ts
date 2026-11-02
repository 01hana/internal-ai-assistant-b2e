import { NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { HostIntegrationRequestFactory } from '../../src/host-integration/host-integration-request.factory';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import type { RequestIdentityContext } from '../../src/identity/identity-context.types';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { IdxMenuDetailValidator } from '../../apps/identity-bridge/src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../apps/identity-bridge/src/idx/permission-normalizer';
import { ScopeProjector } from '../../apps/identity-bridge/src/idx/scope-projector';
import { menu, response } from '../../apps/identity-bridge/test/fixtures/idx-semantic.vectors';

const dashboardRead = 'menu:SCM_DASHBOARD:read';

function identity(scopes: string[]): RequestIdentityContext {
  return {
    customer: { customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local' },
    organization: { organizationId: 'synthetic-org' },
    hostApp: { hostApp: 'shinmone-scm' },
    actor: { actorId: 'synthetic-user', roles: [], permissionScopes: scopes },
    auth: { tokenId: 'synthetic-jti', gatewayIssuer: 'https://synthetic-gateway.test' },
    requestId: 'req-synthetic-trust'
  };
}

function resolvedTool() {
  const catalog = JSON.parse(readFileSync('test/fixtures/shinmone-kpistats-demo-tool-catalog.json', 'utf8')) as {
    tools: Array<Record<string, unknown> & { name: string; requiredPermissions: string[] }>
  };
  const staged = catalog.tools.find((entry) => entry.name === 'shinmone.kpistats.snapshot.today');
  if (!staged) throw new Error('SYNTHETIC_DASHBOARD_TOOL_MISSING');
  return {
    tool: {
      id: 'synthetic-dashboard', key: staged.name, name: staged.name,
      version: '1.0.0', description: staged.description, operation: ToolOperation.read,
      riskLevel: RiskLevel.low, active: true, connectorKey: 'business', timeoutMs: 5000,
      requiredPermissionScopes: staged.requiredPermissions,
      inputSchema: staged.inputSchema, outputSchema: staged.outputSchema, hasSideEffect: false,
      requiresConfirmation: false, requiresApproval: false
    }, requiredRoles: [], requiredPermissionScopes: []
  } as never;
}

describe('Shinmone Assistant permission and company trust boundary (production classes, synthetic context)', () => {
  it('projects Dashboard read from the presence of a native MenuDetail menu, not an explicit Read flag', () => {
    const validator = new IdxMenuDetailValidator();
    const normalizer = new IdxPermissionNormalizer();
    const projector = new ScopeProjector();
    const withDashboard = validator.validate(response([menu({ MenuID: 'SCM_DASHBOARD' })]));
    const withoutDashboard = validator.validate(response([]));
    expect(projector.project(normalizer.normalize(withDashboard))).toContain(dashboardRead);
    expect(projector.project(normalizer.normalize(withoutDashboard))).not.toContain(dashboardRead);
  });

  it.each([
    [[], false],
    [['orders:read'], false],
    [[dashboardRead], true]
  ])('prechecks the required Dashboard scope before Tool execution for scopes %j', async (scopes, allowed) => {
    const audit = { append: jest.fn(), appendCustomerToolEvent: jest.fn() };
    const context = identity(scopes);
    const result = await new ToolPermissionPrecheckService(audit as never).checkResolvedCustomerTool({
      requestId: context.requestId, sessionId: 'synthetic-session', messageId: 'synthetic-message',
      identityContext: context, customerScope: createCustomerScopeFromIdentityContext(context), resolvedTool: resolvedTool()
    });
    expect(result.allowed).toBe(allowed);
    if (!allowed) {
      expect(result.reason).toBe('missing_scope');
      expect(audit.appendCustomerToolEvent).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects a mismatched Customer/integration/HostApp/organization at the host-context boundary', () => {
    const context = identity([dashboardRead]);
    const expected = createCustomerScopeFromIdentityContext(context);
    const factory = new HostIntegrationRequestFactory();
    for (const mismatch of [
      { customerId: 'other-customer' }, { integrationId: 'other-integration' },
      { hostApp: 'other-app' }, { organizationId: 'other-organization' }
    ]) {
      expect(() => factory.createHostContext(context, { ...expected, ...mismatch })).toThrow(NotFoundException);
    }
  });

  it('documents the current company-proof gap: CustomerScope has org ID but no category, code, or authorized-company set', () => {
    const scope = createCustomerScopeFromIdentityContext(identity([dashboardRead]));
    expect(scope.organizationId).toBe('synthetic-org');
    expect(scope).not.toHaveProperty('companyCategory');
    expect(scope).not.toHaveProperty('companyCode');
    expect(scope).not.toHaveProperty('vendorCode');
    expect(scope).not.toHaveProperty('authorizedCompanies');
  });
});

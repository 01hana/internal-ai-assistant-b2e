import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { QueryScopeValidationService } from '../../src/query-scope/query-scope-validation.service';
import type { QueryScopeActivation, QueryScopeEvaluationInput, QueryScopeRegistration } from '../../src/query-scope/query-scope.types';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';

describe('Final acceptance: exact Query Scope activation selection', () => {
  const base: QueryScopeActivation = {
    customerId: 'customer-a', integrationId: 'integration-one', hostApp: 'host-one',
    capabilityKey: 'count.one', bindingId: 'binding-one', toolKey: 'shared.count', toolVersion: '1.0.0'
  };
  const policy = { evaluate: jest.fn(() => ({ outcome: 'DENY' as const,
    reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' as const })) };
  const identityContext = {
    customer: { customerId: 'customer-a', integrationId: 'integration-one' },
    organization: { organizationId: 'org-a' }, hostApp: { hostApp: 'host-one' },
    actor: { actorId: 'actor-a', roles: [], permissionScopes: [] },
    auth: { tokenId: 'synthetic', gatewayIssuer: 'synthetic' }, requestId: 'request-a'
  };
  const input: QueryScopeEvaluationInput = {
    customerScope: createCustomerScopeFromIdentityContext(identityContext), identityContext,
    integrationId: 'integration-one', hostApp: 'host-one', requestId: 'request-a',
    sessionId: 'session-a', sourceMessageId: 'message-a', capabilityKey: 'count.one',
    bindingId: 'binding-one', toolKey: 'shared.count', toolVersion: '1.0.0'
  };

  function service(activations: QueryScopeActivation[], registrations: QueryScopeRegistration[]) {
    const append = jest.fn().mockResolvedValue({});
    const instance = new QueryScopeValidationService(activations, registrations,
      { db: { assistantMessage: { findFirst: jest.fn().mockResolvedValue({ content: '另一家公司數量' }) } } } as never,
      { append } as never, new CapabilityCatalogRegistry());
    return { instance, append };
  }

  it.each([
    ['different integration', { ...base, integrationId: 'integration-two' }],
    ['different HostApp', { ...base, hostApp: 'host-two' }],
    ['different capability and binding', { ...base, capabilityKey: 'count.two', bindingId: 'binding-two' }]
  ])('selects the exact activated policy with same tool key and %s', async (_label, other) => {
    policy.evaluate.mockClear();
    const otherPolicy = { evaluate: jest.fn(() => ({ outcome: 'ALLOW' as const,
      reason: 'QUERY_SCOPE_VALIDATED' as const })) };
    const { instance } = service([base, other], [{ ...base, policy }, { ...other, policy: otherPolicy }]);
    expect(await instance.evaluate(input)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
    expect(policy.evaluate).toHaveBeenCalledTimes(1);
    expect(otherPolicy.evaluate).not.toHaveBeenCalled();
  });

  it('does not apply an activation from an unrelated integration', async () => {
    const other = { ...base, integrationId: 'integration-two' };
    const { instance } = service([other], [{ ...other, policy }]);
    expect(await instance.evaluate(input)).toEqual({ outcome: 'NOT_APPLICABLE' });
  });

  it.each([
    ['missing registration', []],
    ['conflicting registrations', [{ ...base, policy }, { ...base, policy }]],
    ['registration version drift', [{ ...base, toolVersion: '2.0.0', policy }]]
  ])('fails closed for an exact activation with %s', async (_label, registrations) => {
    const { instance } = service([base], registrations);
    expect(await instance.evaluate(input)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
  });
});

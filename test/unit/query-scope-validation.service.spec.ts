import { QueryScopeValidationService } from '../../src/query-scope/query-scope-validation.service';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { parseCustomerCapabilityPackV1 } from '../../src/capabilities/capability-pack.parser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { syntheticQueryScopeRegistration } from '../support/query-scope.fixture';
import type { PreCandidateQueryScopeApplicabilityV1, QueryScopeEvaluationInput, QueryScopeRegistration } from '../../src/query-scope/query-scope.types';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';

// CORE_CONTRACT: exact scoped activation, fail-closed errors, bounded audit; no HTTP authority claim.
describe('[CORE_CONTRACT] QueryScopeValidationService', () => {
  const registration = syntheticQueryScopeRegistration({
    customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp'
  });
  const identityContext = {
    customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
    organization: { organizationId: 'org-a' }, hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-a', roles: [], permissionScopes: [] },
    auth: { tokenId: 'synthetic', gatewayIssuer: 'synthetic' }, requestId: 'request-a'
  };
  const input = {
    customerScope: createCustomerScopeFromIdentityContext(identityContext),
    identityContext,
    integrationId: 'integration-erp', hostApp: 'erp', requestId: 'request-a', sessionId: 'session-a',
    sourceMessageId: 'message-a', capabilityKey: 'work-orders.count',
    bindingId: 'work-orders.monthly-new-count', toolKey: 'work-orders.monthly-new-count',
    toolVersion: '1.0.0'
  } satisfies QueryScopeEvaluationInput;
  const pack = parseCustomerCapabilityPackV1(JSON.parse(readFileSync(resolve('customers/shinmone/test/fixtures/capability-packs/shinmone-trust-negative.v1.json'), 'utf8')));
  const { hostApps: _hostApps, active: _active, ...catalogDefinition } = pack;
  const catalog = { ...catalogDefinition, hostApp: 'erp' };
  const applicability: PreCandidateQueryScopeApplicabilityV1 = {
    version: '1', scope: { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' },
    packId: pack.packId, packVersion: pack.packVersion, capabilityKey: registration.capabilityKey,
    bindingId: registration.bindingId, bindingVersion: '1.0.0', toolKey: registration.toolKey,
    toolVersion: registration.toolVersion, sourceMessageId: input.sourceMessageId,
    evidenceSource: 'CURRENT_SCOPED_SEMANTIC'
  };
  const preCandidateInput = { customerScope: input.customerScope, identityContext: input.identityContext,
    integrationId: input.integrationId, hostApp: input.hostApp, requestId: input.requestId,
    sessionId: input.sessionId, sourceMessageId: input.sourceMessageId, applicability };

  function harness(registrations: readonly QueryScopeRegistration[], activations = registrations, options: Readonly<{
    content?: string; previousOutcomes?: readonly string[];
  }> = {}) {
    const findFirst = jest.fn().mockResolvedValue({ content: options.content ?? '查另一家公司的本月新增工單數' });
    const findMany = jest.fn().mockResolvedValue(options.previousOutcomes
      ? [{ id: input.sourceMessageId }, { id: 'message-previous' }] : [{ id: input.sourceMessageId }]);
    const auditFindMany = jest.fn().mockResolvedValue((options.previousOutcomes ?? [])
      .map((outcome) => ({ metadata: { outcome } })));
    const append = jest.fn().mockResolvedValue({});
    const catalogs = new CapabilityCatalogRegistry();
    catalogs.installRelease([catalog]);
    const service = new QueryScopeValidationService(activations, registrations,
      { db: { assistantMessage: { findFirst, findMany }, auditEvent: { findMany: auditFindMany } } } as never,
      { append } as never, catalogs);
    return { service, findFirst, findMany, auditFindMany, append };
  }

  describe('previous-turn scope outcome', () => {
    it.each([
      ['no previous scoped turn', undefined, '這個月新增幾張工單？', 'ALLOW'],
      ['a previously allowed turn', ['ALLOW'], '那這個月呢？', 'ALLOW'],
      ['a previously denied turn', ['DENY'], '那這個月呢？', 'CLARIFY'],
      ['a previously ambiguous turn', ['CLARIFY'], '那本月新增工單數呢？', 'CLARIFY'],
      ['a denied turn followed by an explicit current-company follow-up', ['DENY'], '那本公司這個月呢？', 'ALLOW'],
      ['a denied turn followed by another other-company follow-up', ['DENY'], '那另一家公司這個月呢？', 'DENY']
    ] as const)('classifies a follow-up after %s', async (_label, previousOutcomes, content, outcome) => {
      const { service, findMany, auditFindMany } = harness([registration], [registration],
        { content, ...(previousOutcomes ? { previousOutcomes } : {}) });
      expect((await service.evaluate(input)).outcome).toBe(outcome);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { customerId: 'customer-a', sessionId: input.sessionId, role: 'user' }, take: 2 }));
      if (previousOutcomes) {
        expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
          customerId: 'customer-a', sessionId: input.sessionId, messageId: 'message-previous',
          eventType: 'query_scope_validation_completed' }) }));
      } else expect(auditFindMany).not.toHaveBeenCalled();
    });

    it('does not look back when the current message is not the latest user turn', async () => {
      const { service, findMany, auditFindMany } = harness([registration], [registration], { content: '那這個月呢？' });
      findMany.mockResolvedValue([{ id: 'message-newer' }, { id: input.sourceMessageId }]);
      expect((await service.evaluate(input)).outcome).toBe('ALLOW');
      expect(auditFindMany).not.toHaveBeenCalled();
    });

    it('fails closed when the previous turn cannot be read', async () => {
      const { service, findMany } = harness([registration], [registration], { content: '那這個月呢？' });
      findMany.mockRejectedValue(new Error('offline'));
      expect(await service.evaluate(input)).toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    });
  });

  it('denies only with current scoped and exact pre-candidate evidence', async () => {
    const { service, append } = harness([registration]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ requestId: input.requestId,
      messageId: input.sourceMessageId, eventType: 'query_scope_validation_completed',
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE',
        mode: 'pre_candidate_deny_only' }) }));
  });

  it.each([
    ['other integration', { ...registration, integrationId: 'integration-other' }],
    ['other HostApp', { ...registration, hostApp: 'other' }],
    ['other Capability and Binding', { ...registration, capabilityKey: 'other.count', bindingId: 'other.binding' }]
  ])('keeps deny-only selection exact when a same-key %s activation exists', async (_label, other) => {
    const otherPolicy = { evaluate: jest.fn(() => ({ outcome: 'ALLOW' as const,
      reason: 'QUERY_SCOPE_VALIDATED' as const })) };
    const { service, append } = harness([registration, { ...other, policy: otherPolicy }],
      [registration, other]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
    expect(otherPolicy.evaluate).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ requestId: input.requestId,
      messageId: input.sourceMessageId, metadata: expect.objectContaining({
        reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE', mode: 'pre_candidate_deny_only' }) }));
  });

  it('does not turn a same-key foreign-scope activation into an applicable deny-only policy', async () => {
    const other = { ...registration, integrationId: 'integration-other' };
    const { service, append, findFirst } = harness([other], [other]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'NOT_APPLICABLE' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('fails closed when the activated exact pre-candidate registration is absent among same-key entries', async () => {
    const other = { ...registration, capabilityKey: 'other.count', bindingId: 'other.binding' };
    const { service, append } = harness([other], [registration, other]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ requestId: input.requestId,
      messageId: input.sourceMessageId, metadata: expect.objectContaining({
        reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE', mode: 'pre_candidate_deny_only' }) }));
  });

  it('never turns a pre-candidate policy allow into execution authority', async () => {
    const { service, findFirst, append } = harness([registration]);
    findFirst.mockResolvedValue({ content: '本公司本月新增工單數' });
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'NOT_APPLICABLE' });
    expect(append).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled policy', undefined, []],
    ['another Customer', { scope: { ...applicability.scope, customerId: 'customer-b' } }, [registration]],
    ['another integration', { scope: { ...applicability.scope, integrationId: 'other' } }, [registration]],
    ['another HostApp', { scope: { ...applicability.scope, hostApp: 'other' } }, [registration]],
    ['another Pack', { packId: 'other-pack' }, [registration]],
    ['stale Pack', { packVersion: '0.9.0' }, [registration]],
    ['inactive or unknown Capability', { capabilityKey: 'work-orders.retired' }, [registration]],
    ['wrong binding', { bindingId: 'work-orders.other' }, [registration]],
    ['wrong binding version', { bindingVersion: '2.0.0' }, [registration]],
    ['wrong Tool version', { toolVersion: '2.0.0' }, [registration]],
    ['wrong source message', { sourceMessageId: 'prior-message' }, [registration]]
  ])('does not infer policy applicability from %s', async (_label, override, activations) => {
    const { service, findFirst, append } = harness([registration], activations as readonly QueryScopeRegistration[]);
    expect(await service.evaluatePreCandidate({ ...preCandidateInput,
      applicability: { ...applicability, ...(override ?? {}) } })).toEqual({ outcome: 'NOT_APPLICABLE' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('fails closed if an exact activated pre-candidate policy has no registration', async () => {
    const { service, append } = harness([], [registration]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' }) }));
  });

  it.each([
    ['missing validator', { ...registration, policy: undefined }],
    ['registration version drift', { ...registration, toolVersion: '2.0.0' }]
  ])('fails closed for an activated pre-candidate %s', async (_label, entry) => {
    const { service, append } = harness([entry], [registration]);
    expect(await service.evaluatePreCandidate(preCandidateInput)).toEqual({ outcome: 'DENY',
      reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' }) }));
  });

  it('cannot return a denial after its required audit write fails', async () => {
    const { service, append } = harness([registration]);
    append.mockRejectedValue(new Error('audit offline'));
    await expect(service.evaluatePreCandidate(preCandidateInput)).rejects.toThrow('audit offline');
  });

  it('does not apply another Customer policy', async () => {
    const { service, findFirst, append } = harness([registration]);
    const result = await service.evaluate({ ...input,
      customerScope: { ...input.customerScope, customerId: 'customer-b' } });
    expect(result).toEqual({ outcome: 'NOT_APPLICABLE' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('accepts and audits a Customer-neutral denial reason from the Customer policy', async () => {
    const { service, append } = harness([registration]);
    expect(await service.evaluate(input)).toEqual({
      outcome: 'DENY', reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'
    });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' })
    }));
  });

  it.each([
    ['missing validator', { ...registration, policy: undefined }],
    ['version drift', registration]
  ])('fails closed for %s', async (label, entry) => {
    const { service, append } = harness([entry]);
    const result = await service.evaluate(label === 'version drift' ? { ...input, toolVersion: '2.0.0' } : input);
    expect(result).toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'query_scope_validation_completed',
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' })
    }));
  });

  it('fails closed when an active Tool has no registered validator entry', async () => {
    const { service, append } = harness([], [registration]);
    expect(await service.evaluate(input)).toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' })
    }));
  });

  it('does not return ALLOW if the security audit cannot be persisted', async () => {
    const { service, append } = harness([registration]);
    append.mockRejectedValue(new Error('audit offline'));
    await expect(service.evaluate(input)).rejects.toThrow('audit offline');
  });
});

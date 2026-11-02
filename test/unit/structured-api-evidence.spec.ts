import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import { GroundedToolEvidenceNormalizer } from '../../src/assistant/grounding/grounded-tool-evidence.normalizer';
import { GenerationContextProjectorService } from '../../src/assistant/generation/generation-context-projector.service';
import { GroundedGenerationPromptService } from '../../src/assistant/generation/grounded-generation-prompt.service';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';
import type { RegisteredToolDefinition, ToolResultPolicyResolution } from '../../src/tools/tool-registry.types';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';

const integer = { type: 'integer', minimum: 0 };
const valueSchema = { type: 'object', additionalProperties: false, required: ['Current', 'Previous'],
  properties: { Current: { ...integer, description: '本期件數', 'x-unit': '件', 'x-period': 'current' }, Previous: integer } };
const baseProperties = {
  ReportId: { type: 'string', description: '報表識別' },
  NewOrders: valueSchema, LateOrders: valueSchema,
  CompletionRate: { type: 'number', description: '完工比率', 'x-unit': '%' },
  Period: { type: 'string', description: '統計期間' },
  Categories: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false,
    required: ['Name', 'Count'], properties: { Name: { type: 'string' }, Count: integer } } },
  OptionalNote: { type: ['string', 'null'] }
};
const baseFacts = {
  ReportId: 'synthetic-20261023', NewOrders: { Current: 8, Previous: 5 }, LateOrders: { Current: 2, Previous: 3 },
  CompletionRate: 87.25, Period: 'today', Categories: [{ Name: 'A', Count: 4 }, { Name: 'B', Count: 6 }], OptionalNote: null
};
const scope = { customerId: 'synthetic-a', integrationId: 'synthetic-i', sessionId: 'synthetic-session',
  organizationId: 'synthetic-org', hostApp: 'synthetic-host', actorId: 'synthetic-actor' };

function tool(properties: Record<string, unknown> = baseProperties): RegisteredToolDefinition {
  return { id: 'synthetic-tool-1', key: 'synthetic.dashboard.snapshot', name: 'Synthetic dashboard snapshot',
    version: '1.0.0', description: 'Approved synthetic dashboard snapshot',
    operation: 'read', inputSchema: { type: 'object', required: [], properties: {} },
    outputSchema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
    requiredPermissionScopes: ['dashboard:read'], riskLevel: 'low' as RegisteredToolDefinition['riskLevel'], hasSideEffect: false,
    requiresConfirmation: false, requiresApproval: false, connectorKey: 'synthetic', timeoutMs: 1000,
    active: true };
}

function policy(): Extract<ToolResultPolicyResolution, { allowed: true }> {
  return { allowed: true, policy: { version: '1', allowedFieldPaths: Object.keys(baseProperties), deniedFieldPaths: [],
    permissionMasks: [], limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16 * 1024 },
    evidenceSafeProvenanceFields: ['ReportId'] } };
}

function project(facts: Record<string, unknown>, definition = tool(), resultPolicy: ToolResultPolicyResolution = policy(),
  permissionScopes: readonly string[] = ['dashboard:read']) {
  return new AdapterResultProjectorService(new LlmInputSanitizerService()).project({
    tool: definition, resultPolicy, rawResult: facts, permissionScopes });
}

function generation(facts: Record<string, unknown>, definition = tool(), resultPolicy: ToolResultPolicyResolution = policy()) {
  const projected = project(facts, definition, resultPolicy);
  if (!projected.projected) throw new Error('SYNTHETIC_PROJECTION_REJECTED');
  const normalizer = new GroundedToolEvidenceNormalizer();
  const evidence = normalizer.normalize({ needId: 'need-1', evidenceRefId: 'evidence-1', toolCallId: 'call-1',
    canonicalToolKey: definition.key, status: 'success', executionStatus: 'executed', projectionStatus: 'succeeded',
    evidenceAttached: true, projectedFacts: projected.result.facts, declaredFieldPaths: projected.result.fieldPaths,
    fieldMetadata: projected.result.fieldMetadata, observedAt: '2026-10-23T00:00:00Z' });
  const bundle: GroundedContextBundleV1 = { version: '1', currentRequest: { messageId: 'message-1', normalizedQuestion: '請摘要報表' },
    conversationContext: { boundedRecentTurns: [] }, retrieval: { mode: 'TOOL', requestedNeeds: [{ id: 'need-1', kind: 'TOOL' }],
      needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['evidence-1'] }], coverage: 'COMPLETE' },
    evidence: [evidence], citations: [normalizer.createCitation(evidence)], unsupportedNeeds: [], locale: 'zh-TW' } as unknown as GroundedContextBundleV1;
  const context = new GenerationContextProjectorService().project({ scope, context: {
    scope, exchanges: [], completedAssistantAnswers: [], selectedExchangeIdsNewestFirst: [], chronologicalExchangeIds: [],
    semanticFrames: [], capabilityFrames: [], evidenceRefs: [], evidenceRefIds: [], rejectedReasonCodes: []
  } as never, bundle });
  const prompt = new GroundedGenerationPromptService().build(context, { requestId: 'request-1', sessionId: scope.sessionId, messageId: 'message-1' });
  return { projected: projected.result, evidence, context, prompt };
}

describe('schema driven structured API evidence', () => {
  it('passes different fields, comparison values, arrays, null, and trusted semantics to one generation prompt', () => {
    const result = generation(baseFacts);
    expect(result.context.toolEvidence[0].facts).toEqual(baseFacts);
    expect(result.context.toolEvidence[0].fieldMetadata).toEqual(expect.objectContaining({
      'NewOrders.Current': { description: '本期件數', unit: '件', period: 'current' },
      CompletionRate: { description: '完工比率', unit: '%' }
    }));
    expect(result.evidence.fieldPaths).toEqual(expect.arrayContaining(['NewOrders.Current', 'LateOrders.Previous', 'Categories']));
    expect(result.context.allowedEvidenceRefIds).toEqual(['evidence-1']);
    expect(result.prompt.instructions).toContain('citation-need-1-1');
    const text = JSON.stringify(result.prompt.messages);
    for (const fragment of ['87.25', 'LateOrders', 'Categories', 'Previous', 'FIELD_METADATA']) expect(text).toContain(fragment);
  });


  it('accepts a newly approved ordinary field without changing Tool key or projection code', () => {
    const fields = { ...baseProperties, CustomerSatisfaction: { type: 'number', description: '滿意度', 'x-unit': '分' } };
    const result = generation({ ...baseFacts, CustomerSatisfaction: 4.5 }, tool(fields), {
      allowed: true, policy: { ...policy().policy, allowedFieldPaths: Object.keys(fields) }
    });
    expect(result.context.toolEvidence[0].facts).toEqual(expect.objectContaining({ CustomerSatisfaction: 4.5 }));
    expect(JSON.stringify(result.prompt.messages)).toContain('CustomerSatisfaction');
  });

  it('rejects unknown, missing, malformed, and oversized data rather than presenting partial statistics', () => {
    for (const facts of [
      { ...baseFacts, Unknown: 1 }, { ...baseFacts, LateOrders: undefined },
      { ...baseFacts, CompletionRate: '87.25' }, { ...baseFacts, Categories: Array(101).fill({ Name: 'A', Count: 1 }) }
    ]) expect(project(facts)).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    const small = { allowed: true, policy: { ...policy().policy, limits: { ...policy().policy.limits, maxTotalBytes: 100 } } } as ToolResultPolicyResolution;
    expect(project(baseFacts, tool(), small).projected).toBe(false);
  });

  it('does not release an unapproved sensitive field or a masked subtree', () => {
    const raw = { ...baseFacts, InternalToken: 'synthetic-secret' };
    expect(project(raw).projected).toBe(false);
    const hidden = { ...baseProperties, InternalToken: { type: 'string' } };
    const limited = { allowed: true, policy: { ...policy().policy, allowedFieldPaths: Object.keys(baseProperties),
      deniedFieldPaths: ['InternalToken'] } } as ToolResultPolicyResolution;
    const result = project(raw, tool(hidden), limited);
    expect(result.projected).toBe(true);
    if (result.projected) expect(JSON.stringify(result.result)).not.toContain('synthetic-secret');
    const parentGrant = { allowed: true, policy: { ...policy().policy,
      allowedFieldPaths: ['NewOrders', 'ReportId'], deniedFieldPaths: ['NewOrders.Current'] } } as ToolResultPolicyResolution;
    expect(project(baseFacts, tool(), parentGrant).projected).toBe(false);
    const nestedMask = { allowed: true, policy: { ...policy().policy,
      allowedFieldPaths: ['NewOrders', 'ReportId'], permissionMasks: [{ fieldPath: 'NewOrders.Current',
        requiredPermissionScopes: ['metric:current:read'], action: 'omit' as const }] } } as ToolResultPolicyResolution;
    expect(project(baseFacts, tool(), nestedMask).projected).toBe(false);
    const arrayMask = { allowed: true, policy: { ...policy().policy,
      allowedFieldPaths: ['Categories', 'ReportId'], permissionMasks: [{ fieldPath: 'Categories.Count',
        requiredPermissionScopes: ['category:count:read'], action: 'omit' as const }] } } as ToolResultPolicyResolution;
    expect(project(baseFacts, tool(), arrayMask).projected).toBe(false);
    const arrayDenied = { allowed: true, policy: { ...policy().policy,
      allowedFieldPaths: ['Categories', 'ReportId'], deniedFieldPaths: ['Categories.Count'] } } as ToolResultPolicyResolution;
    expect(project(baseFacts, tool(), arrayDenied).projected).toBe(false);
    const registry = new ToolRegistryService({} as never, {} as never);
    const withArrayMask = tool();
    if (!arrayMask.allowed) throw new Error('TEST_POLICY_INVALID');
    withArrayMask.outputSchema['x-assistant-result-policy'] = arrayMask.policy;
    expect(registry.resolveResultPolicy(withArrayMask)).toEqual({ allowed: false, reason: 'invalid_result_policy' });
  });

  it('rejects unsupported literal field names before dotted paths can become ambiguous', () => {
    for (const key of ['Metric.Current', 'Display-Name', '__proto__']) {
      const fields = { ...baseProperties, [key]: { type: 'number' } };
      const raw = { ...baseFacts, [key]: 1 };
      expect(project(raw, tool(fields), { allowed: true, policy: { ...policy().policy,
        allowedFieldPaths: Object.keys(fields) } })).toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
    }
    expect(() => new GroundedToolEvidenceNormalizer().normalize({ needId: 'need-1', evidenceRefId: 'evidence-1',
      toolCallId: 'call-1', canonicalToolKey: 'synthetic.dashboard.snapshot', status: 'success', executionStatus: 'executed',
      projectionStatus: 'succeeded', evidenceAttached: true, projectedFacts: { 'Metric.Current': 1 },
      declaredFieldPaths: ['Metric.Current'], observedAt: '2026-10-23T00:00:00Z' })).toThrow();
  });

  it('fails closed when the bounded generation allocation cannot fit the whole approved result', () => {
    const fields = { ...baseProperties, Narrative: { type: 'string' } };
    const large = { ...baseFacts, Narrative: 'x'.repeat(4000) };
    const approved = { allowed: true, policy: { ...policy().policy, allowedFieldPaths: Object.keys(fields),
      limits: { ...policy().policy.limits, maxStringLength: 5000 } } } as ToolResultPolicyResolution;
    expect(project(large, tool(fields), approved).projected).toBe(true);
    expect(() => generation(large, tool(fields), approved)).toThrow('GENERATION_CONTEXT_INVALID');
  });
});

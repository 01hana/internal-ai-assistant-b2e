import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import { approvedOutputSummary } from '../../src/query-understanding/tool-capability-summary';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition, ToolResultPolicyV1 } from '../../src/tools/tool-registry.types';

describe('Tool discovery and Runtime result policy agreement', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['Totals', 'Rows'], properties: {
    Totals: { type: 'object', additionalProperties: false, required: ['Current', 'Private'], properties: {
      Current: { type: 'integer', description: '本期件數', 'x-unit': '件' },
      Private: { type: 'string', description: '受限制的內部值' }
    } },
    Rows: { type: 'array', maxItems: 2, description: '分類資料', items: { type: 'object', additionalProperties: false,
      required: ['Name', 'Count'], properties: { Name: { type: 'string' }, Count: { type: 'integer' } } } }
  } };
  const data = { Totals: { Current: 8, Private: 'hidden' }, Rows: [{ Name: 'A', Count: 4 }] };
  const registry = new ToolRegistryService({} as never, {} as never);
  const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
  const policy = (overrides: Partial<ToolResultPolicyV1> = {}): ToolResultPolicyV1 => ({
    version: '1', allowedFieldPaths: ['Totals.Current', 'Rows'], deniedFieldPaths: [], permissionMasks: [],
    evidenceSafeProvenanceFields: [], limits: { maxDepth: 4, maxItems: 10, maxStringLength: 128, maxTotalBytes: 4096 },
    ...overrides
  });
  const tool = (rule: ToolResultPolicyV1): RegisteredToolDefinition => ({
    key: 'synthetic.summary', name: 'synthetic.summary', version: '1.0.0', id: 'synthetic', description: 'Synthetic',
    outputSchema: { ...schema, 'x-assistant-result-policy': rule },
    inputSchema: { type: 'object', required: [] }, requiredPermissionScopes: [],
    active: true, operation: 'read', riskLevel: 'low', connectorKey: 'synthetic', timeoutMs: 1000,
    hasSideEffect: false, requiresApproval: false, requiresConfirmation: false
  } as RegisteredToolDefinition);
  const check = (rule: ToolResultPolicyV1, scopes: string[] = []) => {
    const definition = tool(rule);
    const resolved = registry.resolveResultPolicy(definition);
    const summary = resolved.allowed ? approvedOutputSummary(definition, resolved.policy, scopes) : [];
    const projected = projector.project({ tool: definition, resultPolicy: resolved, rawResult: data, permissionScopes: scopes });
    return { resolved, summary, projected };
  };

  it('offers directly projectable object values and describes array items without inventing array child paths', () => {
    const { resolved, summary, projected } = check(policy());
    expect(resolved.allowed).toBe(true);
    expect(summary).toEqual(expect.arrayContaining([
      { path: 'Totals.Current', type: 'integer', description: '本期件數', unit: '件' },
      { path: 'Rows', type: 'array', description: '分類資料', itemFields: [
        { name: 'Name', type: 'string' }, { name: 'Count', type: 'integer' }
      ] }
    ]));
    expect(JSON.stringify(summary)).not.toContain('Rows.Count');
    expect(JSON.stringify(summary)).not.toContain('Private');
    expect(projected.projected).toBe(true);
    if (projected.projected) {
      expect(projected.result.fieldPaths).toEqual(['Rows', 'Totals.Current']);
      expect(projected.result.facts).toEqual({ Totals: { Current: 8 }, Rows: [{ Name: 'A', Count: 4 }] });
    }
  });

  it('does not advertise a parent subtree that Runtime refuses because a child is denied', () => {
    const { resolved, summary, projected } = check(policy({ allowedFieldPaths: ['Totals', 'Rows'],
      deniedFieldPaths: ['Totals.Private'] }));
    expect(resolved.allowed).toBe(true);
    expect(summary).toEqual([]);
    expect(projected.projected).toBe(false);
  });

  it('does not reveal masked field names to an actor without the required permission', () => {
    const rule = policy({ allowedFieldPaths: ['Totals.Current', 'Totals.Private', 'Rows'],
      permissionMasks: [{ fieldPath: 'Totals.Private', action: 'omit', requiredPermissionScopes: ['private:read'] }] });
    const without = check(rule);
    expect(without.resolved.allowed).toBe(true);
    expect(JSON.stringify(without.summary)).not.toContain('Private');
    expect(without.projected.projected).toBe(true);
    const withPermission = check(rule, ['private:read']);
    expect(JSON.stringify(withPermission.summary)).toContain('Private');
    expect(withPermission.projected.projected).toBe(true);
  });

  it('rejects an array item path that Registry cannot resolve as a direct policy path', () => {
    const result = check(policy({ allowedFieldPaths: ['Rows.Count'] }));
    expect(result.resolved).toEqual({ allowed: false, reason: 'invalid_result_policy' });
    expect(result.summary).toEqual([]);
    expect(result.projected.projected).toBe(false);
  });

  it('keeps discovery metadata bounded when the approved schema has many fields', () => {
    const fields = Object.fromEntries(Array.from({ length: 80 }, (_, index) =>
      [`Field${index}`, { type: 'integer', description: '已核准的合成統計欄位' }]));
    const definition = tool(policy());
    definition.outputSchema = { type: 'object', additionalProperties: false, required: [], properties: fields };
    const summary = approvedOutputSummary(definition, policy({ allowedFieldPaths: Object.keys(fields) }), []);
    expect(summary.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(JSON.stringify(summary), 'utf8')).toBeLessThanOrEqual(2048);
  });
});

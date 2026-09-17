import { loadFeature010Export } from '../support/feature010-red-contract.helper';

type EligibilityService = { evaluate(input: Record<string, unknown>): Record<string, any> };
type EligibilityServiceConstructor = new () => EligibilityService;
const SCOPE = Object.freeze({ customerId: 'customer-a', sessionId: 'session-1', organizationId: 'org-1', hostApp: 'erp', actorId: 'actor-1' });

describe('Feature 010 prior grounded evidence eligibility RED (T009)', () => {
  it('reuses document evidence only with active same-scope source, matching version, visibility, access, and permission [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    expect(service().evaluate({ evidence: documentEvidence(), currentScope: SCOPE, currentDocument: { active: true, version: 'v3', visible: true, accessible: true, permissionAllowed: true } }))
      .toMatchObject({ eligible: true, kind: 'DOCUMENT' });
  });

  it('reuses Tool evidence only after current definition, policy, permission, projection, and grounding checks within 900 seconds [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    expect(service().evaluate({
      evidence: toolEvidence(), currentScope: SCOPE, now: '2026-09-17T01:14:59.000Z',
      currentAuthorization: { toolDefinitionActive: true, policyAllowed: true, permissionAllowed: true }
    })).toMatchObject({ eligible: true, kind: 'TOOL', maxAgeSeconds: 900 });
  });

  it('reports Hybrid item eligibility independently so orchestration can distinguish complete and incomplete sets [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const target = service();
    const document = target.evaluate({ evidence: documentEvidence(), currentScope: SCOPE, currentDocument: validDocument() });
    const tool = target.evaluate({ evidence: toolEvidence(), currentScope: SCOPE, now: '2026-09-17T01:10:00.000Z', currentAuthorization: authorized() });
    const staleTool = target.evaluate({ evidence: toolEvidence(), currentScope: SCOPE, now: '2026-09-17T01:15:01.000Z', currentAuthorization: authorized() });
    expect([document, tool]).toEqual([
      expect.objectContaining({ evidenceRefId: 'evidence-document', needId: 'need-document', eligible: true }),
      expect.objectContaining({ evidenceRefId: 'evidence-tool', needId: 'need-tool', eligible: true })
    ]);
    expect([document, tool].every((item) => item.eligible)).toBe(true);
    expect([document, staleTool].every((item) => item.eligible)).toBe(false);
    expect(document).not.toHaveProperty('mode');
    expect(tool).not.toHaveProperty('coverage');
  });

  it.each([
    ['Assistant prose', { evidence: { kind: 'ASSISTANT_PROSE', content: '17' } }],
    ['stale Tool evidence', { evidence: toolEvidence(), now: '2026-09-17T01:15:01.000Z', currentAuthorization: authorized() }],
    ['revoked Tool policy', { evidence: toolEvidence(), now: '2026-09-17T01:10:00.000Z', currentAuthorization: { ...authorized(), policyAllowed: false } }],
    ['failed ToolCall', { evidence: { ...toolEvidence(), status: 'failed', executionStatus: 'failed' }, now: '2026-09-17T01:10:00.000Z', currentAuthorization: authorized() }],
    ['raw Tool data', { evidence: { ...toolEvidence(), rawResponse: { quantity: 999 } }, now: '2026-09-17T01:10:00.000Z', currentAuthorization: authorized() }],
    ['malformed document', { evidence: { ...documentEvidence(), documentVersion: undefined }, currentDocument: validDocument() }],
    ['ungrounded evidence', { evidence: { ...documentEvidence(), groundingCovered: false }, currentDocument: validDocument() }],
    ['cross-Customer evidence', { evidence: { ...documentEvidence(), scope: { ...SCOPE, customerId: 'customer-b' } }, currentDocument: validDocument() }]
  ])('rejects %s [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (_case, input) => {
    expect(service().evaluate({ currentScope: SCOPE, ...input })).toMatchObject({ eligible: false, reasonCode: expect.any(String) });
  });
});

function service(): EligibilityService {
  const Target = loadFeature010Export<EligibilityServiceConstructor>({
    taskId: 'T009', fromTestDirectory: __dirname,
    modulePath: '../../src/assistant/grounding/prior-grounded-evidence-eligibility.service',
    exportName: 'PriorGroundedEvidenceEligibilityService', capability: 'current-authorized prior grounded evidence reuse'
  });
  return new Target();
}
function documentEvidence() { return { kind: 'DOCUMENT', evidenceRefId: 'evidence-document', needId: 'need-document', scope: SCOPE, documentId: 'document-1', chunkId: 'chunk-1', documentVersion: 'v3', groundingCovered: true }; }
function toolEvidence() { return { kind: 'TOOL', evidenceRefId: 'evidence-tool', needId: 'need-tool', scope: SCOPE, status: 'success', executionStatus: 'executed', projectionStatus: 'succeeded', groundingCovered: true, observedAt: '2026-09-17T01:00:00.000Z' }; }
function authorized() { return { toolDefinitionActive: true, policyAllowed: true, permissionAllowed: true }; }
function validDocument() { return { active: true, version: 'v3', visible: true, accessible: true, permissionAllowed: true }; }

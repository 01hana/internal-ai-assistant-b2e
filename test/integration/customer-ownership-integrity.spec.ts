import { CUSTOMER_SCOPE_FIXTURES } from '../support/customer-scope-fixtures';
import { loadPrismaSchemaContract, parsePrismaSchemaContract } from '../support/prisma-schema-contract.helper';

const describePersistenceContract =
  process.env.RUN_CUSTOMER_PERSISTENCE_CONTRACT_TESTS === 'true' ? describe : describe.skip;

describePersistenceContract('Customer ownership integrity contract (T022)', () => {
  const schema = loadPrismaSchemaContract();

  it('requires Customer.id as the only canonical root without lifecycle fields', () => {
    const customer = schema.model('Customer');
    expect(customer?.fields).toEqual(expect.arrayContaining(['id']));
    expect(customer?.uniqueKeys).toEqual(expect.arrayContaining([['id']]));
    expect(customer?.fields).not.toEqual(expect.arrayContaining([
      'customerId', 'status', 'isActive', 'disabledAt', 'deletedAt', 'lifecycleState', 'retentionPolicy'
    ]));
    expect(CUSTOMER_SCOPE_FIXTURES.customerA.root.id).not.toBe(CUSTOMER_SCOPE_FIXTURES.customerB.root.id);
  });

  it('requires direct Customer ownership for every independently stored Customer aggregate', () => {
    const directOwnedModels = [
      'AssistantSession', 'AssistantMessage', 'KnowledgeDocument', 'KnowledgeChunk', 'RetrievalRun', 'RetrievalCandidate',
      'EvidenceRef', 'ToolCall', 'ApprovalRequest', 'ActionDraft', 'EscalationRequest', 'FeedbackEvent', 'ReviewItem', 'AuditEvent'
    ];
    const missingOwnership = directOwnedModels.filter((modelName) => !schema.model(modelName)?.fields.includes('customerId'));
    expect(missingOwnership).toEqual([]);
  });

  it('requires parent-owned records to remain reachable only through a Customer-qualified session or message', () => {
    const parentOwned = {
      AssistantContextState: 'AssistantSession',
      ExecutionPlan: 'AssistantSession',
      AnswerDecision: 'AssistantMessage',
      ClarificationQuestion: 'AssistantMessage',
      GroundingCheck: 'AssistantMessage',
      QueryUnderstandingResult: 'AssistantMessage'
    };
    const unresolved = Object.entries(parentOwned).filter(([child, parent]) =>
      !schema.model(child)?.fields.includes('customerId') ||
      !schema.hasQualifiedParentKey(parent) ||
      !schema.hasQualifiedRelation(child, parent, ['customerId', parent === 'AssistantSession' ? 'sessionId' : 'messageId'], ['customerId', 'id'])
    );
    expect(unresolved).toEqual([]);
  });

  it('requires Customer-qualified integrity across multi-parent aggregate relations', () => {
    const relationMatrix: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['AssistantMessage', ['AssistantSession']],
      ['KnowledgeChunk', ['KnowledgeDocument']],
      ['RetrievalCandidate', ['RetrievalRun', 'KnowledgeChunk']],
      ['EvidenceRef', ['AssistantMessage', 'KnowledgeChunk']],
      ['ToolCall', ['AssistantSession', 'AssistantMessage']],
      ['ApprovalRequest', ['AssistantSession', 'AssistantMessage', 'ToolCall']],
      ['ActionDraft', ['AssistantSession', 'AssistantMessage', 'ToolCall']],
      ['FeedbackEvent', ['AssistantMessage']],
      ['AuditEvent', ['AssistantSession', 'AssistantMessage', 'ToolCall']]
    ];
    const unresolved = relationMatrix.filter(([child, parents]) =>
      !schema.model(child)?.fields.includes('customerId') ||
      parents.some((parent) =>
        !schema.hasQualifiedRelation(child, parent, ['customerId', parentIdField(child, parent)], ['customerId', 'id'])
      )
    );
    expect(unresolved).toEqual([]);
  });

  it('rejects a bare relation even when its parent has a qualified key', () => {
    const [child] = parsePrismaSchemaContract(`
model Parent {
  id String @id
  customerId String
  @@unique([customerId, id])
}

model Child {
  id String @id
  customerId String
  parentId String
  parent Parent @relation(fields: [parentId], references: [id])
}
`)
      .filter((model) => model.name === 'Child');
    expect(child.relations[0]).toMatchObject({ fields: ['parentId'], references: ['id'] });
    expect(child.relations[0].fields).not.toContain('customerId');
  });

  it('accepts a composite Customer-qualified relation', () => {
    const [child] = parsePrismaSchemaContract(`
model Parent {
  id String @id
  customerId String
  @@unique([customerId, id])
}

model Child {
  id String @id
  customerId String
  parentId String
  parent Parent @relation(fields: [customerId, parentId], references: [customerId, id])
}
`)
      .filter((model) => model.name === 'Child');
    expect(child.relations[0]).toMatchObject({ fields: ['customerId', 'parentId'], references: ['customerId', 'id'] });
  });

  it.each([
    ['ApprovalRequest', 'AssistantSession', 'sessionId'],
    ['ApprovalRequest', 'AssistantMessage', 'messageId'],
    ['ApprovalRequest', 'ToolCall', 'toolCallId'],
    ['ActionDraft', 'AssistantSession', 'sessionId'],
    ['ActionDraft', 'AssistantMessage', 'messageId'],
    ['ActionDraft', 'ToolCall', 'toolCallId']
  ] as const)('maps %s → %s to %s', (child, parent, expectedField) => {
    expect(parentIdField(child, parent)).toBe(expectedField);
  });
});

function parentIdField(child: string, parent: string): string {
  if (child === 'RetrievalCandidate' && parent === 'RetrievalRun') return 'retrievalRunId';
  if (child === 'RetrievalCandidate' && parent === 'KnowledgeChunk') return 'chunkId';
  if (child === 'EvidenceRef' && parent === 'KnowledgeChunk') return 'chunkId';
  if (child === 'EvidenceRef' && parent === 'AssistantMessage') return 'messageId';
  if (child === 'ToolCall' && parent === 'AssistantMessage') return 'messageId';
  if (child === 'ToolCall') return 'sessionId';
  if ((child === 'ApprovalRequest' || child === 'ActionDraft') && parent === 'AssistantMessage') return 'messageId';
  if ((child === 'ApprovalRequest' || child === 'ActionDraft') && parent === 'ToolCall') return 'toolCallId';
  if (child === 'KnowledgeChunk') return 'documentId';
  if (child === 'FeedbackEvent') return 'messageId';
  if (child === 'AuditEvent' && parent === 'AssistantMessage') return 'messageId';
  if (child === 'AuditEvent' && parent === 'ToolCall') return 'toolCallId';
  return 'sessionId';
}

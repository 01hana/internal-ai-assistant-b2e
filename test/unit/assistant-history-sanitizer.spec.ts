import { AssistantHistorySanitizer } from '../../src/assistant/history/assistant-history.sanitizer';
import { ToolCallStatus } from '../../src/generated/prisma/enums';

describe('AssistantHistorySanitizer', () => {
  it('keeps only ids and stable status for authorized history artifacts', () => {
    const result = new AssistantHistorySanitizer().sanitizeAssistantArtifacts({
      permissionScopes: ['orders:read'],
      toolCalls: [
        {
          id: 'tool-call-001',
          status: ToolCallStatus.success
        }
      ],
      evidenceRefs: [
        {
          id: 'evidence-001',
          fieldPaths: ['status', 'customerName'],
          summary: { fields: { status: '已確認', amount: 128000 } },
          permissionSnapshot: { visibleFields: ['status'] }
        }
      ]
    });

    expect(result).toEqual({
      evidenceRefs: ['evidence-001'],
      toolSummary: {
        status: 'completed',
        toolCallIds: ['tool-call-001']
      }
    });
    expect(JSON.stringify(result)).not.toContain('128000');
    expect(JSON.stringify(result)).not.toContain('summary');
    expect(JSON.stringify(result)).not.toContain('permissionSnapshot');
  });

  it('does not expand evidence or tool summaries without read scope', () => {
    const result = new AssistantHistorySanitizer().sanitizeAssistantArtifacts({
      permissionScopes: [],
      toolCalls: [{ id: 'tool-call-001', status: ToolCallStatus.success }],
      evidenceRefs: [{ id: 'evidence-001', summary: { fields: { amount: 128000 } } }]
    });

    expect(result).toEqual({
      evidenceRefs: [],
      toolSummary: {
        status: 'completed',
        toolCallIds: []
      }
    });
  });
});

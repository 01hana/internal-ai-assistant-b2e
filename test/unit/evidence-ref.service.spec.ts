import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { EvidenceRefService } from '../../src/evidence/evidence-ref.service';
import { EvidenceSourceType } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('EvidenceRefService', () => {
  it('attaches only authorized fields to evidence summary and audit metadata', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'evidence-001',
      sourceType: EvidenceSourceType.structured_record,
      sourceId: 'SO-10001',
      entityType: 'order',
      entityId: 'SO-10001',
      fieldPaths: ['status', 'customerName']
    });
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new EvidenceRefService(
      {
        db: {
          evidenceRef: {
            create
          }
        }
      } as unknown as PrismaService,
      { append } as unknown as AuditWriterService
    );

    const result = await service.attachStructuredRecordEvidence({
      requestId: 'req-evidence',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
      identityContext: {
        requestId: 'req-evidence',
        actor: { actorId: 'actor-001', role: 'planner', permissionScopes: ['orders:read'] },
        hostApp: { hostApp: 'erp' },
        company: { organizationId: 'org-001' }
      },
      entityType: 'order',
      entityId: 'SO-10001',
      record: {
        orderId: 'SO-10001',
        status: '已確認',
        customerName: '王小明企業',
        amount: 128000
      },
      visibleFields: ['status', 'customerName']
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: {
            fields: {
              status: '已確認',
              customerName: '王小明企業'
            }
          }
        })
      })
    );
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('128000');
    expect(JSON.stringify(append.mock.calls[0][0])).not.toContain('王小明企業');
    expect(result.summary).toEqual({ status: '已確認', customerName: '王小明企業' });
  });
});

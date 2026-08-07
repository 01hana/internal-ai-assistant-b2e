import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { EvidenceRefService } from '../../src/evidence/evidence-ref.service';
import { EvidenceSourceType } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
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
          },
          assistantMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-001' }) },
          toolCall: { findFirst: jest.fn().mockResolvedValue({ id: 'tool-call-001' }) }
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
        customer: { customerId: 'customer-a', integrationId: 'integration-a' },
        organization: { organizationId: 'org-001' },
        hostApp: { hostApp: 'erp' },
        actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
        auth: { tokenId: 'token-001', gatewayIssuer: 'https://gateway.test.internal' }
      },
      customerScope: createCustomerScopeFromIdentityContext({
        requestId: 'req-evidence',
        customer: { customerId: 'customer-a', integrationId: 'integration-a' },
        organization: { organizationId: 'org-001' },
        hostApp: { hostApp: 'erp' },
        actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
        auth: { tokenId: 'token-001', gatewayIssuer: 'https://gateway.test.internal' }
      }),
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
          customerId: 'customer-a',
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

  it('fails closed without creating structured evidence when the ToolCall is not Customer-qualified', async () => {
    const create = jest.fn();
    const append = jest.fn();
    const service = new EvidenceRefService(
      {
        db: {
          evidenceRef: { create },
          assistantMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-001' }) },
          toolCall: { findFirst: jest.fn().mockResolvedValue(null) }
        }
      } as unknown as PrismaService,
      { append } as unknown as AuditWriterService
    );

    await expect(
      service.attachStructuredRecordEvidence({
        requestId: 'req-evidence',
        sessionId: 'session-001',
        messageId: 'message-001',
        toolCallId: 'foreign-tool-call',
        identityContext: identityContext(),
        customerScope: customerScope(),
        entityType: 'order',
        entityId: 'SO-10001',
        record: { status: '已確認' },
        visibleFields: ['status']
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(create).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});

function identityContext() {
  return {
    requestId: 'req-evidence',
    customer: { customerId: 'customer-a', integrationId: 'integration-a' },
    organization: { organizationId: 'org-001' },
    hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
    auth: { tokenId: 'token-001', gatewayIssuer: 'https://gateway.test.internal' }
  };
}

function customerScope() {
  return createCustomerScopeFromIdentityContext(identityContext());
}

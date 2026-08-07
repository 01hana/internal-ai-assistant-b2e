import { ForbiddenException } from '@nestjs/common';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';
import { SideEffectToolContractResolver } from '../../src/approvals/side-effect-tool-contract.resolver';

describe('SideEffectToolContractResolver', () => {
  const mediumTool = createTool({
    id: 'tool-definition-orders-update-test',
    key: 'mock.orders.status.update',
    operation: ToolOperation.delete,
    riskLevel: RiskLevel.medium,
    requiresConfirmation: true,
    requiresApproval: false
  });
  const approvalTool = createTool({
    id: 'tool-definition-orders-cancel-test',
    key: 'mock.orders.cancel',
    operation: ToolOperation.approve,
    riskLevel: RiskLevel.high,
    requiresConfirmation: false,
    requiresApproval: true
  });

  it('resolves ActionDraft operation from ToolDefinition instead of service fallback', async () => {
    const resolver = createResolver([mediumTool]);

    const tool = await resolver.resolveForActionDraft({
      executionPlan: {
        candidateTools: [],
        riskAssessment: RiskLevel.medium
      },
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      }
    } as any);

    expect(tool.operation).toBe(ToolOperation.delete);
    expect(tool.id).toBe('tool-definition-orders-update-test');
    expect(tool.version).toBe('9.9.9');
  });

  it('resolves ApprovalRequest operation from ToolDefinition instead of service fallback', async () => {
    const resolver = createResolver([approvalTool]);

    const tool = await resolver.resolveForApprovalRequest({
      executionPlan: {
        candidateTools: [],
        riskAssessment: RiskLevel.high
      },
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      }
    } as any);

    expect(tool.operation).toBe(ToolOperation.approve);
    expect(tool.id).toBe('tool-definition-orders-cancel-test');
    expect(tool.version).toBe('9.9.9');
  });

  it('fails closed when the selected tool no longer matches the required flow contract', async () => {
    const resolver = createResolver([
      {
        ...mediumTool,
        requiresConfirmation: false
      }
    ]);

    await expect(
      resolver.resolveForActionDraft({
        executionPlan: {
          candidateTools: [],
          riskAssessment: RiskLevel.medium
        },
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001'
        }
      } as any)
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function createResolver(tools: RegisteredToolDefinition[]) {
  return new SideEffectToolContractResolver({
    resolveRegisteredTool: jest.fn(async (toolName: string) => {
      const tool = tools.find((item) => item.key === toolName);
      return tool ? { tool } : { deniedReason: 'tool_not_registered' };
    })
  } as any);
}

function createTool(input: Partial<RegisteredToolDefinition> & Pick<RegisteredToolDefinition, 'id' | 'key'>): RegisteredToolDefinition {
  return {
    id: input.id,
    key: input.key,
    name: input.key,
    version: input.version ?? '9.9.9',
    description: 'test side-effect tool',
    operation: input.operation ?? ToolOperation.update,
    riskLevel: input.riskLevel ?? RiskLevel.medium,
    active: input.active ?? true,
    connectorKey: 'mock',
    requiredPermissionScopes: input.requiredPermissionScopes ?? ['orders:update'],
    inputSchema: { required: ['entityId'] },
    outputSchema: { required: [] },
    hasSideEffect: input.hasSideEffect ?? true,
    requiresConfirmation: input.requiresConfirmation ?? true,
    requiresApproval: input.requiresApproval ?? false
  };
}

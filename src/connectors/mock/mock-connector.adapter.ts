import { Injectable } from '@nestjs/common';
import {
  ConnectorAdapter,
  ConnectorExecuteInput,
  ConnectorExecuteResult,
  ConnectorToolDefinition,
  DependencyStatus
} from '../connector-adapter.interface';
import { mockBusinessPartnerHistory, mockInventoryAvailability, mockOrderStatuses, mockWorkOrderProgress } from './fixtures';

@Injectable()
export class MockConnectorAdapter implements ConnectorAdapter {
  readonly key = 'mock';

  // ToolDefinition DB records are the security source of truth.
  // Connector listTools() is only a capability report and is not used for permission, risk, active status, or schema decisions.
  listTools(): ConnectorToolDefinition[] {
    return [
      {
        key: 'mock.orders.status.lookup',
        name: 'Mock order status lookup',
        description: 'Read mock order status.',
        operation: 'read',
        riskLevel: 'low',
        inputSchema: { required: ['entityId'] },
        outputSchema: {},
        requiredPermissionScopes: ['orders:read']
      },
      {
        key: 'mock.work-orders.progress.lookup',
        name: 'Mock work order progress lookup',
        description: 'Read mock work order progress.',
        operation: 'read',
        riskLevel: 'low',
        inputSchema: { required: ['entityId'] },
        outputSchema: {},
        requiredPermissionScopes: ['work-orders:read']
      },
      {
        key: 'mock.inventory.availability.lookup',
        name: 'Mock inventory availability lookup',
        description: 'Read mock inventory availability.',
        operation: 'read',
        riskLevel: 'low',
        inputSchema: { required: ['entityId'] },
        outputSchema: {},
        requiredPermissionScopes: ['inventory:read']
      },
      {
        key: 'mock.business-partner.history.lookup',
        name: 'Mock business partner history lookup',
        description: 'Read mock customer or supplier history.',
        operation: 'read',
        riskLevel: 'low',
        inputSchema: { required: ['entityId'] },
        outputSchema: {},
        requiredPermissionScopes: ['business-partners:read']
      }
    ];
  }

  async execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult> {
    const entityId = String(input.arguments.entityId ?? '');
    const data = this.lookup(input.toolKey, entityId);

    if (!data) {
      return {
        toolKey: input.toolKey,
        status: 'failed',
        error: {
          code: 'NOT_FOUND',
          message: 'Mock connector record not found.'
        }
      };
    }

    return {
      toolKey: input.toolKey,
      status: 'succeeded',
      data,
      metadata: {
        connectorKey: this.key
      }
    };
  }

  async healthCheck(): Promise<DependencyStatus> {
    return {
      dependency: this.key,
      status: 'healthy',
      checkedAt: new Date().toISOString()
    };
  }

  private lookup(toolKey: string, entityId: string): Record<string, unknown> | undefined {
    if (toolKey === 'mock.orders.status.lookup') {
      return toRecord(mockOrderStatuses.find((record) => record.orderId === entityId));
    }

    if (toolKey === 'mock.work-orders.progress.lookup') {
      return toRecord(mockWorkOrderProgress.find((record) => record.workOrderId === entityId));
    }

    if (toolKey === 'mock.inventory.availability.lookup') {
      return toRecord(mockInventoryAvailability.find((record) => record.itemSku === entityId));
    }

    if (toolKey === 'mock.business-partner.history.lookup') {
      return toRecord(mockBusinessPartnerHistory.find((record) => record.partnerId === entityId || record.displayCode === entityId));
    }

    return undefined;
  }
}

function toRecord<T extends object>(record?: T): Record<string, unknown> | undefined {
  return record ? ({ ...record } as Record<string, unknown>) : undefined;
}

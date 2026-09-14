import type {
  ConnectorExecuteResult,
  ConnectorToolDefinition,
  DependencyStatus
} from '../connector-adapter.interface';
import type {
  DataAdapter,
  DataAdapterCompatibilityInput,
  DataAdapterCompatibilityResult,
  DataAdapterExecuteInput,
  DataAdapterMetadata
} from '../data-adapter.interface';
import type { ProductizedBusinessConnectorTransportService } from './productized-business-connector.module';
import {
  CONNECTOR_LIMITS_V1,
  parseConnectorInvocationRequestV1
} from '@internal-ai-assistant/connector-runtime-contract';
import type { ToolRegistryResolveResult } from '../../tools/tool-registry.types';
import { performance } from 'node:perf_hooks';

export interface ProductizedAdapterOperationBinding {
  readonly key: string;
  readonly version: string;
}

export interface ProductizedAdapterBinding {
  readonly version: '1';
  readonly active: boolean;
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApp: string;
  readonly connectorKey: string;
  readonly connectorInstanceId: string;
  readonly operations: readonly ProductizedAdapterOperationBinding[];
}

type TransportAvailability = Readonly<{
  ok: true;
  maxTransportMs: number;
  productionReady: boolean;
}> | Readonly<{ ok: false }>;

interface ProductizedTransportBoundary {
  executionConstraints(selector: {
    customerId: string;
    integrationId: string;
    hostApp: string;
    connectorKey: string;
    connectorInstanceId: string;
  }): TransportAvailability;
  invoke: ProductizedBusinessConnectorTransportService['invoke'];
}

interface ExactToolRegistryBoundary {
  resolveExactExecutableTool(key: string, version: string): Promise<ToolRegistryResolveResult>;
}

interface MonotonicClock {
  nowMilliseconds(): number;
}

export class ProductizedBusinessConnectorAdapter implements DataAdapter {
  readonly key = 'productized-business';
  readonly metadata: Readonly<DataAdapterMetadata>;

  constructor(
    private readonly binding: ProductizedAdapterBinding,
    private readonly toolRegistry: ExactToolRegistryBoundary,
    private readonly transport: ProductizedTransportBoundary,
    private readonly clock: MonotonicClock = { nowMilliseconds: () => performance.now() }
  ) {
    this.metadata = Object.freeze({
      adapterKey: this.key,
      sourceSystem: 'customer-local-connector-runtime',
      supportedHostApps: Object.freeze([binding.hostApp]),
      supportedCapabilities: Object.freeze([...new Set(binding.operations.map(({ key }) => key))].sort())
    });
  }

  listTools(): ConnectorToolDefinition[] {
    return [];
  }

  isCompatible(input: DataAdapterCompatibilityInput): DataAdapterCompatibilityResult {
    if (
      !this.binding.active ||
      input.host.customerId !== this.binding.customerId ||
      input.host.integrationId !== this.binding.integrationId ||
      input.host.hostApp !== this.binding.hostApp ||
      input.tool.connectorKey !== this.binding.connectorKey ||
      input.operation.canonicalToolKey !== input.tool.key ||
      input.operation.schemaVersion !== input.tool.version ||
      !this.hasOperation(input.tool.key, input.tool.version)
    ) {
      return { compatible: false, reason: 'binding_mismatch' };
    }

    return this.constraints().ok
      ? { compatible: true }
      : { compatible: false, reason: 'deployment_unavailable' };
  }

  async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    const startedAt = this.clock.nowMilliseconds();
    if (!this.isTrustedExecutionInput(input) || !this.hasOperation(input.operation.canonicalToolKey, input.operation.schemaVersion)) {
      return failed(input.operation.canonicalToolKey, 'CONNECTOR_REQUEST_INVALID');
    }

    const exact = await this.toolRegistry.resolveExactExecutableTool(
      input.operation.canonicalToolKey,
      input.operation.schemaVersion
    );
    if (!exact.tool || exact.tool.connectorKey !== this.binding.connectorKey) {
      return failed(input.operation.canonicalToolKey, 'CONNECTOR_OPERATION_UNAVAILABLE');
    }

    const constraints = this.constraints();
    if (!constraints.ok) return failed(input.operation.canonicalToolKey, 'CONNECTOR_UNAVAILABLE');
    const elapsedMs = Math.max(0, this.clock.nowMilliseconds() - startedAt);
    const signedBudgetMs = Math.floor(Math.min(
      CONNECTOR_LIMITS_V1.maximumTransportBudgetMs,
      constraints.maxTransportMs,
      exact.tool.timeoutMs - elapsedMs - 250
    ));
    if (signedBudgetMs < CONNECTOR_LIMITS_V1.minimumTransportBudgetMs) {
      return failed(input.operation.canonicalToolKey, 'CONNECTOR_TIMEOUT');
    }

    const rawRequest = {
      version: '1',
      requestId: input.requestId,
      remainingBudgetMs: signedBudgetMs,
      trustedContext: {
        customerId: input.host.customerId,
        integrationId: input.host.integrationId,
        hostApp: input.host.hostApp,
        organizationId: input.host.organizationId,
        actorId: input.host.actorId,
        connectorKey: this.binding.connectorKey,
        connectorInstanceId: this.binding.connectorInstanceId
      },
      operation: {
        key: input.operation.canonicalToolKey,
        version: input.operation.schemaVersion,
        arguments: input.operation.arguments
      },
      connectorContextRef: input.transientConnectorContext?.connectorContextRef
    };
    const parsed = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify(rawRequest), 'utf8'));
    if (!parsed.ok) return failed(input.operation.canonicalToolKey, 'CONNECTOR_REQUEST_INVALID');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), signedBudgetMs);
    try {
      const response = await this.transport.invoke(parsed.value, controller.signal, signedBudgetMs);
      if (!response.ok) return failed(input.operation.canonicalToolKey, response.code);
      if (response.value.status === 'failed') return failed(input.operation.canonicalToolKey, response.value.error.code);
      return {
        toolKey: input.operation.canonicalToolKey,
        status: 'succeeded',
        data: response.value.result as Readonly<Record<string, unknown>>,
        metadata: { connectorKey: this.key }
      };
    } catch {
      return failed(input.operation.canonicalToolKey, controller.signal.aborted ? 'CONNECTOR_TIMEOUT' : 'CONNECTOR_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<DependencyStatus> {
    return {
      dependency: this.key,
      status: this.constraints().ok ? 'healthy' : 'unavailable',
      checkedAt: new Date().toISOString()
    };
  }

  private hasOperation(key: string, version: string): boolean {
    return this.binding.operations.some((operation) => operation.key === key && operation.version === version);
  }

  private constraints(): TransportAvailability {
    return this.transport.executionConstraints({
      customerId: this.binding.customerId,
      integrationId: this.binding.integrationId,
      hostApp: this.binding.hostApp,
      connectorKey: this.binding.connectorKey,
      connectorInstanceId: this.binding.connectorInstanceId
    });
  }

  private isTrustedExecutionInput(input: DataAdapterExecuteInput): boolean {
    return (
      input.requestId === input.host.requestId &&
      input.organizationId === input.host.organizationId &&
      input.actorId === input.host.actorId &&
      input.toolKey === input.operation.canonicalToolKey &&
      input.arguments === input.operation.arguments &&
      input.host.customerId === this.binding.customerId &&
      input.host.integrationId === this.binding.integrationId &&
      input.host.hostApp === this.binding.hostApp
    );
  }
}

function failed(toolKey: string, code: string): ConnectorExecuteResult {
  return {
    toolKey,
    status: 'failed',
    error: {
      code,
      message: 'Productized connector execution failed.'
    }
  };
}

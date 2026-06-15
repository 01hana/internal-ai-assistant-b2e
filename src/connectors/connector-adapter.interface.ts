export interface ConnectorAdapter {
  readonly key: string;
  listTools(): ConnectorToolDefinition[];
  execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult>;
  healthCheck(): Promise<DependencyStatus>;
}

export interface ConnectorToolDefinition {
  key: string;
  name: string;
  description: string;
  operation: 'read' | 'write' | 'side_effect';
  riskLevel: 'low' | 'medium' | 'high';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredPermissionScopes: string[];
}

export interface ConnectorExecuteInput {
  requestId: string;
  organizationId: string;
  actorId: string;
  toolKey: string;
  arguments: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ConnectorExecuteResult {
  toolKey: string;
  status: 'succeeded' | 'failed' | 'permission_denied' | 'requires_approval';
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
}

export interface DependencyStatus {
  dependency: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

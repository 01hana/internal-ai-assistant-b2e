export type HealthStatus = 'healthy' | 'degraded' | 'unavailable';

export type DependencyName = 'database' | 'llm' | 'retrieval' | 'connector' | 'approval_workflow';

export interface DependencyHealthStatus {
  status: HealthStatus;
  reason?: string;
  checkedAt: string;
  durationMs?: number;
}

export type DependencyHealthSnapshot = Record<DependencyName, DependencyHealthStatus>;

export interface HealthResponse {
  status: 'healthy';
  service: 'internal-assistant-core';
  timestamp: string;
}

export interface ReadinessResponse {
  status: HealthStatus;
  service: 'internal-assistant-core';
  timestamp: string;
  dependencies: DependencyHealthSnapshot;
}

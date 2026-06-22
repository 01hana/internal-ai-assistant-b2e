import { Injectable } from '@nestjs/common';
import { DependencyHealthSnapshot, HealthResponse, HealthStatus, ReadinessResponse } from './dependency-health.types';
import { DependencyHealthService } from './dependency-health.service';

@Injectable()
export class HealthReadinessService {
  constructor(private readonly dependencyHealth: DependencyHealthService) {}

  getHealth(): HealthResponse {
    return {
      status: 'healthy',
      service: 'internal-assistant-core',
      timestamp: new Date().toISOString()
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const dependencies = await this.dependencyHealth.checkDependencies();
    return {
      status: calculateOverallStatus(dependencies),
      service: 'internal-assistant-core',
      timestamp: new Date().toISOString(),
      dependencies
    };
  }
}

function calculateOverallStatus(dependencies: DependencyHealthSnapshot): HealthStatus {
  const statuses = Object.values(dependencies).map((dependency) => dependency.status);
  if (statuses.includes('unavailable')) {
    return 'unavailable';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

import { Injectable } from '@nestjs/common';
import { BridgeReadinessService } from './readiness.service';

@Injectable()
export class BridgeHealthService {
  constructor(private readonly readiness: BridgeReadinessService) {}
  getHealth(): { status: 'healthy'; service: 'identity-bridge'; timestamp: string } {
    return { status: 'healthy', service: 'identity-bridge', timestamp: new Date().toISOString() };
  }

  getReadiness() { return this.readiness.getPublicReadiness(); }
}

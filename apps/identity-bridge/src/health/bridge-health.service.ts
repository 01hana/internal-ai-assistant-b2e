import { Injectable } from '@nestjs/common';

@Injectable()
export class BridgeHealthService {
  getHealth(): { status: 'healthy'; service: 'identity-bridge'; timestamp: string } {
    return { status: 'healthy', service: 'identity-bridge', timestamp: new Date().toISOString() };
  }

  getReadiness(): { status: 'not_ready'; service: 'identity-bridge'; timestamp: string; runtimeDependencies: 'not_evaluated'; productionReady: false } {
    return {
      status: 'not_ready',
      service: 'identity-bridge',
      timestamp: new Date().toISOString(),
      runtimeDependencies: 'not_evaluated',
      productionReady: false
    };
  }
}

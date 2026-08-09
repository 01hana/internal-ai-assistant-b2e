import { Injectable } from '@nestjs/common';

@Injectable()
export class GatewayHealthService {
  getHealth(): { status: 'healthy'; service: 'identity-gateway'; timestamp: string } {
    return {
      status: 'healthy',
      service: 'identity-gateway',
      timestamp: new Date().toISOString()
    };
  }

  getReadiness(): {
    status: 'not_ready';
    service: 'identity-gateway';
    timestamp: string;
    runtimeDependencies: 'not_evaluated';
    productionReady: false;
  } {
    return {
      status: 'not_ready',
      service: 'identity-gateway',
      timestamp: new Date().toISOString(),
      runtimeDependencies: 'not_evaluated',
      productionReady: false
    };
  }
}

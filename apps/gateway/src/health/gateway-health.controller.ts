import { Controller, Get } from '@nestjs/common';
import { GatewayHealthService } from './gateway-health.service';

@Controller()
export class GatewayHealthController {
  constructor(private readonly healthService: GatewayHealthService) {}

  @Get('health')
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('readiness')
  getReadiness() {
    return this.healthService.getReadiness();
  }
}

import { Controller, Get } from '@nestjs/common';
import { BridgeHealthService } from './bridge-health.service';

@Controller()
export class BridgeHealthController {
  constructor(private readonly healthService: BridgeHealthService) {}

  @Get('health')
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('ready')
  getReadiness() {
    return this.healthService.getReadiness();
  }
}

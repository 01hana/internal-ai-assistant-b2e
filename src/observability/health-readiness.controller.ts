import { Controller, Get } from '@nestjs/common';
import { HealthReadinessService } from './health-readiness.service';

@Controller()
export class HealthReadinessController {
  constructor(private readonly healthReadinessService: HealthReadinessService) {}

  @Get('health')
  getHealth() {
    return this.healthReadinessService.getHealth();
  }

  @Get('readiness')
  getReadiness() {
    return this.healthReadinessService.getReadiness();
  }
}

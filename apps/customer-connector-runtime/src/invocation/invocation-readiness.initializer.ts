import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConnectorRuntimeConfigService } from '../config/runtime-configuration';
import { RuntimeReadinessRegistry } from '../health/readiness.service';
import { ConnectorDestinationPolicy } from '../upstream/connector-destination-policy';

@Injectable()
export class InvocationReadinessInitializer implements OnModuleInit {
  constructor(private readonly readiness: RuntimeReadinessRegistry, private readonly config: ConnectorRuntimeConfigService, private readonly destinations: ConnectorDestinationPolicy) {}
  onModuleInit(): void { this.readiness.setReady('invocationRoute', this.config.isValid && this.destinations.isValid && this.destinations.productionEligible); }
}

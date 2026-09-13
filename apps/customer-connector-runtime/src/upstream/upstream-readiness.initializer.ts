import { Injectable, OnModuleInit } from '@nestjs/common';
import { OperationManifestRegistry } from '../manifest/operation-manifest.registry';
import { RuntimeReadinessRegistry } from '../health/readiness.service';
import { ConnectorDestinationPolicy } from './connector-destination-policy';

@Injectable()
export class UpstreamReadinessInitializer implements OnModuleInit {
  constructor(private readonly readiness: RuntimeReadinessRegistry, private readonly policy: ConnectorDestinationPolicy, private readonly manifests: OperationManifestRegistry) {}
  onModuleInit(): void {
    const configured = [...this.policy.serviceRefs()].sort(); const required = [...this.manifests.upstreamServiceRefs()].sort();
    this.readiness.setReady('upstream', this.policy.isValid && this.policy.productionEligible && configured.length === required.length && configured.every((value, index) => value === required[index]));
  }
}

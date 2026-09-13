import { Injectable, OnModuleInit } from '@nestjs/common';
import { RuntimeReadinessRegistry } from '../health/readiness.service';
import type { CredentialProfileRegistry } from '../credentials/credential-profile.registry';
import type { OperationManifestRegistry } from './operation-manifest.registry';
import type { RequestProfileRegistry } from './request-profile.registry';

@Injectable()
export class ManifestBoundaryReadinessInitializer implements OnModuleInit {
  constructor(
    private readonly readiness: RuntimeReadinessRegistry,
    private readonly manifests: Pick<OperationManifestRegistry, 'isValid' | 'credentialProfileRefs'>,
    private readonly credentials: Pick<CredentialProfileRegistry, 'isValid' | 'has'>,
    private readonly requestProfiles: Pick<RequestProfileRegistry, 'isValid'>
  ) {}

  onModuleInit(): void {
    const credentialProfiles = this.credentials.isValid;
    const requestProfiles = this.requestProfiles.isValid;
    const manifest = this.manifests.isValid && credentialProfiles && requestProfiles &&
      this.manifests.credentialProfileRefs().every((profile) => this.credentials.has(profile));
    this.readiness.setReady('credentialProfiles', credentialProfiles);
    this.readiness.setReady('requestProfiles', requestProfiles);
    this.readiness.setReady('manifest', manifest);
  }
}

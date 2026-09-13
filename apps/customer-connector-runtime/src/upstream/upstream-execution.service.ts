import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import type { AppliedCredentialRequest } from '../credentials/credential.types';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';
import { BoundedJsonResponse } from './bounded-json-response';
import { ClosedUpstreamRequestBuilder, ConnectorDestinationPolicy } from './connector-destination-policy';
import { resolveAndPin, type DnsResolver } from './pinned-lookup.adapter';
import { ManifestResponseExtractor } from './response-extractor';
import { SafeUpstreamHttpClient } from './safe-upstream-http-client';

export type UpstreamExecutionResult = Readonly<{ ok: true; value: Readonly<Record<string, string | number | boolean>> }> |
  Readonly<{ ok: false; code: ConnectorErrorCode }>;

export class UpstreamExecutionService {
  readonly isReady: boolean;
  constructor(
    private readonly policy: ConnectorDestinationPolicy,
    private readonly client: SafeUpstreamHttpClient = new SafeUpstreamHttpClient(),
    private readonly dnsResolver?: DnsResolver,
    private readonly responses = new BoundedJsonResponse(),
    private readonly extractor = new ManifestResponseExtractor()
  ) { this.isReady = policy.isValid; }

  async execute(operation: PreparedManifestOperation, argumentsValue: Readonly<Record<string, unknown>>, applied: AppliedCredentialRequest, signal: AbortSignal): Promise<UpstreamExecutionResult> {
    const built = new ClosedUpstreamRequestBuilder(this.policy).build(operation.upstreamServiceRef, operation.request, operation.limits.maxRequestBytes);
    if (!built.ok) return built;
    const pin = await resolveAndPin(built.value.service.hostname, built.value.service.addressMode, built.value.service.allowedCidrs, signal, this.dnsResolver);
    if (!pin.ok) return pin;
    const response = await this.client.execute(built.value, applied, pin.value.lookup, signal);
    if (!response.ok) return response;
    const bounded = await this.responses.read(response.value, operation, signal);
    if (!bounded.ok) return bounded;
    return this.extractor.extract(bounded.value, operation, argumentsValue);
  }
}

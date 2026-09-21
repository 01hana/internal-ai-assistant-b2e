import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import type { AppliedCredentialRequest } from '../credentials/credential.types';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';
import { BoundedJsonResponse } from './bounded-json-response';
import { ClosedUpstreamRequestBuilder, ConnectorDestinationPolicy } from './connector-destination-policy';
import { resolveAndPin, type DnsResolver } from './pinned-lookup.adapter';
import { ManifestResponseExtractor } from './response-extractor';
import { SafeUpstreamHttpClient, type UpstreamDiagnosticContext } from './safe-upstream-http-client';

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

  async execute(
    operation: PreparedManifestOperation,
    argumentsValue: Readonly<Record<string, unknown>>,
    applied: AppliedCredentialRequest,
    signal: AbortSignal,
    diagnostic?: UpstreamDiagnosticContext
  ): Promise<UpstreamExecutionResult> {
    const built = new ClosedUpstreamRequestBuilder(this.policy).build(operation.upstreamServiceRef, operation.request, operation.limits.maxRequestBytes);
    if (!built.ok) return this.failed(built, diagnostic);
    diagnostic?.diagnostics.emit('UPSTREAM_REQUEST_PREPARED', 'SUCCEEDED', diagnostic.metadata);
    const pin = await resolveAndPin(built.value.service.hostname, built.value.service.addressMode, built.value.service.allowedCidrs, signal, this.dnsResolver);
    if (!pin.ok) return this.failed(pin, diagnostic);
    diagnostic?.diagnostics.emit('UPSTREAM_REQUEST_STARTED', 'STARTED', diagnostic.metadata);
    const response = await this.client.execute(built.value, applied, pin.value.lookup, signal, diagnostic);
    if (!response.ok) return this.failed(response, diagnostic);
    const bounded = await this.responses.read(response.value, operation, signal, diagnostic);
    if (!bounded.ok) return this.failed(bounded, diagnostic);
    const extracted = this.extractor.extract(bounded.value, operation, argumentsValue);
    if (!extracted.ok) {
      diagnostic?.diagnostics.emit('RESULT_EXTRACTION_FAILED', 'FAILED', {
        ...diagnostic.metadata, failureCategory: extracted.code
      });
      return this.failed(extracted, diagnostic);
    }
    diagnostic?.diagnostics.emit('RESULT_EXTRACTION_SUCCEEDED', 'SUCCEEDED', diagnostic.metadata);
    return extracted;
  }

  private failed<T extends Readonly<{ ok: false; code: ConnectorErrorCode }>>(failure: T, diagnostic?: UpstreamDiagnosticContext): T {
    diagnostic?.diagnostics.emit('UPSTREAM_REQUEST_FAILED', 'FAILED', {
      ...diagnostic.metadata, failureCategory: failure.code
    });
    return failure;
  }
}

import type { ProviderInstancePolicy, VerifyNativeCredentialInput } from '../../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { DelegatedHttpTransport, DELEGATED_HTTP_MAX_RESPONSE_BYTES, type DelegatedHttpRequestOptions } from '../../../src/managed-identity-exchange/providers/delegated-http.transport';
import { DelegatedHttpV1Adapter } from '../../../src/managed-identity-exchange/providers/delegated-http-v1.adapter';

export type SyntheticDelegatedProviderScenario =
  | 'verified' | 'credential-401' | 'credential-403' | 'five-hundred'
  | 'malformed-json' | 'malformed-identity' | 'undeclared-anchor'
  | 'conflicting-anchor' | 'duplicate-anchor' | 'authority-like'
  | 'blank-subject' | 'missing-anchors' | 'empty-anchors' | 'malformed-anchor'
  | 'unknown-top-level' | 'invalid-mime' | 'timeout' | 'oversized' | 'exact-limit';

export type CapturedSyntheticDelegatedRequest = Readonly<{
  endpoint: string;
  method: 'POST';
  accept: 'application/json';
  authorization: string;
  signal: AbortSignal;
}>;

const nativeCredential = 'DO_NOT_LEAK_SYNTHETIC_NATIVE_CREDENTIAL';
const timeoutMilliseconds = 50;

/** Test-only simulator for an external delegated identity-provider response. */
export function createSyntheticDelegatedProviderFixture(scenario: SyntheticDelegatedProviderScenario = 'verified') {
  const requests: CapturedSyntheticDelegatedRequest[] = [];
  const policy: ProviderInstancePolicy = Object.freeze({
    id: 'synthetic-provider',
    providerType: 'delegated_http',
    endpointUri: 'https://synthetic-idp.example.test/verify',
    httpMethod: 'POST',
    credentialPlacement: 'authorization_bearer',
    timeoutMilliseconds,
    responseContractVersion: 'delegated-http/v1',
    declaredAnchorKinds: Object.freeze(['organization', 'tenant']),
    providerContract: Object.freeze({
      anchorSchema: 'managed-verified-anchors/v1',
      responseSchema: 'managed-verified-identity/v1'
    })
  });
  let lastSignal: AbortSignal | undefined;
  const transport = new DelegatedHttpTransport({
    resolve: async () => ['8.8.8.8'],
    request: async (url: URL, options: DelegatedHttpRequestOptions) => {
      lastSignal = options.signal;
      requests.push(Object.freeze({
        endpoint: url.toString(), method: options.method, accept: options.headers.accept,
        authorization: options.headers.authorization, signal: options.signal
      }));
      await options.lookup(url.hostname);
      return responseFor(scenario) as never;
    }
  } as never);
  const adapter = new DelegatedHttpV1Adapter(transport);
  return Object.freeze({
    policy,
    adapter,
    transport,
    nativeCredential,
    get requests(): readonly CapturedSyntheticDelegatedRequest[] { return Object.freeze([...requests]); },
    get lastSignal(): AbortSignal | undefined { return lastSignal; },
    input(): VerifyNativeCredentialInput {
      return Object.freeze({ nativeCredential, providerInstancePolicy: policy, requestId: 'synthetic-request' });
    }
  });
}

function responseFor(scenario: SyntheticDelegatedProviderScenario) {
  if (scenario === 'timeout') return new Promise<never>(() => {});
  if (scenario === 'credential-401') return response(401, 'application/json', '{}');
  if (scenario === 'credential-403') return response(403, 'application/json', '{}');
  if (scenario === 'five-hundred') return response(500, 'application/json', '{}');
  if (scenario === 'malformed-json') return response(200, 'application/json', '{DO_NOT_LEAK_SYNTHETIC_PROVIDER_DIAGNOSTIC');
  if (scenario === 'invalid-mime') return response(200, 'text/plain', '{}');
  if (scenario === 'oversized') return response(200, 'application/json', Buffer.alloc(DELEGATED_HTTP_MAX_RESPONSE_BYTES + 1, 'x'));
  if (scenario === 'exact-limit') return response(200, 'application/json', exactLimitIdentity());
  if (scenario === 'malformed-identity') return json({ anchors: [{ kind: 'organization', value: 'synthetic-organization' }] });
  if (scenario === 'blank-subject') return json(identity({ subject: '   ' }));
  if (scenario === 'missing-anchors') return json({ subject: 'synthetic-subject' });
  if (scenario === 'empty-anchors') return json(identity({ anchors: [] }));
  if (scenario === 'malformed-anchor') return json(identity({ anchors: [{ kind: 'organization' }] }));
  if (scenario === 'unknown-top-level') return json({ ...identity(), unexpected: true });
  if (scenario === 'undeclared-anchor') return json(identity({ anchors: [{ kind: 'undeclared-anchor', value: 'value-a' }] }));
  if (scenario === 'conflicting-anchor') return json(identity({ anchors: [{ kind: 'organization', value: 'org-a' }, { kind: 'organization', value: 'org-b' }] }));
  if (scenario === 'duplicate-anchor') return json(identity({ anchors: [{ kind: 'organization', value: 'org-a' }, { kind: 'organization', value: 'org-a' }] }));
  if (scenario === 'authority-like') return json({
    ...identity(), roles: ['administrator'], permissions: ['all'], customerId: 'forged-customer',
    integrationId: 'forged-integration', hostApp: 'forged-host', nativeClaims: { sub: 'forged' }, rawToken: 'forged-token'
  });
  return json(identity());
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'synthetic-subject',
    organization: 'synthetic-organization',
    anchors: [
      { kind: 'organization', value: 'synthetic-organization' },
      { kind: 'tenant', value: 'synthetic-tenant' }
    ],
    trustedPermissionReference: 'synthetic-permission-reference',
    ...overrides
  };
}

function json(value: unknown) { return response(200, 'application/json', JSON.stringify(value)); }

function response(statusCode: number, contentType: string, body: string | Uint8Array) {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  return Object.freeze({
    statusCode,
    headers: { 'content-type': contentType },
    body: (async function* () { yield bytes; })()
  });
}

function exactLimitIdentity(): Uint8Array {
  const prefix = Buffer.from('{"subject":"');
  const suffix = Buffer.from('","anchors":[{"kind":"organization","value":"synthetic-organization"}]}');
  return Buffer.concat([prefix, Buffer.alloc(DELEGATED_HTTP_MAX_RESPONSE_BYTES - prefix.length - suffix.length, 'a'), suffix]);
}

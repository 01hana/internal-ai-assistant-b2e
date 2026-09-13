import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';

export type UpstreamFailureKind = 'uri' | 'dns' | 'tls' | 'redirect' | 'encoding' | 'connection' | 'status' | 'response' | 'timeout' | 'cancelled';
export type SafeUpstreamFailure = Readonly<{ ok: false; code: Extract<ConnectorErrorCode,
  'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT'> }>;

export function normalizeUpstreamFailure(kind: UpstreamFailureKind, _error?: unknown): SafeUpstreamFailure {
  if (['uri', 'dns', 'tls', 'redirect', 'encoding'].includes(kind)) return failure('CONNECTOR_DESTINATION_REJECTED');
  if (kind === 'timeout' || kind === 'cancelled') return failure('CONNECTOR_TIMEOUT');
  if (kind === 'response') return failure('CONNECTOR_RESPONSE_INVALID');
  return failure('CONNECTOR_UPSTREAM_FAILED');
}
export function shouldRevokeCredential(code: ConnectorErrorCode): boolean { return code === 'CONNECTOR_UPSTREAM_AUTH_FAILED'; }
function failure(code: SafeUpstreamFailure['code']): SafeUpstreamFailure { return Object.freeze({ ok: false, code }); }

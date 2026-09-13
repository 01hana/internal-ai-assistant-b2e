import { normalizeUpstreamFailure, shouldRevokeCredential } from '../../src/upstream/upstream-errors';

describe('Phase 6 safe upstream failures', () => {
  it.each([
    ['dns', 'CONNECTOR_DESTINATION_REJECTED'], ['tls', 'CONNECTOR_DESTINATION_REJECTED'], ['redirect', 'CONNECTOR_DESTINATION_REJECTED'],
    ['status', 'CONNECTOR_UPSTREAM_FAILED'], ['response', 'CONNECTOR_RESPONSE_INVALID'], ['timeout', 'CONNECTOR_TIMEOUT']
  ] as const)('normalizes %s without details', (kind, code) => {
    const result = normalizeUpstreamFailure(kind, new Error('secret endpoint credential raw-body sentinel'));
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toMatch(/secret|endpoint|credential|raw-body|sentinel/);
  });
  it('revokes only credential rejection', () => {
    expect(shouldRevokeCredential('CONNECTOR_UPSTREAM_AUTH_FAILED')).toBe(true);
    expect(shouldRevokeCredential('CONNECTOR_UPSTREAM_FAILED')).toBe(false);
    expect(shouldRevokeCredential('CONNECTOR_TIMEOUT')).toBe(false);
  });
});

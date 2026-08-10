describe('Upstream authentication safe denial and telemetry (T030)', () => {
  it.each(['invalid_signature', 'audience_mismatch', 'token_not_yet_valid'])(
    'uses the same generic public and audit denial for %s',
    async (diagnosticReason) => {
    const { UpstreamAuthTelemetry } = require('../../src/upstream-auth/upstream-auth-telemetry') as { UpstreamAuthTelemetry?: new (writer: any) => { recordDenied(input: unknown): Promise<void> } };
    const { UpstreamAuthenticationError } = require('../../src/upstream-auth/upstream-auth.error') as { UpstreamAuthenticationError?: new (reason: string) => Error };
    expect(UpstreamAuthTelemetry).toEqual(expect.any(Function));
    const append = jest.fn().mockResolvedValue(undefined);
    const rawToken = 'header.payload.signature';
    const telemetry = new (UpstreamAuthTelemetry as new (writer: any) => { recordDenied(input: unknown): Promise<void> })({ append });
    const error = new (UpstreamAuthenticationError as new (reason: string) => Error)(diagnosticReason);
    await telemetry.recordDenied({ requestId: 'request-1', error, authorization: `Bearer ${rawToken}`, claims: { sub: 'attacker' }, signature: 'signature-sentinel' } as never);

    expect(error).toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID', message: 'Upstream identity is invalid.' });
    expect(JSON.stringify(error)).not.toMatch(/header\.payload\.signature|bearer|attacker|signature-sentinel|invalid_signature|audience_mismatch|token_not_yet_valid/i);
    expect(append).toHaveBeenCalledWith({ requestId: 'request-1', eventType: 'upstream_auth_denied', outcome: 'denied', reasonCode: 'upstream_auth_invalid' });
    expect(JSON.stringify(append.mock.calls)).not.toMatch(/header\.payload\.signature|bearer|attacker|signature-sentinel|invalid_signature|audience_mismatch|token_not_yet_valid/i);
  });
});

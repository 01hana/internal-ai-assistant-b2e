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

  it('keeps Feature 004 profile telemetry scalar-only and excludes credential, claim, JWKS, and infrastructure diagnostics', async () => {
    const { UpstreamAuthTelemetry } = require('../../src/upstream-auth/upstream-auth-telemetry') as { UpstreamAuthTelemetry?: new (writer: any) => { record(input: unknown): Promise<void> } };
    const { UpstreamIdentityServiceUnavailableError } = require('../../src/upstream-auth/upstream-auth.error') as { UpstreamIdentityServiceUnavailableError?: new () => Error };
    const append = jest.fn().mockResolvedValue(undefined);
    const rawToken = 'header.payload.signature-sentinel';
    const telemetry = new (UpstreamAuthTelemetry as new (writer: any) => { record(input: unknown): Promise<void> })({ append });

    await telemetry.record({
      requestId: 'request-safe', outcome: 'denied', reasonCode: 'verification_infrastructure_unavailable', profileId: 'profile-a', integrationId: 'integration-a',
      authorization: `Bearer ${rawToken}`, rawJwt: rawToken, claims: { profile_id: 'attacker-profile', customer_id: 'customer-attacker' },
      kid: 'kid-sentinel', issuer: 'https://issuer.secret.test', audience: 'audience-sentinel',
      jwks: { keys: [{ d: 'private-jwk' }] }, jwksUri: 'https://issuer.secret.test/jwks?credential=url-secret',
      error: new Error('Prisma database unavailable transport-secret')
    } as never);

    expect(append).toHaveBeenCalledWith({
      requestId: 'request-safe', eventType: 'upstream_profile_verification', outcome: 'denied', reasonCode: 'verification_infrastructure_unavailable',
      profileId: 'profile-a', integrationId: 'integration-a', actorId: undefined, hostApp: undefined
    });
    const serialized = JSON.stringify(append.mock.calls);
    [rawToken, 'attacker-profile', 'customer-attacker', 'kid-sentinel', 'issuer.secret.test', 'audience-sentinel', 'private-jwk', 'url-secret', 'database unavailable', 'transport-secret'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
    expect(JSON.stringify(new (UpstreamIdentityServiceUnavailableError as new () => Error)())).not.toMatch(/profile-a|issuer|jwks|database|transport/i);
  });
});

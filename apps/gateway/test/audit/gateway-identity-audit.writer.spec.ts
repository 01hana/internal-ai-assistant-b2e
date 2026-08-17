import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';

describe('Gateway identity audit writer profile identity', () => {
  it('persists profileId as a safe scalar and discards unknown sensitive input', async () => {
    const create = jest.fn(async ({ data }) => ({ data }));
    const writer = new GatewayIdentityAuditWriter({ gatewayIdentityAuditEvent: { create } } as never);

    await writer.append({
      requestId: 'request-audit', eventType: 'upstream_profile_verification', outcome: 'denied', reasonCode: 'signature_invalid',
      profileId: 'profile-a', integrationId: 'integration-a',
      authorization: 'Bearer header.payload.signature', rawJwt: 'header.payload.signature', claims: { profile_id: 'attacker' },
      jwks: { keys: ['private'] }, metadata: { secret: 'url-secret' }
    } as never);

    expect(create).toHaveBeenCalledWith({ data: {
      requestId: 'request-audit', eventType: 'upstream_profile_verification', outcome: 'denied', reasonCode: 'signature_invalid',
      profileId: 'profile-a', integrationId: 'integration-a'
    } });
  });
});

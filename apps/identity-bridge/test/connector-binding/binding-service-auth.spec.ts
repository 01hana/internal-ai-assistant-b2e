import { createHash } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { parseBindingBootstrapServiceProofV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { ConnectorBindingServiceAuthSigner } from '../../src/connector-binding/connector-binding-service-auth.signer';
import { bindingEnvironment } from './binding-fixtures';

const requestId = '123e4567-e89b-42d3-a456-426614174000';
const jti = 'c750dd50-2272-4f93-866c-00b58eef2c82';

describe('Bridge binding service authentication', () => {
  it('serializes once and signs the exact bytes in the dedicated 30-second RS256 domain', async () => {
    const serialize = jest.fn(JSON.stringify);
    const config = new BridgeConfigService(bindingEnvironment());
    const signer = new ConnectorBindingServiceAuthSigner(config, { now: () => 1_800_000_000, uuid: () => jti, serialize });
    const signed = await signer.prepare({
      requestId,
      nativeAccessToken: 'native-access-token-sentinel',
      acceptedIdentity: { subject: 'user-a', organization: 'company-a', entry: 'configured-entry' }
    });

    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('Expected signed binding request.');
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(decodeProtectedHeader(signed.value.proof)).toEqual({ alg: 'RS256', kid: 'binding-phase8', typ: 'assistant-connector-binding+jwt' });
    const claims = decodeJwt(signed.value.proof);
    expect(claims).toMatchObject({
      iss: 'urn:reference:bridge', sub: 'reference-bridge', aud: 'urn:connector-binding:reference',
      iat: 1_800_000_000, nbf: 1_800_000_000, exp: 1_800_000_030, jti, proof_version: 1,
      customer_id: 'reference-customer', integration_id: 'configured-integration', host_app: 'configured-host-app',
      connector_instance_id: 'reference-connector-1', organization_id: 'company-a', actor_id: 'user-a',
      bootstrap_profile_key: 'BRIDGE_BINDING_TRANSPORT_V1', provider_key: 'shinmone-idx-bootstrap-v1', request_id: requestId,
      body_sha256: createHash('sha256').update(signed.value.bytes).digest('base64url')
    });
    const auth = config.configuration.connectorBinding!.serviceAuth;
    const publicKey = await importJwk(auth.keys[0]!.publicJwk as never, 'RS256');
    await expect(jwtVerify(signed.value.proof, publicKey, { algorithms: ['RS256'], currentDate: new Date(1_800_000_000_000) })).resolves.toBeDefined();
    expect(JSON.parse(signed.value.bytes.toString('utf8'))).toEqual({
      version: '1', requestId, bootstrapProfileKey: 'BRIDGE_BINDING_TRANSPORT_V1',
      trustedContext: {
        customerId: 'reference-customer', integrationId: 'configured-integration', hostApp: 'configured-host-app',
        connectorInstanceId: 'reference-connector-1', organizationId: 'company-a', actorId: 'user-a'
      },
      providerPayload: {
        nativeAccessToken: 'native-access-token-sentinel', acceptedSubject: 'user-a',
        acceptedOrganization: 'company-a', acceptedEntry: 'configured-entry'
      }
    });
  });

  it.each([
    ['user-a', 'company-a', 'entry-a'],
    ['user-b', 'company-a', 'entry-b'],
    ['user-c', 'company-b', 'entry-c']
  ])('derives admitted actor %s and organization %s without changing deployment configuration', async (subject, organization, entry) => {
    const config = new BridgeConfigService(bindingEnvironment());
    const nativeAccessToken = `native-token-${subject}`;
    const signed = await new ConnectorBindingServiceAuthSigner(config).prepare({
      requestId, nativeAccessToken, acceptedIdentity: { subject, organization, entry }
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('Expected signed binding request.');

    const claims = decodeJwt(signed.value.proof);
    const body = JSON.parse(signed.value.bytes.toString('utf8')) as Record<string, any>;
    expect(claims).toMatchObject({ actor_id: subject, organization_id: organization });
    expect(body.trustedContext).toMatchObject({ actorId: subject, organizationId: organization });
    expect(body.providerPayload).toEqual({
      nativeAccessToken, acceptedSubject: subject, acceptedOrganization: organization, acceptedEntry: entry
    });
    expect(signed.value.proof).not.toContain(nativeAccessToken);
    expect(JSON.stringify(config.configuration.connectorBinding)).not.toContain(nativeAccessToken);
  });

  it('uses optional configured actor and organization only as narrowing constraints', async () => {
    const actorNarrowed = new ConnectorBindingServiceAuthSigner(new BridgeConfigService(bindingEnvironment({
      contextOverride: { actorId: 'user-a' }
    })));
    await expect(actorNarrowed.prepare({ requestId, nativeAccessToken: 'native', acceptedIdentity: {
      subject: 'user-b', organization: 'company-a', entry: 'configured-entry'
    } })).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    await expect(actorNarrowed.prepare({ requestId, nativeAccessToken: 'native', acceptedIdentity: {
      subject: 'user-a', organization: 'company-b', entry: 'configured-entry'
    } })).resolves.toMatchObject({ ok: true });

    const organizationNarrowed = new ConnectorBindingServiceAuthSigner(new BridgeConfigService(bindingEnvironment({
      contextOverride: { organizationId: 'company-a' }
    })));
    await expect(organizationNarrowed.prepare({ requestId, nativeAccessToken: 'native', acceptedIdentity: {
      subject: 'user-b', organization: 'company-b', entry: 'configured-entry'
    } })).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    await expect(organizationNarrowed.prepare({ requestId, nativeAccessToken: 'native', acceptedIdentity: {
      subject: 'user-b', organization: 'company-a', entry: 'configured-entry'
    } })).resolves.toMatchObject({ ok: true });
  });

  it('binds the proof parser to the exact Bridge profile and rejects altered profile domains', async () => {
    const config = new BridgeConfigService(bindingEnvironment());
    const signed = await new ConnectorBindingServiceAuthSigner(config, { now: () => 1_800_000_000, uuid: () => jti }).prepare({
      requestId, nativeAccessToken: 'native', acceptedIdentity: { subject: 'user-a', organization: 'company-a', entry: 'configured-entry' }
    });
    if (!signed.ok) throw new Error('Expected signed binding request.');
    const input = { protectedHeader: decodeProtectedHeader(signed.value.proof), claims: decodeJwt(signed.value.proof) };
    const exact = {
      kind: 'binding-bootstrap' as const, profileKey: 'BRIDGE_BINDING_TRANSPORT_V1', typ: 'assistant-connector-binding+jwt',
      issuer: 'urn:reference:bridge', subject: 'reference-bridge', audience: 'urn:connector-binding:reference',
      keyDomain: 'reference-bridge-binding-signing', acceptedKids: ['binding-phase8'], providerKey: 'shinmone-idx-bootstrap-v1'
    };
    expect(parseBindingBootstrapServiceProofV1(input, exact).ok).toBe(true);
    for (const profile of [
      { ...exact, profileKey: 'customer-b-bootstrap-v1' },
      { ...exact, typ: 'assistant-connector-service+jwt' },
      { ...exact, issuer: 'urn:central:connector' },
      { ...exact, providerKey: 'customer-b-fixture-provider-v1' }
    ]) expect(parseBindingBootstrapServiceProofV1(input, profile as never)).toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    expect(createHash('sha256').update(Buffer.concat([signed.value.bytes, Buffer.from(' ')])).digest('base64url'))
      .not.toBe(decodeJwt(signed.value.proof).body_sha256);
  });
});

async function importJwk(value: Parameters<typeof importJWK>[0], algorithm: string) {
  return importJWK(value, algorithm);
}

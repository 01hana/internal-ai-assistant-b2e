import {
  CONNECTOR_BINDING_MAX_REQUEST_BYTES,
  CONNECTOR_BINDING_MAX_RESPONSE_BYTES,
  parseConnectorBindingBootstrapRequestV1,
  parseConnectorBindingBootstrapResponseV1,
  type BindingBootstrapProfileContract
} from '../../src';

const encoder = new TextEncoder();
type FixturePayload = Readonly<{ bootstrapCode: string }>;
type ShinmonePayload = Readonly<{
  nativeAccessToken: string;
  acceptedSubject: string;
  acceptedOrganization: string;
  acceptedEntry: string;
}>;

const profile: BindingBootstrapProfileContract<'fixture-bootstrap-v1', FixturePayload> = {
  profileKey: 'fixture-bootstrap-v1',
  maxProviderPayloadBytes: 128,
  parseProviderPayload(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
    const entries = Object.entries(value);
    if (entries.length !== 1 || entries[0]?.[0] !== 'bootstrapCode' || typeof entries[0][1] !== 'string') {
      return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
    }
    return { ok: true, value: Object.freeze({ bootstrapCode: entries[0][1] }) };
  }
};

const shinmoneProfile: BindingBootstrapProfileContract<'shinmone-idx-native-token-v1', ShinmonePayload> = {
  profileKey: 'shinmone-idx-native-token-v1',
  maxProviderPayloadBytes: 12_288,
  parseProviderPayload(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'acceptedEntry,acceptedOrganization,acceptedSubject,nativeAccessToken') {
      return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
    }
    const payload = value as Partial<ShinmonePayload>;
    if (!bounded(payload.nativeAccessToken, 12_000) || !bounded(payload.acceptedSubject, 128) ||
        !bounded(payload.acceptedOrganization, 128) || !bounded(payload.acceptedEntry, 128)) {
      return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
    }
    return { ok: true, value: Object.freeze(payload as ShinmonePayload) };
  }
};

function request(overrides: object = {}): Uint8Array {
  return encoder.encode(JSON.stringify({
    version: '1',
    requestId: '76439084-9a9e-4981-9cd7-2e71e822fe28',
    bootstrapProfileKey: 'fixture-bootstrap-v1',
    trustedContext: {
      customerId: 'customer-b',
      integrationId: 'inventory-b',
      hostApp: 'customer-b-inventory',
      connectorInstanceId: 'customer-b-inventory-connector-1',
      organizationId: 'org-1',
      actorId: 'actor-1'
    },
    providerPayload: { bootstrapCode: 'opaque-input' },
    ...overrides
  }));
}

function shinmoneRequest(nativeAccessToken: string, providerPayload: object = {}): Uint8Array {
  return request({
    bootstrapProfileKey: shinmoneProfile.profileKey,
    providerPayload: {
      nativeAccessToken,
      acceptedSubject: 'actor-1',
      acceptedOrganization: 'org-1',
      acceptedEntry: 'scm',
      ...providerPayload
    }
  });
}

describe('Connector binding bootstrap V1 wire contract', () => {
  const requestId = '76439084-9a9e-4981-9cd7-2e71e822fe28';
  it('dispatches the bounded provider payload only through the expected profile', () => {
    const parsed = parseConnectorBindingBootstrapRequestV1(request(), profile);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.bootstrapProfileKey).toBe('fixture-bootstrap-v1');
    expect(parsed.value.providerPayload).toEqual({ bootstrapCode: 'opaque-input' });
    expect(Object.isFrozen(parsed.value)).toBe(true);
  });

  it('rejects cross-profile requests before provider dispatch', () => {
    let calls = 0;
    const guardedProfile = { ...profile, parseProviderPayload(value: unknown) { calls += 1; return profile.parseProviderPayload(value); } };
    expect(parseConnectorBindingBootstrapRequestV1(request({ bootstrapProfileKey: 'other-profile' }), guardedProfile).ok).toBe(false);
    expect(calls).toBe(0);
  });

  it.each([
    ['central proof', { centralServiceProof: 'jwt' }],
    ['Feature 007 user token', { userToken: 'jwt' }],
    ['native credential field', { nativeAccessToken: 'secret' }],
    ['destination', { url: 'https://attacker.invalid' }]
  ])('rejects %s in the generic envelope', (_label, field) => {
    expect(parseConnectorBindingBootstrapRequestV1(request(field), profile).ok).toBe(false);
  });

  it('enforces the exact provider payload schema and configured byte bound', () => {
    expect(parseConnectorBindingBootstrapRequestV1(request({ providerPayload: { wrong: true } }), profile).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(request({ providerPayload: { bootstrapCode: 'x'.repeat(200) } }), profile).ok).toBe(false);
  });

  it.each([1_024, 1_025, 4_096, 8_192, 12_000])(
    'accepts a provider-authorized Shinmone native token of %i characters',
    (length) => {
      expect(parseConnectorBindingBootstrapRequestV1(shinmoneRequest('x'.repeat(length)), shinmoneProfile).ok).toBe(true);
    }
  );

  it('rejects a Shinmone native token above its provider-owned limit', () => {
    expect(parseConnectorBindingBootstrapRequestV1(shinmoneRequest('x'.repeat(12_001)), shinmoneProfile).ok).toBe(false);
  });

  it('does not widen strings for unrelated provider contracts or envelope fields', () => {
    const unrelatedProfile: BindingBootstrapProfileContract<'fixture-bootstrap-v1', FixturePayload> = {
      ...profile,
      maxProviderPayloadBytes: 12_288,
      parseProviderPayload(value: unknown) {
        const parsed = profile.parseProviderPayload(value);
        if (!parsed.ok || !bounded(parsed.value.bootstrapCode, 1_024)) {
          return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' };
        }
        return parsed;
      }
    };
    expect(parseConnectorBindingBootstrapRequestV1(request({
      providerPayload: { bootstrapCode: 'x'.repeat(1_025) }
    }), unrelatedProfile).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(request({
      trustedContext: {
        customerId: 'customer-b',
        integrationId: 'inventory-b',
        hostApp: 'x'.repeat(1_025),
        connectorInstanceId: 'customer-b-inventory-connector-1',
        organizationId: 'org-1',
        actorId: 'actor-1'
      }
    }), profile).ok).toBe(false);
  });

  it('keeps provider shape, structure, field, and total request bounds strict', () => {
    expect(parseConnectorBindingBootstrapRequestV1(shinmoneRequest('token', { unexpected: true }), shinmoneProfile).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(request({
      bootstrapProfileKey: shinmoneProfile.profileKey,
      providerPayload: ['invalid']
    }), shinmoneProfile).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(shinmoneRequest('token', {
      unexpected: 'x'.repeat(12_000)
    }), shinmoneProfile).ok).toBe(false);
    expect(parseConnectorBindingBootstrapRequestV1(
      new Uint8Array(CONNECTOR_BINDING_MAX_REQUEST_BYTES + 1),
      shinmoneProfile
    ).ok).toBe(false);
  });

  it('accepts only an opaque bounded reference response or code-only failure', () => {
    const success = encoder.encode(JSON.stringify({
      version: '1', requestId: '76439084-9a9e-4981-9cd7-2e71e822fe28', connectorContextRef: 'ccr_abcdefghijklmnopqrstuvwxyz012345', expiresIn: 120
    }));
    const failure = encoder.encode(JSON.stringify({
      version: '1', requestId: '76439084-9a9e-4981-9cd7-2e71e822fe28', status: 'failed', error: { code: 'CONNECTOR_AUTH_FAILED' }
    }));
    expect(parseConnectorBindingBootstrapResponseV1(success, requestId).ok).toBe(true);
    expect(parseConnectorBindingBootstrapResponseV1(failure, requestId).ok).toBe(true);
    expect(parseConnectorBindingBootstrapResponseV1(success, 'different-request').ok).toBe(false);
    expect(parseConnectorBindingBootstrapResponseV1(encoder.encode(JSON.stringify({
      version: '1', requestId: '76439084-9a9e-4981-9cd7-2e71e822fe28', connectorContextRef: 'secret', expiresIn: 120
    })), requestId).ok).toBe(false);
    expect(parseConnectorBindingBootstrapResponseV1(new Uint8Array(CONNECTOR_BINDING_MAX_RESPONSE_BYTES + 1), requestId).ok).toBe(false);
  });
});

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\r\n]/.test(value);
}

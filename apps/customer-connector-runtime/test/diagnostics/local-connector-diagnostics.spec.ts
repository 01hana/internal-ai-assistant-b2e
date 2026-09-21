import { LocalConnectorDiagnostics, type RuntimeDiagnosticEvent } from '../../src/diagnostics/local-connector-diagnostics';
import { ConnectorBindingRequestService } from '../../src/bindings/connector-binding-request.service';

describe('local binding-route diagnostics', () => {
  it('is disabled by default and emits no event', () => {
    const events: RuntimeDiagnosticEvent[] = [];
    new LocalConnectorDiagnostics({}, (event) => events.push(event)).emit('BINDING_ROUTE_RECEIVED', 'RECEIVED');
    expect(events).toEqual([]);
  });

  it.each([
    [{ LOCAL_DEVELOPMENT: '1' }, false],
    [{ LOCAL_CONNECTOR_DIAGNOSTICS: '1' }, false],
    [{ LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' }, true]
  ])('requires both local flags: %#', (environment, enabled) => {
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(environment, (event) => events.push(event));
    diagnostics.emit('INVOCATION_ROUTE_RECEIVED', 'RECEIVED', { requestId: 'request-safe' });
    expect(diagnostics.enabled).toBe(enabled);
    expect(events).toHaveLength(enabled ? 1 : 0);
  });

  it('drops arbitrary secret-bearing metadata from invocation diagnostics', () => {
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_CONNECTOR_DIAGNOSTICS: '1', LOCAL_DEVELOPMENT: '1' },
      (event) => events.push(event)
    );
    diagnostics.emit('UPSTREAM_REQUEST_FAILED', 'FAILED', {
      requestId: 'request-safe',
      authorization: 'Bearer authorization-secret-sentinel',
      connectorContextRef: 'ccr_reference-secret-sentinel',
      credentialHandle: 'credential-handle-secret-sentinel',
      responseBody: 'raw-response-body-secret-sentinel',
      extractedValue: 987654321
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: 'request-safe', stage: 'UPSTREAM_REQUEST_FAILED' });
    expect(JSON.stringify(events)).not.toMatch(/authorization-secret|reference-secret|credential-handle|raw-response-body|987654321/i);
  });

  it('bounds generic response-pointer counts without accepting pointer strings or business values', () => {
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_CONNECTOR_DIAGNOSTICS: '1', LOCAL_DEVELOPMENT: '1' },
      (event) => events.push(event)
    );
    diagnostics.emit('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', {
      responsePointerCount: 999,
      responsePointerResolvedCount: 998,
      responsePointerMissingCount: 1,
      applicationCodePointerConfigured: true,
      applicationCodePointerResolved: false,
      applicationCodeValidationStatus: 'TYPE_INVALID',
      declaredPointerSchemaCount: 997,
      declaredPointerSchemaValidCount: 996,
      declaredPointerSchemaInvalidCount: 1,
      fullClosedSchemaValidation: 'FAIL',
      responsePointer: '/customer/private/value',
      extractedValue: 'business-value-secret-sentinel'
    } as never);
    expect(events).toEqual([expect.objectContaining({
      responsePointerCount: 64,
      responsePointerResolvedCount: 64,
      responsePointerMissingCount: 1,
      applicationCodePointerConfigured: true,
      applicationCodePointerResolved: false,
      applicationCodeValidationStatus: 'TYPE_INVALID',
      declaredPointerSchemaCount: 64,
      declaredPointerSchemaValidCount: 64,
      declaredPointerSchemaInvalidCount: 1,
      fullClosedSchemaValidation: 'FAIL'
    })]);
    expect(JSON.stringify(events)).not.toMatch(/customer\/private|business-value-secret-sentinel/);
  });

  it('drops unrecognized response-contract categories', () => {
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_CONNECTOR_DIAGNOSTICS: '1', LOCAL_DEVELOPMENT: '1' },
      (event) => events.push(event)
    );
    diagnostics.emit('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', {
      applicationCodeValidationStatus: 'application-code-secret-sentinel',
      fullClosedSchemaValidation: 'schema-secret-sentinel'
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('applicationCodeValidationStatus');
    expect(events[0]).not.toHaveProperty('fullClosedSchemaValidation');
    expect(JSON.stringify(events)).not.toMatch(/secret-sentinel/);
  });

  it('records safe stage results without request, proof, credential, or binding material', async () => {
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_CONNECTOR_DIAGNOSTICS: '1', LOCAL_DEVELOPMENT: '1' },
      (event) => events.push(event)
    );
    const trustedContext = {
      customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a',
      connectorInstanceId: 'connector-a', organizationId: 'organization-a', actorId: 'actor-a'
    };
    const internalBindingRequestId = '5a8271fb-1127-421c-83eb-3dc6b512db50';
    const authenticator = { authenticateRegisteredBootstrap: jest.fn().mockResolvedValue({ ok: true, value: { proof: {
      requestId: internalBindingRequestId, profileKey: 'profile-a', providerKey: 'provider-a', trustedContext
    } } }) };
    const provider = {
      contract: {
        profileKey: 'profile-a', maxProviderPayloadBytes: 512,
        parseProviderPayload: jest.fn().mockReturnValue({ ok: true, value: { secret: 'provider-payload-secret-sentinel' } })
      },
      bootstrapProviderKey: 'provider-a',
      create: jest.fn().mockResolvedValue({
        credentialProviderKey: 'credential-provider-a', opaqueCredentialHandle: 'credential-handle-secret-sentinel',
        credentialGeneration: 'generation-a', providerMetadata: {}
      }),
      revoke: jest.fn()
    };
    const providers = { resolve: jest.fn().mockReturnValue(provider) };
    const bindings = { mint: jest.fn().mockResolvedValue({ ok: true, value: {
      connectorContextRef: 'binding-reference-secret-sentinel', expiresIn: 60
    } }), revoke: jest.fn() };
    const service = new ConnectorBindingRequestService(authenticator as never, providers as never, bindings as never, diagnostics);
    const requestBody = Buffer.from(JSON.stringify({
      version: '1', requestId: internalBindingRequestId, bootstrapProfileKey: 'profile-a', trustedContext,
      providerPayload: { secret: 'provider-payload-secret-sentinel' }
    }));

    const result = await service.handle({
      method: 'POST', contentType: 'application/json',
      authorization: 'Bearer authorization-proof-secret-sentinel', rawBody: requestBody,
      diagnosticRequestId: internalBindingRequestId
    });

    expect(result.statusCode).toBe(200);
    expect(authenticator.authenticateRegisteredBootstrap).toHaveBeenCalledTimes(1);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(bindings.mint).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.stage)).toEqual([
      'BINDING_SERVICE_AUTH_SUCCEEDED', 'BOOTSTRAP_PROFILE_RESOLVED', 'BOOTSTRAP_PROVIDER_RESOLVED',
      'BINDING_CONTEXT_VALIDATED', 'CREDENTIAL_CREATE_SUCCEEDED', 'BINDING_MINT_SUCCEEDED'
    ]);
    expect(new Set(events.flatMap((event) => Object.keys(event)))).toEqual(new Set([
      'timestamp', 'service', 'stage', 'result', 'internalBindingRequestId'
    ]));
    const output = JSON.stringify(events);
    for (const prohibited of [
      'authorization-proof-secret-sentinel', 'Authorization', 'provider-payload-secret-sentinel',
      'credential-handle-secret-sentinel', 'binding-reference-secret-sentinel', requestBody.toString('utf8'),
      'private-key-secret-sentinel', 'response-body-secret-sentinel'
    ]) expect(output).not.toContain(prohibited);
  });
});

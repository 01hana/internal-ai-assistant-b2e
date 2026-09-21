import { LocalConnectorDiagnostics, type BridgeDiagnosticEvent } from '../../src/diagnostics/local-connector-diagnostics';
import { ExchangeService } from '../../src/exchange/exchange.service';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../src/idx/permission-normalizer';
import { ScopeProjector } from '../../src/idx/scope-projector';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { bridgeEnvironment } from '../signing/signing-fixtures';
import { menu, response, token } from '../fixtures/idx-semantic.vectors';

describe('local Connector correlation diagnostics', () => {
  it('is disabled by default and unless both explicit local flags are present', () => {
    for (const environment of [{}, { LOCAL_CONNECTOR_DIAGNOSTICS: '1' }, { LOCAL_DEVELOPMENT: '1' }]) {
      const events: BridgeDiagnosticEvent[] = [];
      new LocalConnectorDiagnostics(environment, (event) => events.push(event)).emit('EXCHANGE_REQUEST_ACCEPTED', 'SUCCEEDED');
      expect(events).toEqual([]);
    }
  });

  it('emits only allowlisted correlation metadata and never credential-bearing values', async () => {
    const events: BridgeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_CONNECTOR_DIAGNOSTICS: '1', LOCAL_DEVELOPMENT: '1' },
      (event) => events.push(event)
    );
    const nativeToken = token({
      sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry',
      sentinelClaim: 'jwt-claims-secret-sentinel'
    });
    const menuBody = response([menu()]);
    const transport = { execute: jest.fn().mockResolvedValue({ body: menuBody }) };
    const connectorBinding = { bootstrap: jest.fn().mockResolvedValue({
      ok: true, connectorContextRef: 'connector-context-ref-secret-sentinel', expiresIn: 60
    }) };
    const issuer = { issue: jest.fn().mockResolvedValue({ accessToken: 'canonical-jwt-secret-sentinel' }) };
    const config = new BridgeConfigService(bridgeEnvironment([{ kid: 'shape-only', status: 'published', publicJwk: {} }]));
    const service = new ExchangeService(
      transport as never,
      new IdxMenuDetailValidator(),
      new IdentityAdmissionService(config),
      new IdxPermissionNormalizer(),
      new ScopeProjector(),
      issuer as never,
      connectorBinding as never,
      diagnostics
    );

    const result = await service.exchange(nativeToken, '3bf71d6f-151c-4ef2-b534-0268b3c5cde2');

    expect(result).toEqual({
      accessToken: 'canonical-jwt-secret-sentinel', tokenType: 'Bearer', expiresIn: 300,
      connectorContextRef: 'connector-context-ref-secret-sentinel', connectorContextExpiresIn: 60
    });
    expect(transport.execute).toHaveBeenCalledTimes(1);
    expect(connectorBinding.bootstrap).toHaveBeenCalledTimes(1);
    expect(issuer.issue).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.stage)).toEqual([
      'EXCHANGE_REQUEST_ACCEPTED', 'MENUDETAIL_REQUEST_STARTED', 'MENUDETAIL_REQUEST_SUCCEEDED',
      'IDENTITY_ADMISSION_SUCCEEDED', 'CANONICAL_TOKEN_ISSUED', 'EXCHANGE_COMPLETED'
    ]);
    expect(new Set(events.flatMap((event) => Object.keys(event)))).toEqual(new Set([
      'timestamp', 'service', 'stage', 'result', 'publicExchangeRequestId', 'durationMs'
    ]));
    const output = JSON.stringify(events);
    for (const prohibited of [
      nativeToken, 'Authorization', 'jwt-claims-secret-sentinel',
      'canonical-jwt-secret-sentinel', 'connector-context-ref-secret-sentinel', 'binding-reference-secret-sentinel',
      'credential-handle-secret-sentinel', 'private-key-secret-sentinel', JSON.stringify(menuBody)
    ]) expect(output).not.toContain(prohibited);
  });
});

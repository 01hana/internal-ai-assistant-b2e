import { ExchangeService } from '../../src/exchange/exchange.service';
import { ExchangeUnavailableError } from '../../src/exchange/redaction';
import type { ConnectorBindingCoordinator } from '../../src/connector-binding/connector-binding.coordinator';
import { ConnectorBindingReadinessInitializer } from '../../src/connector-binding/connector-binding.module';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { BridgeReadinessRegistry } from '../../src/health/readiness.service';
import { bindingEnvironment } from './binding-fixtures';

describe('connector-enabled exchange Stage 2 composition', () => {
  it('runs Stage 2 after admission and permission processing, sends the same native token once, then issues the canonical JWT', async () => {
    const order: string[] = [];
    const nativeAccessToken = 'native-access-token-sentinel';
    const identity = Object.freeze({ subject: 'user-a', organization: 'company-a', entry: 'configured-entry' });
    const transport = { execute: jest.fn(async (token: string) => { order.push(`menu:${token}`); return { body: { menus: [] } }; }) };
    const validator = { validate: jest.fn(() => { order.push('validate'); return []; }) };
    const admission = { admit: jest.fn((_menus, token: string) => { order.push(`admit:${token}`); return identity; }) };
    const normalizer = { normalize: jest.fn(() => { order.push('normalize'); return []; }) };
    const projector = { project: jest.fn(() => { order.push('project'); return []; }) };
    const binding: Pick<ConnectorBindingCoordinator, 'bootstrap'> = {
      bootstrap: jest.fn(async () => {
        order.push('binding');
        return { ok: true as const, connectorContextRef: 'ccr_phase8_reference', expiresIn: 60 };
      })
    };
    const issuer = { issue: jest.fn(async () => { order.push('issuer'); return { accessToken: 'canonical-token' }; }) };
    const service = new ExchangeService(transport as never, validator as never, admission as never, normalizer as never,
      projector as never, issuer as never, binding as ConnectorBindingCoordinator);

    await expect(service.exchange(nativeAccessToken)).resolves.toEqual({
      accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300,
      connectorContextRef: 'ccr_phase8_reference', connectorContextExpiresIn: 60
    });
    expect(order).toEqual([
      `menu:${nativeAccessToken}`, 'validate', `admit:${nativeAccessToken}`, 'normalize', 'project', 'binding', 'issuer'
    ]);
    expect(binding.bootstrap).toHaveBeenCalledWith({ nativeAccessToken, acceptedIdentity: identity }, undefined);
    expect(binding.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('maps every Stage 2 failure to unavailable, returns no reference, and does not issue a canonical token', async () => {
    const issuer = { issue: jest.fn() };
    const binding = { bootstrap: jest.fn(async () => ({ ok: false as const, code: 'CONNECTOR_TIMEOUT' as const })) };
    const service = serviceWith(binding, issuer);
    await expect(service.exchange('native-credential-sentinel')).rejects.toBeInstanceOf(ExchangeUnavailableError);
    expect(binding.bootstrap).toHaveBeenCalledTimes(1);
    expect(issuer.issue).not.toHaveBeenCalled();
    await expect(service.exchange('native-credential-sentinel')).rejects.not.toThrow(/native|credential|timeout|reference/i);
  });

  it('preserves the legacy response shape when connector binding is disabled', async () => {
    const issuer = { issue: jest.fn(async () => ({ accessToken: 'canonical-token' })) };
    const binding = { bootstrap: jest.fn(async () => ({ ok: true as const })) };
    await expect(serviceWith(binding, issuer).exchange('native-token')).resolves.toEqual({
      accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300
    });
  });

  it('marks legacy-disabled and complete production-safe connector composition ready, but not a test-loopback client', async () => {
    const legacyRegistry = new BridgeReadinessRegistry();
    await new ConnectorBindingReadinessInitializer(
      new BridgeConfigService(bindingEnvironment({ connectorEnabled: false })), legacyRegistry,
      { validate: jest.fn(async () => false) } as never, { validate: jest.fn(async () => false) } as never
    ).onModuleInit();
    expect(legacyRegistry.snapshot().connectorBinding).toBe(true);

    for (const [clientReady, expected] of [[true, true], [false, false]] as const) {
      const registry = new BridgeReadinessRegistry();
      const signer = { validate: jest.fn(async () => true) };
      const client = { validate: jest.fn(async () => clientReady) };
      await new ConnectorBindingReadinessInitializer(
        new BridgeConfigService(bindingEnvironment()), registry, signer as never, client as never
      ).onModuleInit();
      expect(registry.snapshot().connectorBinding).toBe(expected);
    }
  });
});

function serviceWith(binding: object, issuer: object): ExchangeService {
  return new ExchangeService(
    { execute: jest.fn(async () => ({ body: {} })) } as never,
    { validate: jest.fn(() => []) } as never,
    { admit: jest.fn(() => ({ subject: 'user-a', organization: 'company-a', entry: 'configured-entry' })) } as never,
    { normalize: jest.fn(() => []) } as never,
    { project: jest.fn(() => []) } as never,
    issuer as never,
    binding as ConnectorBindingCoordinator
  );
}

import { ExchangeService } from '../../src/exchange/exchange.service';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../src/idx/permission-normalizer';
import { ScopeProjector } from '../../src/idx/scope-projector';
import { BridgeConfigService } from '../../src/config/bridge-config.service';
import type { ConnectorBindingCoordinator } from '../../src/connector-binding/connector-binding.coordinator';
import { menu, response, token } from '../fixtures/idx-semantic.vectors';
import { bridgeEnvironment } from '../signing/signing-fixtures';

describe('Feature 009 amended Stage 2 acceptance', () => {
  it('runs one binding handoff only after MenuDetail and admission and returns the additive opaque reference', async () => {
    const order: string[] = [];
    const nativeAccessToken = token({
      sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry'
    });
    const config = new BridgeConfigService(bridgeEnvironment([{ kid: 'shape-only', status: 'published', publicJwk: {} }]));
    const transport = {
      execute: jest.fn(async (credential: string) => {
        order.push(`menu:${credential}`);
        return { body: response([menu()]) };
      })
    };
    const admission = new IdentityAdmissionService(config);
    const originalAdmit = admission.admit.bind(admission);
    jest.spyOn(admission, 'admit').mockImplementation((menus, credential) => {
      order.push('admission');
      return originalAdmit(menus, credential);
    });
    const binding: Pick<ConnectorBindingCoordinator, 'bootstrap'> = {
      bootstrap: jest.fn(async (input) => {
        order.push(`binding:${input.nativeAccessToken}`);
        return Object.freeze({ ok: true as const, connectorContextRef: 'ccr_phase8_reference', expiresIn: 60 });
      })
    };
    const issuer = {
      issue: jest.fn(async () => {
        order.push('issuer');
        return { accessToken: 'canonical-token' };
      })
    };
    const service = new ExchangeService(
      transport as never,
      new IdxMenuDetailValidator(),
      admission,
      new IdxPermissionNormalizer(),
      new ScopeProjector(),
      issuer as never,
      binding as ConnectorBindingCoordinator
    );

    await expect(service.exchange(nativeAccessToken)).resolves.toEqual({
      accessToken: 'canonical-token', tokenType: 'Bearer', expiresIn: 300,
      connectorContextRef: 'ccr_phase8_reference', connectorContextExpiresIn: 60
    });
    expect(order).toEqual([`menu:${nativeAccessToken}`, 'admission', `binding:${nativeAccessToken}`, 'issuer']);
    expect(binding.bootstrap).toHaveBeenCalledTimes(1);
  });
});

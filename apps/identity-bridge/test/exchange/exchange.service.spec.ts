import { BridgeConfigService } from '../../src/config/bridge-config.service';
import { decodeJwt } from 'jose';
import { ExchangeIdentityDeniedError, ExchangeUnavailableError } from '../../src/exchange/redaction';
import { ExchangeService } from '../../src/exchange/exchange.service';
import { IdentityAdmissionService } from '../../src/idx/identity-admission.service';
import { IdxMenuDetailValidator } from '../../src/idx/menu-detail.validator';
import { IdxPermissionNormalizer } from '../../src/idx/permission-normalizer';
import { ScopeProjector } from '../../src/idx/scope-projector';
import { IdxTransportError } from '../../src/idx/transport/transport.error';
import { ActiveKeyResolver } from '../../src/signing/active-key.resolver';
import { CanonicalTokenIssuer } from '../../src/signing/canonical-token.issuer';
import { menu, response, token } from '../fixtures/idx-semantic.vectors';
import { bridgeEnvironment, rsaSigningFixture, signingConfig } from '../signing/signing-fixtures';

describe('Identity Bridge exchange service', () => {
  it('runs the accepted transport-to-canonical chain in order and projects issuer metadata away', async () => {
    const order: string[] = [];
    const body = response([
      menu({ MenuID: 'B', MenuPermission: { ...(menu().MenuPermission as object), Insert: 'Y' } }),
      menu({ MenuID: 'A' }),
      menu({ MenuID: 'B' })
    ]);
    const transport = { execute: jest.fn(async (credential: string) => { order.push(`transport:${credential}`); return { body }; }) };
    const validator = new IdxMenuDetailValidator();
    const admission = new IdentityAdmissionService(config());
    const normalizer = new IdxPermissionNormalizer();
    const projector = new ScopeProjector();
    const fixture = rsaSigningFixture();
    const issuerConfig = signingConfig([fixture.record]);
    const issuer = new CanonicalTokenIssuer(issuerConfig, new ActiveKeyResolver(issuerConfig), () => 1000, () => '123e4567-e89b-42d3-a456-426614174000');
    const issue = jest.spyOn(issuer, 'issue').mockImplementation(async (input) => { order.push('issuer'); return CanonicalTokenIssuer.prototype.issue.call(issuer, input); });
    const service = new ExchangeService(transport as never, validator, admission, normalizer, projector, issuer);

    const result = await service.exchange(token({
      sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry',
      UserType: 'admin', IsAdmin: true, Permissions: ['forged'], Permission_Hash: 'forged'
    }));

    expect(order[0]).toMatch(/^transport:/);
    expect(order[1]).toBe('issuer');
    expect(issue).toHaveBeenCalledWith({
      identity: { subject: 'user-a', organization: 'company-a', entry: 'configured-entry' },
      permissionScopes: ['menu:A:read', 'menu:B:read', 'menu:B:insert']
    });
    expect(result).toMatchObject({ accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 300 });
    expect(Object.keys(result).sort()).toEqual(['accessToken', 'expiresIn', 'tokenType']);
    const payload = decodeJwt(result.accessToken);
    expect(payload).toMatchObject({ roles: [], permission_scopes: ['menu:A:read', 'menu:B:read', 'menu:B:insert'] });
    expect(payload).not.toHaveProperty('UUID_Entry');
    expect(payload).not.toHaveProperty('entry');
  });

  it('rejects malformed MenuDetail as unavailable before parsing even valid-looking native claims', async () => {
    const issuer = { issue: jest.fn() };
    const service = createService({ Code: 500, ExecutionTime: '1ms', Message: '', Version: '1', Data: [] }, issuer);
    await expect(service.exchange(token({ sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry' })))
      .rejects.toBeInstanceOf(ExchangeUnavailableError);
    expect(issuer.issue).not.toHaveBeenCalled();
  });

  it.each([
    { sub: 'other', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry' },
    { sub: 'user-a', UUID_User: 'user-a', UUID_Company: ['company-a'], UUID_Entry: 'configured-entry' },
    { sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'wrong-entry' },
    { sub: 'user-a', UUID_User: 'user-a', UUID_Company: '', UUID_Entry: 'configured-entry' }
  ])('maps post-acceptance identity/admission failure to denial without issuing', async (claims) => {
    const issuer = { issue: jest.fn() };
    const service = createService(response(), issuer);
    await expect(service.exchange(token(claims))).rejects.toBeInstanceOf(ExchangeIdentityDeniedError);
    expect(issuer.issue).not.toHaveBeenCalled();
  });

  it('preserves typed transport failures and maps signing/runtime failures to unavailable', async () => {
    const transportFailure = new IdxTransportError('credential_rejected');
    const failedTransport = new ExchangeService({ execute: jest.fn().mockRejectedValue(transportFailure) } as never, new IdxMenuDetailValidator(), new IdentityAdmissionService(config()), new IdxPermissionNormalizer(), new ScopeProjector(), { issue: jest.fn() } as never);
    await expect(failedTransport.exchange('credential')).rejects.toBe(transportFailure);

    const service = createService(response(), { issue: jest.fn().mockRejectedValue(new Error('private failure')) });
    await expect(service.exchange(token({ sub: 'user-a', UUID_User: 'user-a', UUID_Company: 'company-a', UUID_Entry: 'configured-entry' })))
      .rejects.toBeInstanceOf(ExchangeUnavailableError);
  });
});

function config(): BridgeConfigService { return new BridgeConfigService(bridgeEnvironment([{ kid: 'shape-only', status: 'published', publicJwk: {} }])); }
function createService(body: unknown, issuer: { issue: jest.Mock }): ExchangeService {
  return new ExchangeService(
    { execute: jest.fn().mockResolvedValue({ body }) } as never,
    new IdxMenuDetailValidator(), new IdentityAdmissionService(config()), new IdxPermissionNormalizer(), new ScopeProjector(), issuer as never
  );
}

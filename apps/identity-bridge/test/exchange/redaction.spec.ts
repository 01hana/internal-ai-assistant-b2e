import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ExchangeController } from '../../src/exchange/exchange.controller';
import { ExchangeUnavailableError } from '../../src/exchange/redaction';

const sentinels = [
  'native-access-token-sentinel', 'Authorization: Bearer sentinel', 'refresh-token-sentinel',
  'native-claims-sentinel', 'UUID_User-sentinel', 'UUID_Company-sentinel', 'UUID_Entry-sentinel',
  'raw-menudetail-sentinel', 'file:///private-key-sentinel', 'private-key-material-sentinel', 'canonical-jwt-sentinel'
];

describe('Identity Bridge exchange redaction boundary', () => {
  it('returns the canonical JWT only in a successful accessToken field', async () => {
    const controller = new ExchangeController({ exchange: jest.fn().mockResolvedValue({ accessToken: sentinels[10], tokenType: 'Bearer', expiresIn: 300 }) } as never);
    const response = await controller.exchange('Bearer native-access-token-sentinel', undefined, {});
    expect(response).toEqual({ accessToken: 'canonical-jwt-sentinel', tokenType: 'Bearer', expiresIn: 300 });
    expect(JSON.stringify(response).replace('canonical-jwt-sentinel', '')).not.toContain('sentinel');
  });

  it('does not project any sensitive underlying failure material', async () => {
    for (const sentinel of sentinels) {
      const failure = Object.assign(new ExchangeUnavailableError(), { cause: new Error(sentinel), detail: sentinel });
      const controller = new ExchangeController({ exchange: jest.fn().mockRejectedValue(failure) } as never);
      const error = await capture(controller.exchange('Bearer native-access-token-sentinel', sentinel, {}));
      expect(JSON.stringify(error)).not.toContain(sentinel);
      expect(String(error)).not.toContain(sentinel);
    }
  });

  it('contains no logging, persistence, central-runtime, native-verification, or early-session surface', () => {
    const root = join(__dirname, '../../src');
    const sources = [
      'exchange/exchange.controller.ts', 'exchange/exchange.service.ts', 'exchange/exchange.module.ts', 'exchange/redaction.ts'
    ].map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
    expect(sources).not.toMatch(/console\.|logger|telemetry|trace|audit|persist|database|prisma|apps\/gateway|GatewayModule|ManagedIdentityExchangeModule|ManagedUpstreamTokenIssuer|IntegrationBinding|CustomerScope|createSession|ES512|NativeIdxJwtVerifier|IdxJwksVerifier/i);
    expect(sources).not.toMatch(/refreshToken|customerId|integrationSelector/);
  });
});

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try { await promise; } catch (error) { return error; }
  throw new Error('Expected exchange request to fail.');
}

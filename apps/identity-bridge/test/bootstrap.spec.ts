import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const bridgeRoot = join(__dirname, '..');

describe('Identity Bridge bootstrap contract', () => {
  it('has its own Nest bootstrap, root module, and configuration shell', () => {
    for (const relativePath of ['src/main.ts', 'src/bridge.module.ts', 'src/config/configuration.module.ts']) {
      expect(existsSync(join(bridgeRoot, relativePath))).toBe(true);
    }

    const main = readFileSync(join(bridgeRoot, 'src/main.ts'), 'utf8');
    const module = readFileSync(join(bridgeRoot, 'src/bridge.module.ts'), 'utf8');
    expect(main).toMatch(/NestFactory\.create\(BridgeModule/);
    expect(module).toMatch(/export class BridgeModule/);
  });

  it('excludes Gateway, Prisma, and managed identity exchange runtime composition', () => {
    expect(existsSync(join(bridgeRoot, 'src/main.ts'))).toBe(true);
    expect(existsSync(join(bridgeRoot, 'src/bridge.module.ts'))).toBe(true);
    expect(existsSync(join(bridgeRoot, 'src/config/configuration.module.ts'))).toBe(true);
    const source = [
      readFileSync(join(bridgeRoot, 'src/main.ts'), 'utf8'),
      readFileSync(join(bridgeRoot, 'src/bridge.module.ts'), 'utf8'),
      readFileSync(join(bridgeRoot, 'src/config/configuration.module.ts'), 'utf8')
    ].join('\n');
    expect(source).not.toMatch(/GatewayModule|ManagedIdentityExchangeModule|prisma|generated\/|GatewaySigning|InternalIdentityTokenIssuer/i);
  });
});

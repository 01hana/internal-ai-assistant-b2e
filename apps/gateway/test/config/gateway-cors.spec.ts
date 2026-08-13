import { resolve } from 'node:path';

const targetPath = resolve(__dirname, '../../src/config/gateway-cors.config.ts');

describe('Gateway CORS configuration', () => {
  it('uses the explicit allowlist for browser GET/POST/OPTIONS requests without credentialed wildcard behavior', () => {
    const { gatewayCorsOptions } = loadTarget();
    const options = gatewayCorsOptions(['http://localhost:3001']);

    expect(options).toEqual({
      origin: ['http://localhost:3001'],
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'x-request-id', 'traceparent']
    });
    expect(JSON.stringify(options)).not.toContain('*');
  });
});

function loadTarget(): { gatewayCorsOptions: (origins: readonly string[]) => Record<string, unknown> } {
  const target = require(targetPath) as { gatewayCorsOptions?: (origins: readonly string[]) => Record<string, unknown> };
  if (!target.gatewayCorsOptions) throw new Error('Required Gateway CORS production surface missing.');
  return { gatewayCorsOptions: target.gatewayCorsOptions };
}

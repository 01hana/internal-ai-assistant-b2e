import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const parserPath = resolve(__dirname, '../../src/upstream-auth/routing-metadata.parser.ts');

describe('Bounded unverified routing metadata parser (T011/T012/T013/T016)', () => {
  it('requires the parser production surface', () => {
    expect(existsSync(parserPath)).toBe(true);
  });

  it('returns only issuer and optional protected-header kid hints', () => {
    const result = parser().parse(token(
      { kid: 'registered-key', alg: 'RS256', jku: 'https://attacker.test/jwks', jwk: { kty: 'RSA' }, x5u: 'https://attacker.test/cert', x5c: ['attacker'], crit: ['attacker'], typ: 'JWT' },
      { iss: ' https://issuer.example.test ', integration_id: 'integration-b', customer_id: 'customer-b', customer: { id: 'customer-b' }, tenant: 'tenant-b', sub: 'attacker', org_id: 'other-org', host_app: 'other-app', roles: ['admin'], permission_scopes: ['all'] }
    ));
    expect(result).toEqual({ issuerHint: 'https://issuer.example.test', kidHint: 'registered-key' });
    expect(Object.keys(result).sort()).toEqual(['issuerHint', 'kidHint']);
    expect(JSON.stringify(result)).not.toMatch(/integration|customer|tenant|attacker|other-org|roles|scope/i);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['wrong segment count', 'a.b'],
    ['empty header', `.payload.signature`],
    ['empty payload', 'header..signature'],
    ['empty signature', 'header.payload.'],
    ['invalid base64url', '***.e30.signature'],
    ['malformed JSON', `${encode('{')}.${encode('{}')}.signature`],
    ['header JSON array', `${encode('[]')}.${encode('{}')}.signature`],
    ['payload JSON array', `${encode('{}')}.${encode('[]')}.signature`],
    ['missing issuer', token({ kid: 'key-a' }, {})],
    ['non-string issuer', token({ kid: 'key-a' }, { iss: 7 })],
    ['blank issuer', token({ kid: 'key-a' }, { iss: '  ' })],
    ['issuer control character', token({ kid: 'key-a' }, { iss: 'issuer\nattack' })]
  ])('rejects %s without returning token material', (label, compactJwt) => {
    try {
      parser().parse(compactJwt);
      throw new Error('Expected parser failure.');
    } catch (error) {
      expect(error).toMatchObject({ name: 'MalformedRoutingMetadataError' });
      expect(JSON.stringify(error)).not.toContain(compactJwt);
      expect(String(error)).not.toContain(compactJwt);
      expect(String(error)).not.toMatch(/issuer\nattack|customer-b/i);
    }
  });

  it('omits missing, blank, control-character, and non-string kid without rejecting issuer routing', () => {
    for (const kid of [undefined, '', '  ', 'key\nattack', 42]) {
      expect(parser().parse(token({ kid }, { iss: 'https://issuer.example.test' }))).toEqual({ issuerHint: 'https://issuer.example.test' });
    }
  });

  it('uses explicit strict input and decoded-size bounds', () => {
    const target = load();
    expect(target.MAX_COMPACT_JWT_BYTES).toBe(16 * 1024);
    expect(target.MAX_PROTECTED_HEADER_BYTES).toBe(2 * 1024);
    expect(target.MAX_ROUTING_PAYLOAD_BYTES).toBe(4 * 1024);
    expect(() => parser().parse('a'.repeat(target.MAX_COMPACT_JWT_BYTES + 1))).toThrow();
    expect(() => parser().parse(`${encode('x'.repeat(target.MAX_PROTECTED_HEADER_BYTES + 1))}.${encode(JSON.stringify({ iss: 'issuer' }))}.signature`)).toThrow();
    expect(() => parser().parse(`${encode(JSON.stringify({ kid: 'key-a' }))}.${encode('x'.repeat(target.MAX_ROUTING_PAYLOAD_BYTES + 1))}.signature`)).toThrow();
  });

  it('has no verifier, network, logging, or full-claim public boundary', () => {
    const source = readFileSync(parserPath, 'utf8');
    expect(source).not.toMatch(/jwtVerify|createRemoteJWKSet|fetch\(|https?\.request|dns\.|console\.|logger|VerifiedUpstreamIdentity|integration_id|customer_id|CanonicalGatewayIdentity/);
  });
});

function parser() { return new (load().RoutingMetadataParser)(); }

function load(): { RoutingMetadataParser: new () => { parse(compactJwt: string): Readonly<{ issuerHint: string; kidHint?: string }> }; MAX_COMPACT_JWT_BYTES: number; MAX_PROTECTED_HEADER_BYTES: number; MAX_ROUTING_PAYLOAD_BYTES: number } {
  if (!existsSync(parserPath)) throw new Error('Required Batch 2 production surface missing: RoutingMetadataParser.');
  return require(parserPath);
}

function token(header: unknown, payload: unknown): string { return `${encode(JSON.stringify(header))}.${encode(JSON.stringify(payload))}.signature`; }
function encode(value: string): string { return Buffer.from(value).toString('base64url'); }

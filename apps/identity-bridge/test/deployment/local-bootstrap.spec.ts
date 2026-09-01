import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bridgeRoot = resolve(__dirname, '../..');
const bootstrap = join(bridgeRoot, 'scripts/local-bootstrap.mjs');
const verify = join(bridgeRoot, 'scripts/local-verify.mjs');

describe('pre-Phase-10 local deployment bootstrap', () => {
  it('creates persistent PKCS#8/JWK and CA-signed SAN certificate material without private environment data', async () => {
    const secretDir = await mkdtemp(join(tmpdir(), 'identity-bridge-local-'));

    run(process.execPath, [bootstrap, '--secret-dir', secretDir]);
    const privateKeyPath = join(secretDir, 'bridge-private-key.pem');
    const signingEnvironmentPath = join(secretDir, 'bridge-signing.env');
    const certificatePath = join(secretDir, 'tls', 'idx-proxy.local.crt');
    const caPath = join(secretDir, 'tls', 'local-ca.crt');
    const firstHashes = await hashes([privateKeyPath, certificatePath, caPath]);

    const privatePem = await readFile(privateKeyPath, 'utf8');
    expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(createPrivateKey(privatePem).asymmetricKeyType).toBe('rsa');
    expect((await stat(privateKeyPath)).mode & 0o777).toBe(0o600);

    const signingEnvironment = await readFile(signingEnvironmentPath, 'utf8');
    expect(signingEnvironment).not.toContain('PRIVATE KEY');
    const signingKeys = JSON.parse(signingEnvironment.trim().slice('BRIDGE_SIGNING_KEYS='.length));
    expect(signingKeys).toHaveLength(1);
    expect(signingKeys[0]).toEqual({
      kid: 'shinmone-scm-local-2026-01',
      status: 'active',
      publicJwk: expect.objectContaining({
        kty: 'RSA', kid: 'shinmone-scm-local-2026-01', alg: 'RS256', use: 'sig'
      }),
      keyReference: 'file:/run/secrets/identity-bridge-private-key.pem'
    });
    expect(Object.keys(signingKeys[0].publicJwk).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(signingKeys[0].publicJwk).toEqual(expect.objectContaining(createPublicKey(privatePem).export({ format: 'jwk' })));

    expect(run('openssl', ['verify', '-CAfile', caPath, certificatePath]).stdout).toContain(': OK');
    expect(run('openssl', ['x509', '-in', certificatePath, '-noout', '-text']).stdout).toContain('DNS:idx-proxy.local');

    run(process.execPath, [bootstrap, '--secret-dir', secretDir]);
    expect(await hashes([privateKeyPath, certificatePath, caPath])).toEqual(firstHashes);
  }, 30_000);

  it('classifies the documented Entry marker as synthetic and blocks the real-IDX path', async () => {
    const environmentPath = join(bridgeRoot, 'env/local.env.example');
    const result = run(process.execPath, [verify, '--entry-precheck', environmentPath]);
    expect(result.stdout).toContain('REAL_ENTRY_UUIDS_AVAILABLE=NO');
    expect(result.stdout).toContain('REAL_IDX_LOCAL_EXCHANGE=NOT_RUN');
  });
});

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: bridgeRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`command failed (${result.status}): ${result.stderr || result.stdout}`);
  return result;
}

async function hashes(paths: string[]) {
  return Promise.all(paths.map(async (path) => createHash('sha256').update(await readFile(path)).digest('hex')));
}

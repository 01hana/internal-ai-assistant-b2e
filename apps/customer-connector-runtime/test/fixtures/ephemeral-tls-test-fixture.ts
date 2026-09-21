import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const TEST_TLS_HOSTNAME = 'phase6-upstream.test';

export type EphemeralTlsTestFixture = Readonly<{
  hostname: typeof TEST_TLS_HOSTNAME;
  certificate: string;
  privateKey: string;
  dispose(): Promise<void>;
}>;

/** Generates a matching loopback-only TLS keypair in an OS temporary directory. */
export async function createEphemeralTlsTestFixture(): Promise<EphemeralTlsTestFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'connector-runtime-test-tls-'));
  const keyPath = join(directory, 'server-key.pem');
  const certificatePath = join(directory, 'server-certificate.pem');

  try {
    await execFile('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-keyout', keyPath, '-out', certificatePath,
      '-subj', `/CN=${TEST_TLS_HOSTNAME}`,
      '-addext', `subjectAltName=DNS:${TEST_TLS_HOSTNAME}`,
      '-addext', 'basicConstraints=critical,CA:FALSE',
      '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
      '-addext', 'extendedKeyUsage=serverAuth'
    ], { maxBuffer: 1024 * 1024 });

    const [privateKey, certificate] = await Promise.all([
      readFile(keyPath, 'utf8'),
      readFile(certificatePath, 'utf8')
    ]);

    return Object.freeze({
      hostname: TEST_TLS_HOSTNAME,
      certificate,
      privateKey,
      dispose: () => rm(directory, { recursive: true, force: true })
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportJWK, exportPKCS8, exportSPKI, generateKeyPair, type KeyLike } from 'jose';

export type EphemeralRsaFixture = Readonly<{
  privateKey: KeyLike;
  publicKey: KeyLike;
  kid: string;
  publicJwk: Readonly<Record<string, unknown>>;
  privatePem: string;
  publicPem: string;
  writeTemporaryPem(): Promise<Readonly<{ fileReference: string; relativeReference: string; dispose(): Promise<void> }>>;
  writeTemporaryContent(content: string, filename?: string): Promise<Readonly<{ fileReference: string; relativeReference: string; dispose(): Promise<void> }>>;
}>;

/** Test-only RSA material. No private key is committed or retained after a test. */
export async function createEphemeralRsaFixture(input: Readonly<{ kid?: string }> = {}): Promise<EphemeralRsaFixture> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const kid = input.kid ?? 'phase5-test-active-kid';
  const publicJwk = Object.freeze({ ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' });
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);

  return Object.freeze({
    privateKey,
    publicKey,
    kid,
    publicJwk,
    privatePem,
    publicPem,
    writeTemporaryPem: () => writeTemporaryContent(privatePem, 'gateway-private.pem'),
    writeTemporaryContent
  });
}

async function writeTemporaryContent(content: string, filename = 'gateway-signing-material.pem') {
  const workingDirectory = await mkdtemp(resolve(process.cwd(), '.phase5-signing-test-'));
  const filePath = resolve(workingDirectory, filename);
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
  const relativePath = relative(process.cwd(), filePath).replaceAll('\\', '/');
  let disposed = false;

  return Object.freeze({
    fileReference: pathToFileURL(filePath).toString(),
    relativeReference: relativePath.startsWith('./') ? relativePath : `./${relativePath}`,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
}

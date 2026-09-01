#!/usr/bin/env node
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const localKid = 'shinmone-scm-local-2026-01';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const secretDir = resolve(argument('--secret-dir') ?? join(repositoryRoot, '.local-secrets/identity-bridge'));
const tlsDir = join(secretDir, 'tls');
const signingKeyPath = join(secretDir, 'bridge-private-key.pem');
const signingEnvironmentPath = join(secretDir, 'bridge-signing.env');

await mkdir(tlsDir, { recursive: true, mode: 0o700 });
await chmod(secretDir, 0o700);
await chmod(tlsDir, 0o700);

await ensureSigningKey();
await ensureTlsMaterial();
await validateTlsMaterial();

process.stdout.write(`LOCAL_SIGNING_KEY_GENERATED=YES\nLOCAL_SIGNING_KEY_PERSISTENT=YES\nLOCAL_PUBLIC_JWK_DERIVED=YES\nLOCAL_ACTIVE_KID=${localKid}\n`);

async function ensureSigningKey() {
  if (!(await exists(signingKeyPath))) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await writeFile(signingKeyPath, pem, { mode: 0o600, flag: 'wx' });
  }
  await chmod(signingKeyPath, 0o600);
  const pem = await readFile(signingKeyPath, 'utf8');
  if (!/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\s*$/.test(pem)) fail('existing signing key is not unencrypted PKCS#8');
  let privateKey;
  try { privateKey = createPrivateKey(pem); } catch { fail('existing signing key is invalid'); }
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'rsa') fail('existing signing key is not RSA');
  const exported = createPublicKey(privateKey).export({ format: 'jwk' });
  if (exported.kty !== 'RSA' || !exported.n || !exported.e) fail('public JWK derivation failed');
  const publicJwk = { kty: 'RSA', kid: localKid, alg: 'RS256', use: 'sig', n: exported.n, e: exported.e };
  const signingKeys = [{ kid: localKid, status: 'active', publicJwk, keyReference: 'file:/run/secrets/identity-bridge-private-key.pem' }];
  await atomicWrite(signingEnvironmentPath, `BRIDGE_SIGNING_KEYS=${JSON.stringify(signingKeys)}\n`, 0o600);
}

async function ensureTlsMaterial() {
  const paths = tlsPaths();
  const present = await Promise.all(Object.values(paths).map(exists));
  if (present.every(Boolean)) return;
  if (present.some(Boolean)) fail('local TLS material is incomplete; preserve or remove the complete set explicitly');

  const temporary = await mkdtemp(join(tmpdir(), 'identity-bridge-tls-'));
  try {
    const caConfig = join(temporary, 'ca.cnf');
    const leafConfig = join(temporary, 'leaf.cnf');
    const csr = join(temporary, 'idx-proxy.local.csr');
    const serial = join(temporary, 'local-ca.srl');
    const generated = {
      caKey: join(temporary, 'local-ca.key'), caCertificate: join(temporary, 'local-ca.crt'),
      proxyKey: join(temporary, 'idx-proxy.local.key'), proxyCertificate: join(temporary, 'idx-proxy.local.crt')
    };
    await writeFile(caConfig, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=Feature 007 Local Development CA\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n', { mode: 0o600 });
    await writeFile(leafConfig, '[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3_req\n[dn]\nCN=idx-proxy.local\n[v3_req]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:idx-proxy.local\n', { mode: 0o600 });
    openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', generated.caKey]);
    openssl(['req', '-new', '-x509', '-sha256', '-days', '3650', '-key', generated.caKey, '-out', generated.caCertificate, '-config', caConfig]);
    openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', generated.proxyKey]);
    openssl(['req', '-new', '-sha256', '-key', generated.proxyKey, '-out', csr, '-config', leafConfig]);
    openssl(['x509', '-req', '-days', '825', '-in', csr, '-CA', generated.caCertificate, '-CAkey', generated.caKey, '-CAserial', serial, '-CAcreateserial', '-out', generated.proxyCertificate, '-extfile', leafConfig, '-extensions', 'v3_req']);
    for (const key of ['caKey', 'proxyKey']) await chmod(generated[key], 0o600);
    for (const key of ['caCertificate', 'proxyCertificate']) await chmod(generated[key], 0o644);
    for (const key of Object.keys(paths)) await rename(generated[key], paths[key]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function validateTlsMaterial() {
  const paths = tlsPaths();
  for (const key of ['caKey', 'proxyKey']) await chmod(paths[key], 0o600);
  openssl(['verify', '-CAfile', paths.caCertificate, paths.proxyCertificate]);
  const san = openssl(['x509', '-in', paths.proxyCertificate, '-noout', '-text']);
  if (!san.includes('DNS:idx-proxy.local')) fail('proxy certificate SAN is invalid');
  const keyMatch = openssl(['pkey', '-in', paths.proxyKey, '-pubout']);
  const certificateKey = openssl(['x509', '-in', paths.proxyCertificate, '-pubkey', '-noout']);
  if (keyMatch !== certificateKey) fail('proxy certificate does not match its private key');
}

function tlsPaths() {
  return {
    caKey: join(tlsDir, 'local-ca.key'), caCertificate: join(tlsDir, 'local-ca.crt'),
    proxyKey: join(tlsDir, 'idx-proxy.local.key'), proxyCertificate: join(tlsDir, 'idx-proxy.local.crt')
  };
}

function openssl(args) {
  const result = spawnSync('openssl', args, { encoding: 'utf8' });
  if (result.status !== 0) fail(`OpenSSL ${args[0]} operation failed`);
  return result.stdout;
}

async function atomicWrite(path, contents, mode) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  if (!process.argv[index + 1]) fail(`${name} requires a value`);
  return process.argv[index + 1];
}

function fail(message) {
  process.stderr.write(`Local Identity Bridge bootstrap failed: ${message}.\n`);
  process.exit(1);
}

#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { calculateJwkThumbprint, exportJWK } from 'jose';
import process from 'node:process';

const require = createRequire(import.meta.url);
let client;
try {
  const { createGatewayPrismaClient } = require(resolve('apps/gateway/dist/integration-registry/gateway-prisma-client.factory.js'));
  const { SigningKeyProvider } = require(resolve('apps/gateway/dist/signing/signing-key-provider.js'));
  const reference = process.env.GATEWAY_SIGNING_KEY_REFERENCE;
  if (!reference) throw new Error();
  const handle = await new SigningKeyProvider().load(reference);
  const jwk = await exportJWK(handle);
  const kid = await calculateJwkThumbprint({ kty: 'RSA', n: jwk.n, e: jwk.e }, 'sha256');
  client = createGatewayPrismaClient(process.env.DATABASE_URL);
  const active = await client.gatewaySigningKey.findFirst({ where: { status: 'active' } });
  const publicJwk = active?.publicJwk;
  const matches = active?.kid === kid && active?.keyReference === reference && publicJwk?.n === jwk.n && publicJwk?.e === jwk.e;
  process.stdout.write(`GATEWAY_SIGNING_AUTHORITY=${matches ? 'ACTIVE' : 'INACTIVE'}\n`);
  process.exitCode = matches ? 0 : 2;
} catch {
  process.stderr.write('GATEWAY_SIGNING_AUTHORITY=UNKNOWN\n');
  process.exitCode = 1;
} finally {
  await client?.$disconnect().catch(() => undefined);
}

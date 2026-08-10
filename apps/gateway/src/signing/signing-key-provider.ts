import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importPKCS8, type KeyLike } from 'jose';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';

/** Loads a signing handle only; raw signing material never leaves this boundary. */
export class SigningKeyProvider {
  async load(reference: string): Promise<KeyLike> {
    try {
      const path = resolveLocalReference(reference);
      const privatePem = await readFile(path, 'utf8');
      return await importPKCS8(privatePem, 'RS256');
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }
}

function resolveLocalReference(reference: string): string {
  if (reference.startsWith('provider://')) throw new IdentityServiceUnavailableError();
  if (reference.startsWith('file:')) return fileURLToPath(new URL(reference));
  if (reference.startsWith('./')) return resolve(process.cwd(), reference);
  throw new IdentityServiceUnavailableError();
}

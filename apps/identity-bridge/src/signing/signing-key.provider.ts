import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { importPKCS8, type KeyLike } from 'jose';

export class BridgeSigningError extends Error {
  constructor() {
    super('Bridge signing failed: bridge_signing_invalid.');
    this.name = 'BridgeSigningError';
  }
}

export class SigningKeyProvider {
  async load(reference: string): Promise<KeyLike> {
    try {
      const url = new URL(reference);
      if (url.protocol !== 'file:' || url.host || url.search || url.hash) throw new Error();
      const pem = (await readFile(url, 'utf8')).trim();
      if (!isUnencryptedPkcs8Pem(pem)) throw new Error();
      const parsedKey = createPrivateKey(pem);
      if (parsedKey.type !== 'private' || parsedKey.asymmetricKeyType !== 'rsa') throw new Error();
      return await importPKCS8(pem, 'RS256');
    } catch {
      throw new BridgeSigningError();
    }
  }
}

function isUnencryptedPkcs8Pem(pem: string): boolean {
  const lines = pem.split(/\r?\n/);
  return lines.length >= 3
    && lines[0] === '-----BEGIN PRIVATE KEY-----'
    && lines.at(-1) === '-----END PRIVATE KEY-----'
    && lines.slice(1, -1).every((line) => /^[A-Za-z0-9+/=]+$/.test(line));
}

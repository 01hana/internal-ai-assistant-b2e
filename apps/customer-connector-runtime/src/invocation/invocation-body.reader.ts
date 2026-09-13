import type { Readable } from 'node:stream';

export type InvocationBodyReadResult = Readonly<{ ok: true; value: Buffer }> |
  Readonly<{ ok: false; code: 'CONNECTOR_REQUEST_INVALID' }>;

export function readBoundedInvocationBody(
  request: Readable,
  maximumBytes: number,
  declaredContentLength?: string
): Promise<InvocationBodyReadResult> {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || invalidDeclaredLength(declaredContentLength, maximumBytes)) {
    request.pause();
    return Promise.resolve(failure());
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onFailure);
      request.removeListener('aborted', onFailure);
    };
    const finish = (result: InvocationBodyReadResult, pause = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pause) request.pause();
      resolve(result);
    };
    const onData = (part: Uint8Array | string) => {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
      if (chunk.byteLength > maximumBytes - total) {
        finish(failure(), true);
        return;
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    };
    const onEnd = () => finish(Object.freeze({ ok: true, value: Buffer.concat(chunks, total) }));
    const onFailure = () => finish(failure(), true);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onFailure);
    request.once('aborted', onFailure);
  });
}

function invalidDeclaredLength(value: string | undefined, maximum: number): boolean {
  if (value === undefined) return false;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return true;
  const parsed = Number(value);
  return !Number.isSafeInteger(parsed) || parsed > maximum;
}

function failure(): InvocationBodyReadResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
}

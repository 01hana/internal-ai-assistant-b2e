import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';

export type ExtractionResult = Readonly<{ ok: true; value: Readonly<Record<string, string | number | boolean>> }> |
  Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_RESPONSE_INVALID'> }>;

export class ManifestResponseExtractor {
  extract(raw: unknown, operation: PreparedManifestOperation, invocationArguments: Readonly<Record<string, unknown>>): ExtractionResult {
    const output: Record<string, string | number | boolean> = {};
    for (const declaration of operation.response.extraction) {
      const source = pointer(raw, declaration.sourcePointer);
      const converted = convert(source, declaration.conversion);
      if (converted === undefined) return failure();
      if (Object.prototype.hasOwnProperty.call(invocationArguments, declaration.targetField) && invocationArguments[declaration.targetField] !== converted) return failure();
      output[declaration.targetField] = converted;
    }
    return Object.freeze({ ok: true, value: Object.freeze(output) });
  }
}

function pointer(value: unknown, path: string): unknown {
  let current = value;
  for (const encoded of path.split('/').slice(1)) {
    if (!current || typeof current !== 'object') return undefined;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function convert(value: unknown, conversion: string): string | number | boolean | undefined {
  if (conversion === 'string') return typeof value === 'string' ? value : undefined;
  if (conversion === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (conversion === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (conversion === 'integer') return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
function failure(): ExtractionResult { return Object.freeze({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' }); }

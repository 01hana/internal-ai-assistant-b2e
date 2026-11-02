import { readFileSync } from 'node:fs';
import { parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import {
  SHINMONE_MANIFEST_PATH,
  SHINMONE_OPERATION_KEY,
  SHINMONE_TODAY_MANIFEST_PATH,
  SHINMONE_TODAY_OPERATION_KEY,
  SHINMONE_WEEKLY_MANIFEST_PATH,
  SHINMONE_WEEKLY_OPERATION_KEY,
  createShinmoneRuntimeIntegration
} from '../../integrations/shinmone';

const periods = [
  [SHINMONE_MANIFEST_PATH, SHINMONE_OPERATION_KEY, 'thisMonth'],
  [SHINMONE_TODAY_MANIFEST_PATH, SHINMONE_TODAY_OPERATION_KEY, 'today'],
  [SHINMONE_WEEKLY_MANIFEST_PATH, SHINMONE_WEEKLY_OPERATION_KEY, 'thisWeek']
] as const;

describe('Shinmone exact new-work-order period manifests', () => {
  it('registers all three exact Customer-local operations', () => {
    expect(createShinmoneRuntimeIntegration().manifestFiles).toEqual(periods.map(([path]) => path));
  });

  it.each(periods)('%s fixes a closed GET and extracts only its canonical result', async (path, key, period) => {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const parsed = parseConnectorOperationManifestV1(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(raw.operations).toHaveLength(1);
    expect(raw.operations[0]).toMatchObject({
      operationKey: key, contractVersion: '1.0.0', readOnly: true,
      inputSchema: { type: 'object', required: [], properties: {}, additionalProperties: false },
      request: { profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats',
        fixedQuery: { TimeRange: period }, argumentMappings: [] }
    });
    expect(JSON.stringify(raw)).not.toMatch(/CompanyCode|CompanyUuid|VendorCode|CompanyCategory|https?:|authorization/i);
    const prepared = new OperationManifestRegistry([parsed.value]).prepare('business', key, '1.0.0', {} as never);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.request).toEqual({
      profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: period }]
    });
    const rawResponse = { Code: 200, Data: { NewOrders: { Current: 17 } } };
    const bounded = await new BoundedJsonResponse().read({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(rawResponse)); } }
    }, prepared.value);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    expect(new ManifestResponseExtractor().extract(bounded.value, prepared.value, {})).toEqual({
      ok: true, value: { metricKey: key, period, count: 17 }
    });
    const wrongCasing = await new BoundedJsonResponse().read({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ Code: 200, Data: { newOrders: { current: 17 } } })); } }
    }, prepared.value);
    expect(wrongCasing).toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });
});

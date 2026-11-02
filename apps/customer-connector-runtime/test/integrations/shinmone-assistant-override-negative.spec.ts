import { readFileSync } from 'node:fs';
import { parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { SHINMONE_MANIFEST_PATH, SHINMONE_OPERATION_KEY } from '../../integrations/shinmone';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';

const parsed = parseConnectorOperationManifestV1(JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8')));
if (!parsed.ok) throw new Error('Existing C01 manifest must parse for trust-negative tests.');
const registry = new OperationManifestRegistry([parsed.value]);

describe('existing Shinmone fixed Connector operation negatives (C01; not C02-C06 provisioning)', () => {
  it.each([
    [{ CompanyCategory: 'SystemCompany' }],
    [{ VendorCode: 'OTHER' }],
    [{ CompanyCode: 'OTHER' }]
  ])('rejects caller-controlled company arguments before an upstream request is prepared: %j', (args) => {
    expect(registry.prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', args as never))
      .toEqual(expect.objectContaining({ ok: false }));
  });

  it('keeps the prepared upstream request limited to the fixed Dashboard period', () => {
    const prepared = registry.prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', {} as never);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.request).toEqual({
      profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: 'thisMonth' }]
    });
  });

  it.each([
    ['wrong count type', 200, { Code: 200, Data: { NewOrders: { Current: '17' } } }],
    ['Customer permission denial', 403, { Code: 403, Data: { NewOrders: { Current: 17 } } }]
  ])('rejects %s without broad-query fallback', async (_label, statusCode, body) => {
    const prepared = registry.prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', {} as never);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const response = await new BoundedJsonResponse().read({
      statusCode, headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } }
    }, prepared.value);
    expect(response.ok).toBe(false);
    expect(prepared.value.request).toEqual({
      profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: 'thisMonth' }]
    });
  });
});

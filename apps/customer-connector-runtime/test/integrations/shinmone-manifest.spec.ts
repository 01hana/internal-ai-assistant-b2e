import { readFileSync } from 'node:fs';
import { parseConnectorOperationManifestV1, parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import {
  SHINMONE_CREDENTIAL_PROFILE_REF,
  SHINMONE_MANIFEST_PATH,
  SHINMONE_OPERATION_KEY
} from '../../integrations/shinmone';

describe('removable Shinmone monthly new-work-order manifest', () => {
  it('loads one exact closed GET_QUERY_V1 operation with no origin or dynamic request surface', () => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    const parsed = parseConnectorOperationManifestV1(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      version: '1', connectorKey: 'business', operations: [expect.objectContaining({
        operationKey: SHINMONE_OPERATION_KEY, contractVersion: '1.0.0', readOnly: true,
        upstreamServiceRef: 'shinmone-scm-api', credentialProfileRef: SHINMONE_CREDENTIAL_PROFILE_REF,
        request: {
          profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats',
          fixedQuery: [{ name: 'TimeRange', value: 'thisMonth' }], argumentMappings: []
        },
        limits: expect.objectContaining({ maxRequestBytes: 4096, maxResponseBytes: 262144, timeoutMs: 3500 })
      })]
    });
    expect(JSON.stringify(raw)).not.toMatch(/https?:|authorization|nativeAccessToken|acceptedEntry|header|callback|script|body/i);
  });

  it('maps no caller arguments and extracts only the bounded metric, period, and count fields', () => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    const parsed = parseConnectorOperationManifestV1(raw);
    if (!parsed.ok) throw new Error('fixture manifest');
    const registry = new OperationManifestRegistry([parsed.value]);
    const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
      version: '1', requestId: 'req-shinmone-manifest', remainingBudgetMs: 4500,
      trustedContext: {
        customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared',
        connectorKey: 'business', connectorInstanceId: 'shinmone-scm-connector-1'
      },
      operation: { key: SHINMONE_OPERATION_KEY, version: '1.0.0', arguments: {} },
      connectorContextRef: `ccr_${'A'.repeat(43)}`
    })));
    if (!invocation.ok) throw new Error('fixture invocation');
    const prepared = registry.prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', invocation.value.operation.arguments);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.request).toEqual({ profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: 'thisMonth' }] });
    expect(new ManifestResponseExtractor().extract({
      code: 200, metricKey: SHINMONE_OPERATION_KEY, period: 'thisMonth', data: { newOrders: { current: 17, rawSecret: 'not-released' } }
    }, prepared.value, {})).toEqual({
      ok: true, value: { metricKey: SHINMONE_OPERATION_KEY, period: 'thisMonth', count: 17 }
    });
  });

  it.each([
    { method: 'POST' }, { url: 'https://attacker.invalid' }, { headers: { Authorization: 'x' } },
    { body: { arbitrary: true } }
  ])('rejects caller or manifest request overrides %#', (override) => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    raw.operations[0] = { ...raw.operations[0], ...override };
    expect(parseConnectorOperationManifestV1(raw).ok).toBe(false);
  });
});

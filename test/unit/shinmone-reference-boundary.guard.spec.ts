import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Shinmone reference integration boundary', () => {
  it('keeps reference-specific credential, route, result, and identity assumptions out of generic orchestration', () => {
    const genericFiles = [
      'src/connectors/productized-business/productized-business-connector.adapter.ts',
      'src/connectors/productized-business/productized-business-connector.module.ts',
      'src/connectors/productized-business/connector-deployment.registry.ts',
      'src/tools/tool-discovery.service.ts',
      'src/query-understanding/rule-based-query-understanding.pipeline.ts',
      'apps/customer-connector-runtime/src/bindings/connector-binding-request.service.ts',
      'apps/customer-connector-runtime/src/credentials/credential-execution.boundary.ts',
      'apps/customer-connector-runtime/src/invocation/connector-invocation.service.ts',
      'apps/customer-connector-runtime/src/manifest/operation-manifest.registry.ts',
      'apps/customer-connector-runtime/src/upstream/upstream-execution.service.ts'
    ];
    for (const file of genericFiles) {
      expect(readFileSync(resolve(file), 'utf8')).not.toMatch(
        /shinmone|Dashboard\/KPIStats|newOrders|acceptedEntry|nativeAccessToken|BRIDGE_BINDING_TRANSPORT_V1|這個月新增幾張工單/i
      );
    }
  });

  it('keeps reference material in the explicit integration, seed/configuration, and fixture surfaces', () => {
    expect(readFileSync(resolve('apps/customer-connector-runtime/integrations/shinmone/shinmone-idx-credential.provider.ts'), 'utf8'))
      .toMatch(/nativeAccessToken|acceptedEntry|decodeJwt/);
    expect(readFileSync(resolve('apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json'), 'utf8'))
      .toMatch(/Dashboard\/KPIStats|newOrders/);
    expect(readFileSync(resolve('scripts/seed.ts'), 'utf8'))
      .toMatch(/work-orders\.monthly-new-count/);
  });
});

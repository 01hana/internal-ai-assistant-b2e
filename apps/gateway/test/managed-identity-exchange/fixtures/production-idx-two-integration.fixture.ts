type SideName = 'a' | 'b';

/** Synthetic server-provisioned data for two independent IDX integrations. */
export function createProductionIdxTwoIntegrationFixture() {
  const a = side({
    name: 'a', endpointUri: 'https://idx-a.example.test/menu-detail', menuId: 'FIXTURE_ORDERS', enabledAction: 'Update',
    subject: 'fixture-user-a', company: 'fixture-company-a', entry: 'fixture-entry-a'
  });
  const b = side({
    name: 'b', endpointUri: 'https://idx-b.example.test/menu-detail', menuId: 'FIXTURE_INVENTORY', enabledAction: 'Export',
    subject: 'fixture-user-b', company: 'fixture-company-b', entry: 'fixture-entry-b'
  });
  return Object.freeze({ a, b });
}

function side(input: Readonly<{
  name: SideName; endpointUri: string; menuId: string; enabledAction: 'Update' | 'Export';
  subject: string; company: string; entry: string;
}>) {
  const suffix = input.name;
  const providerId = `fixture-provider-idx-${suffix}`;
  const configId = `fixture-config-idx-${suffix}`;
  const integrationId = `fixture-integration-idx-${suffix}`;
  const claims = Object.freeze({ sub: input.subject, UUID_User: input.subject, UUID_Company: input.company, UUID_Entry: input.entry });
  const operations = { Insert: 'N', Update: 'N', Delete: 'N', Print: 'N', Import: 'N', Export: 'N', Copy: 'N', Approval: 'N', [input.enabledAction]: 'Y' };
  const action = input.enabledAction.toLowerCase();

  return Object.freeze({
    name: input.name,
    provider: Object.freeze({
      id: providerId, providerType: 'idx_delegated', endpointUri: input.endpointUri, httpMethod: 'GET',
      credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'idx-menu-detail/v1',
      contractConfig: Object.freeze({ responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' }),
      declaredAnchorKinds: Object.freeze(['idx_entry']), enabled: true, lifecycle: 'active', version: 1, replacesProviderId: null
    }),
    config: Object.freeze({
      id: configId, publicSelector: `fixture-selector-idx-${suffix}`, integrationId, providerInstanceId: providerId,
      canonicalHostApp: 'fixture-assistant', organizationMode: 'verified', fixedOrganizationId: null,
      enabled: true, lifecycle: 'active', version: 1, replacesConfigId: null
    }),
    admission: Object.freeze({
      id: `fixture-admission-idx-${suffix}`, integrationConfigId: configId,
      anchorRequirements: Object.freeze([Object.freeze({ kind: 'idx_entry', allowedValues: Object.freeze([input.entry]) })]),
      enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null
    }),
    permission: Object.freeze({
      id: `fixture-permission-idx-${suffix}`, integrationConfigId: configId, mode: 'provider_trusted', permissionSourceInstanceId: null,
      normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1',
      projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }),
      enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null
    }),
    credential: compact(claims),
    claims,
    menuDetail: menuDetail(suffix, input.menuId, operations),
    expectedScopes: Object.freeze([`menu:${input.menuId}:read`, `menu:${input.menuId}:${action}`])
  });
}

function compact(claims: Readonly<Record<string, unknown>>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES512', typ: 'JWT' }), 'utf8').toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${payload}.fixture-signature`;
}

function menuDetail(suffix: SideName, menuId: string, operations: Readonly<Record<string, string>>) {
  const menuUuid = `fixture-menu-${suffix}`;
  return Object.freeze({
    Code: 200, ExecutionTime: '1ms', Message: '', Version: 'fixture-v1',
    Data: Object.freeze([Object.freeze({
      UUID: menuUuid, MenuID: menuId, Category: 'fixture-category', Patrilineal: null, Sorting: '1', Memo: 'fixture-menu',
      MenuNode: Object.freeze([Object.freeze({
        UUID: `fixture-node-${suffix}`, UUID_Menu: menuUuid, Language: 'fixture-language', MenuName: `Fixture ${suffix.toUpperCase()}`,
        Icon: 'fixture-icon', ProgramCode: null, ProgramPath: `/fixture/${suffix}`, StartMethod: null, Memo: 'fixture-node'
      })]),
      MenuPermission: Object.freeze({
        UUID: `fixture-permission-record-${suffix}`, UUID_Menu: menuUuid, ...operations, Others: null, Memo: 'fixture-permission'
      })
    })])
  });
}

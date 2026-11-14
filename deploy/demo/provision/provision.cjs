'use strict';
// 正式資料初始化：在 Gateway image 內執行，沿用 Gateway 自己的 provision 指令與驗證器。
// 原則：先讀取既有資料比對，完全相同就略過；任何不同一律停止，不自動 update / disable / delete。
// 用法（由 deploy.sh 呼叫）：node /provision/provision.cjs check|prepare|activate-key
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const D = '/repo/apps/gateway/dist/';
const req = (p) => require(D + p);

const plan = JSON.parse(process.env.PROVISION_PLAN_JSON || 'null');
if (!plan || !plan.context || !plan.bridgeIdentity || !plan.gatewayInternal) fatal('缺少 PROVISION_PLAN_JSON');
const C = plan.context;
const PROFILE_ID = `trust-${C.integrationId}-v1`;
const GW_KID = plan.gatewayInternal.kid;
const GW_KEY_REF = 'file:///run/secrets/gateway_signing_key';
const GW_JWKS = 'http://gateway:4000/.well-known/jwks.json';
const catalog = JSON.parse(readFileSync('/provision/tool-catalog.json', 'utf8')).tools;

const ok = (m) => console.log(`✓ ${m}`);
const skip = (m) => console.log(`· ${m}（已存在且相同，略過）`);
function fatal(m) { console.error(`✗ ${m}`); process.exit(1); }
const rid = (step) => `deploy-provision:${step}:${randomUUID()}`;

async function main() {
  const mode = process.argv[2];
  if (!['check', 'prepare', 'activate-key'].includes(mode)) fatal('mode 必須是 check / prepare / activate-key');
  if (process.env.GATEWAY_SIGNING_KEY_REFERENCE !== GW_KEY_REF) fatal('gateway.env 的 GATEWAY_SIGNING_KEY_REFERENCE 不符');

  const { createGatewayPrismaClient } = req('integration-registry/gateway-prisma-client.factory.js');
  const db = createGatewayPrismaClient(process.env.DATABASE_URL);
  try {
    if (mode === 'activate-key') return await activateKey(db);
    const s = await readState(db);
    report(s);
    if (mode === 'check') return;
    await prepare(db, s);
  } finally { await db.$disconnect(); }
}

async function readState(db) {
  const { TrustProfileRepository } = req('integration-registry/trust-profile.repository.js');
  const [customer, binding, otherBindings, profiles, key, active, tools] = await Promise.all([
    db.customer.findUnique({ where: { id: C.customerId } }),
    db.integrationBinding.findUnique({ where: { integrationId: C.integrationId } }),
    db.integrationBinding.findMany({ where: { customerId: C.customerId, NOT: { integrationId: C.integrationId } } }),
    new TrustProfileRepository(db).findByIntegrationId(C.integrationId),
    db.gatewaySigningKey.findUnique({ where: { kid: GW_KID } }),
    db.gatewaySigningKey.findFirst({ where: { status: 'active' } }),
    db.toolDefinition.findMany({ where: { name: { in: catalog.map((t) => t.name) } },
      include: { customerPolicies: { where: { customerId: C.customerId } } } })
  ]);
  return { customer, binding, otherBindings, profiles: [...profiles], key, active, tools };
}

function report(s) {
  console.log(`Customer            ${s.customer ? '已存在' : '尚未建立'}`);
  console.log(`IntegrationBinding  ${s.binding ? `已存在（customer=${s.binding.customerId}, hostApp=${s.binding.allowedHostApp}, enabled=${s.binding.enabled}）` : '尚未建立'}`);
  console.log(`TrustProfile        ${s.profiles.length ? s.profiles.map((p) => `${p.id} v${p.version} ${p.lifecycle}/${p.enabled}`).join(', ') : '尚未建立'}`);
  console.log(`Gateway 簽章金鑰     ${s.key ? s.key.status : '尚未註冊'}${s.active && s.active.kid !== GW_KID ? `（另有其他 active 金鑰 ${s.active.kid}）` : ''}`);
  console.log(`ToolDefinition      ${s.tools.length}/3 已存在；啟用中的 Customer 政策 ${s.tools.filter((t) => t.customerPolicies[0]?.enabled).length}/3`);
}

async function prepare(db, s) {
  // ---- 衝突檢查（全部先檢查，再開始寫入）----
  const conflicts = [];
  if (s.binding && (s.binding.customerId !== C.customerId || s.binding.allowedHostApp !== C.hostApp || s.binding.enabled !== true)) conflicts.push('IntegrationBinding 內容不同');
  if (s.otherBindings.length) conflicts.push('同一 Customer 已有其他 IntegrationBinding');
  const wantProfile = { id: PROFILE_ID, integrationId: C.integrationId, expectedIssuer: plan.bridgeIdentity.issuer,
    expectedAudience: plan.bridgeIdentity.audience, jwksUri: plan.bridgeIdentity.jwks, algorithm: 'RS256',
    enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null };
  for (const p of s.profiles) if (Object.keys(wantProfile).some((k) => (p[k] ?? null) !== wantProfile[k])) conflicts.push(`TrustProfile ${p.id} 內容不同`);
  if (s.key && (s.key.keyReference !== GW_KEY_REF || s.key.publicJwk?.kid !== GW_KID)) conflicts.push('Gateway 簽章金鑰內容不同');
  if (s.active && s.active.kid !== GW_KID) conflicts.push('資料庫已有另一把 active 的 Gateway 簽章金鑰');
  for (const t of s.tools) {
    const want = catalog.find((c) => c.name === t.name && c.version === t.version);
    if (!want) { conflicts.push(`ToolDefinition ${t.name}@${t.version} 不在預期清單`); continue; }
    for (const k of ['description', 'resource', 'operation', 'riskLevel', 'hasSideEffect', 'requiresConfirmation', 'requiresApproval', 'connectorKey', 'timeoutMs', 'inputSchema', 'outputSchema', 'requiredPermissions'])
      if (!isDeepStrictEqual(t[k], want[k])) conflicts.push(`ToolDefinition ${t.name} 的 ${k} 不同`);
    if (!t.isActive) conflicts.push(`ToolDefinition ${t.name} 不是啟用狀態`);
    const pol = t.customerPolicies[0];
    if (pol && (!pol.enabled || pol.requiredRoles.length || pol.requiredPermissionScopes.length)) conflicts.push(`${t.name} 的 Customer 政策內容不同`);
  }
  if (conflicts.length) { conflicts.forEach((c) => console.error(`✗ 衝突：${c}`)); fatal('發現與既有資料不一致，未做任何寫入。請把以上訊息回報。'); }

  // ---- Bridge JWKS 必須可從公開網址取得（TrustProfile 的前提）----
  const { HardenedJwksTransport } = req('upstream-auth/jwks-transport.adapter.js');
  const { ProductionJwksSourceRegistrationPolicy } = req('integration-registry/trust-profile-activation.validator.js');
  const policy = new ProductionJwksSourceRegistrationPolicy();
  try { policy.validate(plan.bridgeIdentity.jwks); } catch { fatal(`JWKS 網址不符合正式政策：${plan.bridgeIdentity.jwks}`); }
  let jwks;
  try { jwks = await new HardenedJwksTransport().fetch(plan.bridgeIdentity.jwks); } catch { fatal(`無法從 ${plan.bridgeIdentity.jwks} 取得 Bridge JWKS（Bridge 是否已啟動？Nginx 路由是否生效？）`); }
  if (!jwks?.keys?.some((k) => k.kid === plan.bridgeIdentity.kid)) fatal('公開 JWKS 裡找不到目前 Bridge 金鑰的 kid');
  ok('公開 Bridge JWKS 可取得，kid 相符');

  // ---- Customer / IntegrationBinding / TrustProfile ----
  if (s.customer) skip('Customer'); else { await db.customer.create({ data: { id: C.customerId } }); ok(`Customer ${C.customerId}`); }

  const { IntegrationBindingRepository } = req('integration-registry/integration-binding.repository.js');
  const { ProvisionIntegrationBindingCommand, ProvisionIntegrationBindingService } = req('commands/provision-integration-binding.js');
  if (s.binding) skip('IntegrationBinding');
  else {
    await new ProvisionIntegrationBindingCommand(new ProvisionIntegrationBindingService(new IntegrationBindingRepository(db)))
      .execute({ customerId: C.customerId, integrationId: C.integrationId, allowedHostApp: C.hostApp, enabled: true, requestId: rid('binding') });
    ok(`IntegrationBinding ${C.integrationId}`);
  }

  const { TrustProfileRepository } = req('integration-registry/trust-profile.repository.js');
  const { TrustProfileActivationValidator } = req('integration-registry/trust-profile-activation.validator.js');
  const { ProvisionTrustProfileCommand } = req('commands/provision-trust-profile.js');
  const { GatewayIdentityAuditWriter } = req('audit/gateway-identity-audit.writer.js');
  const { TrustProfileRuntimeReadiness } = req('integration-registry/trust-profile-runtime-readiness.service.js');
  const profileRepo = new TrustProfileRepository(db);
  if (s.profiles.length) skip('TrustProfile');
  else {
    await new ProvisionTrustProfileCommand({ repository: profileRepo,
      validator: new TrustProfileActivationValidator({ repository: profileRepo, jwksSourcePolicy: policy }),
      auditWriter: new GatewayIdentityAuditWriter(db), invalidation: { invalidate: async () => undefined } })
      .execute({ action: 'create', ...wantProfile, requestId: rid('trust-profile') });
    ok(`TrustProfile ${PROFILE_ID}（active）`);
  }
  await new TrustProfileRuntimeReadiness(profileRepo).assertReady();
  ok('Gateway TrustProfile readiness 通過');

  // ---- Gateway 簽章金鑰：註冊 → published（active 要等 Gateway 啟動後由 activate-key 完成）----
  const { lifecycle } = signing(db);
  if (!s.key) {
    const { RegisterSigningKeyCommand } = req('commands/register-signing-key.js');
    await new RegisterSigningKeyCommand(lifecycle).execute({ kid: GW_KID, keyReference: GW_KEY_REF, requestId: rid('key-register') });
    ok('Gateway 簽章金鑰已註冊');
  }
  const key = await db.gatewaySigningKey.findUnique({ where: { kid: GW_KID } });
  if (key.status === 'new') { await lifecycle.transition({ kid: GW_KID, to: 'published', requestId: rid('key-publish') }); ok('Gateway 簽章金鑰 → published'); }
  else skip(`Gateway 簽章金鑰（${key.status}）`);

  // ---- ToolDefinition + CustomerToolPolicy（KPIStats 三個唯讀工具）----
  for (const t of catalog) {
    let def = s.tools.find((x) => x.name === t.name && x.version === t.version);
    if (!def) {
      def = await db.toolDefinition.create({ data: { name: t.name, version: t.version, description: t.description, resource: t.resource,
        operation: t.operation, inputSchema: t.inputSchema, outputSchema: t.outputSchema, requiredPermissions: t.requiredPermissions,
        riskLevel: t.riskLevel, hasSideEffect: false, requiresConfirmation: false, requiresApproval: false,
        connectorKey: t.connectorKey, timeoutMs: t.timeoutMs, isActive: true } });
      ok(`ToolDefinition ${t.name}`);
    } else skip(`ToolDefinition ${t.name}`);
    if (def.customerPolicies?.[0]) skip(`Customer 政策 ${t.name}`);
    else {
      await db.customerToolPolicy.create({ data: { customerId: C.customerId, toolDefinitionId: def.id, enabled: true, requiredRoles: [], requiredPermissionScopes: [] } });
      ok(`Customer 政策 ${t.name}（enabled）`);
    }
  }
  console.log('\n資料初始化完成。下一步：./deploy.sh app <compose.env>');
}

function signing(db) {
  const { GatewaySigningKeyRepository } = req('signing/gateway-signing-key.repository.js');
  const { SigningKeyProvider } = req('signing/signing-key-provider.js');
  const { KeyLifecycleService } = req('signing/key-lifecycle.service.js');
  const { KeyRetirementPolicy } = req('signing/key-retirement-policy.js');
  const repository = new GatewaySigningKeyRepository(db);
  const retirementPolicy = new KeyRetirementPolicy({ finalOldTokenLifetimeSeconds: 300, backendClockToleranceSeconds: 300,
    remoteJwksCacheSeconds: 600, remoteJwksCooldownSeconds: 30, propagationMarginSeconds: 60, enforcedMinimumOverlapSeconds: 1500, httpCacheControlSeconds: 60 });
  const lifecycle = new KeyLifecycleService({ repository, signingKeyProvider: new SigningKeyProvider(), retirementPolicy, now: () => new Date() });
  return { repository, lifecycle, retirementPolicy };
}

async function activateKey(db) {
  const key = await db.gatewaySigningKey.findUnique({ where: { kid: GW_KID } });
  if (!key) fatal('Gateway 簽章金鑰尚未註冊，請先執行 ./deploy.sh provision');
  if (key.status === 'active') { skip('Gateway 簽章金鑰已是 active'); return; }
  if (key.status !== 'published') fatal(`Gateway 簽章金鑰狀態是 ${key.status}，無法啟用`);
  const { repository, lifecycle, retirementPolicy } = signing(db);
  const { KeyRotationService } = req('signing/key-rotation.service.js');
  const { LocalJwksPropagationVerifier } = req('signing/local-jwks-propagation-verifier.js');
  const { GatewayIdentityAuditWriter } = req('audit/gateway-identity-audit.writer.js');
  // 啟用前確認執行中的 Gateway 已經在 JWKS 公開這把金鑰（Core 驗證 token 時會用到）
  const verifier = new LocalJwksPropagationVerifier({ publicJwksUrl: GW_JWKS, fetch: (u) => fetch(u) });
  await new KeyRotationService({ repository, lifecycle, retirementPolicy, propagationVerifier: verifier,
    compensationAuditWriter: new GatewayIdentityAuditWriter(db), now: () => new Date() })
    .activatePublished({ kid: GW_KID, requestId: rid('key-activate') });
  const { ActiveSigningKeyResolver } = req('signing/active-signing-key-resolver.js');
  await new ActiveSigningKeyResolver(repository, new (req('signing/signing-key-provider.js').SigningKeyProvider)()).resolveActiveSigningKey();
  ok('Gateway 簽章金鑰 → active（JWKS 已確認）');
}

main().catch((e) => fatal(`執行失敗：${e && e.constructor ? e.constructor.name : 'Error'}${e && e.category ? ` (${e.category})` : ''}`));

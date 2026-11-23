# Design: Feature 016 — Admin Experience Config

**Spec**: [`spec.md`](./spec.md)　**Plan**: [`plan.md`](./plan.md)

## 0. Reuse Inventory

| 需要 | 沿用 |
| --- | --- |
| 登入、權限、路由宣告、CSRF、錯誤格式、列表 | 014／015 的 guard、`@RequirePermission`、`GlobalExceptionFilter`（`details`）、`common/table-query.dto.ts` |
| 後台稽核、開發工程師遮蔽 | `UserAuditService.record`、`audit/audit-actor.ts` |
| payload 結構驗證 | `assistant-experience.parser.ts`（`parseAssistantExperiencePayload`、`EXPERIENCE_LIMITS`） |
| Pack 交叉驗證 | `assistant-experience.validator.ts`（`CapabilityCatalogRegistry`、`CapabilityBindingResolverService`） |
| 版本表、checksum、單一 active | `assistant-experience.repository.ts`（`experienceChecksum`、`activeSlot`） |
| Pack 載入 | `CapabilityPackLoader.loadAndInstall`（與 Core 相同的環境變數格式） |
| 版本號比較與遞增 | `semver`（`rsort`、`inc(v, 'patch')`）；目前只是間接相依，改為直接相依 |

## D1. 程式結構

```
src/assistant-experience/
  assistant-experience.types.ts        + DEFAULT_ASSISTANT_GREETING、ExperienceConfigSource
  assistant-experience.repository.ts   activate（指令，upsert）、saveVersion（後台，只新增）、reactivate、listVersionNumbers、findVersionForReview；nextExperienceVersion
  provision-assistant-experience.*     ADMIN_MANAGED、--force
src/admin/experience-config/
  experience-validation.module.ts      後台專用：Pack 載入（OnApplicationBootstrap）、目錄、binding 解析、Tool 註冊表、parser／validator／repository
  experience-configs.controller.ts     路由（見 spec API 一覽）
  experience-configs.service.ts        整合、讀取、儲存、回復、版本列表
  experience-catalog.ts                由 ScopedCapabilityCatalogV1 組出能力目錄（多個 hostApp 取交集）
  experience-configs.dto.ts            編輯內容（只做型別與最外層形狀；欄位規則交給 parser）
```

`AdminModule` 註冊 `ExperienceConfigModule`。`ExperienceValidationModule` 不 import Core 的 `CapabilitiesModule`、`AssistantExperienceModule`（它們會帶入語意解析、稽核、`AvailableCapabilityService`），只列出需要的 provider。

## D2. 架構邊界

架構測試（`test/architecture/admin-boundary.guard.spec.ts`）由「整個模組禁止」改為「整個模組禁止，但逐檔放行」：

| 放行的檔案 | 用途 |
| --- | --- |
| `assistant-experience/assistant-experience.{types,parser,validator,repository}.ts` | 驗證與版本表 |
| `capabilities/capability-{catalog.registry,pack.loader,pack.types,binding-resolver.service}.ts` | Pack 載入與 binding 解析 |
| `tools/{tool-registry.service,customer-tool-policy.service}.ts` | binding 解析需要的 Tool 註冊表 |

另加一條測試：從放行的檔案沿相對 import 走訪，不得到達 `assistant`、`llm`、`query-understanding`、`query-scope`、`retrieval`、`connectors`、`evidence`、`approvals`、`feedback`。實作時若放行檔案的相依超出上表，先調整 Core 檔案的相依（例如把型別移到 `*.types.ts`），不擴大放行。

## D3. 讀取

- **整合**：`IntegrationBinding`（`customerId = ADMIN_CUSTOMER_ID`、`enabled`）。`hostApps` 取 active 版本的 `hostApps`，沒有設定時為 `[allowedHostApp]`。`getIntegration(integrationId)` 不符合 → 404，供每支路由共用。
- **目前設定**：`repository.findActive`；回傳可編輯欄位與版本資訊，`createdBy` 以 `createdByUserId` 查後台 `User`，經 `audit-actor.ts` 遮蔽開發工程師。
- **能力目錄**：對每個 `hostApp` 呼叫 `registry.resolveCatalog`，任一沒有 Pack → `available: false`；能力取各 Pack 都 active 的 `capabilityKey` 交集，參數以第一個 Pack 的定義為準（交集中的參數名稱與 enum 值也取交集），`label` 為 `safeLabel`，enum 值附 `aliases`。

## D4. 儲存

```
save(principal, integrationId, input):
  integration = getIntegration(integrationId)
  active      = repository.findActive(...)
  if input.baseConfigVersion !== (active?.configVersion ?? null) → 409 EXPERIENCE_CONFIG_CHANGED
  draft = {
    version: '1', customerId, integrationId,
    hostApps: active?.payload.hostApps ?? [integration.allowedHostApp],
    locale:   active?.payload.locale   ?? 'zh-TW',
    semanticReviewStatus: 'HUMAN_VERIFIED',
    configVersion: repository.nextVersion(...),
    ...input（含自動補上的 id）
  }
  parsed = parse(draft)；errors → 422
  errors = validator.validate(parsed)；errors → 422
  if checksum(parsed 不含 configVersion) === checksum(active 不含 configVersion) → { unchanged: true }
  transaction:
    確認 active 仍為 baseConfigVersion（以 activeSlot 讀取），否則 409
    repository.saveVersion(parsed, checksum, { source: 'admin', createdByUserId }, { expectedActiveVersion, afterActivate: 寫稽核 })
  唯一鍵衝突（P2002）→ 409
```

- 比較「內容是否相同」時排除 `configVersion`，避免只因版本號不同就產生新版本。
- `validate` 路由執行到 validator 為止。
- 稽核與啟用在同一交易：稽核寫入失敗則整筆不生效。

## D5. 回復

`reactivate(versionId, origin)`：交易中確認 `baseConfigVersion`，將原 active 改 retired、目標改 active（`activatedAt` 更新，`source`／`createdByUserId` 保留原值），寫入 `admin_experience_config_activated`（`fromVersion`、`toVersion`）。目標版本先經 parser（`toStored` 為 null → 422 `EXPERIENCE_CONFIG_UNREADABLE`）與 validator。

## D6. Provisioning 指令

`ProvisionAssistantExperienceCommand.execute(input, { checkOnly, allowUnverified, force })`：在 `findActive` 之後、`activate` 之前，若 `active.source === 'admin'` 且 `active.configVersion !== payload.configVersion` 且非 `force` → `ADMIN_MANAGED`。寫入時 `source: 'provisioning'`、`createdByUserId: null`。

## D7. Migration

`20261122000000_feature016_experience_config_source`：

```sql
CREATE TYPE "AssistantExperienceConfigSource" AS ENUM ('provisioning', 'admin');
ALTER TABLE "AssistantExperienceConfig"
  ADD COLUMN "source" "AssistantExperienceConfigSource" NOT NULL DEFAULT 'provisioning',
  ADD COLUMN "createdByUserId" TEXT;
```

不建立外鍵：版本表屬 Core，後台使用者表屬後台；顯示時由後台查詢。hash 登記於 `test/fixtures/migration-ledger.json`。

## D8. 部署

- `deploy/demo/config/admin.env.example`：`ASSISTANT_CAPABILITY_PACK_PATHS_JSON`（與 core 相同的值）。
- `deploy/demo/compose.yaml`：admin-api 掛載 `${DEMO_CAPABILITY_PACK_DIR}:/app/customer-capability-packs:ro`；`host-config.sh` 產生 admin.env 時寫入相同的值。
- 後台 process 啟動時載入 Pack 失敗 → 啟動失敗（與 Core 一致，fail closed）。

## D9. 測試

- DB 測試 `test/integration/admin-experience-config.spec.ts`：權限矩陣、客戶隔離、讀取、能力目錄、儲存（版本遞增、retired、稽核、unchanged、422、409 與同時儲存）、版本列表與回復、儲存後 Core `AssistantExperienceService` 讀到新版本。
- 單元測試：`experience-catalog.ts`（多 hostApp 交集）、版本遞增、id 產生、指令 `ADMIN_MANAGED`／`--force`。
- 架構測試：D2。

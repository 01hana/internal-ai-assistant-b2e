# Tasks: Feature 016 — Admin Experience Config

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 進行中（spec 已審核 2026-11-22）

## Phase 0 — 基線與共用

- [x] T001 `specs/README.md` 登記 016；`.specify/feature.json` 指向 016。
- [x] T002 Migration `20261122000000_feature016_experience_config_source`（`source`、`createdByUserId`）、schema、ledger。
- [x] T003 Core：`DEFAULT_ASSISTANT_GREETING` 移到 types；repository `saveVersion`、`reactivate`（樂觀鎖、同交易稽核）、`listVersionNumbers`、`findVersionForReview`、`nextExperienceVersion`（`semver`）；013 測試照常通過。
- [x] T004 後台：`ExperienceConfig` 權限移除 `create`；`ExperienceValidationModule`（載入 Pack）、`ASSISTANT_CAPABILITY_PACK_PATHS_JSON` 環境驗證、`AuditTarget` 與事件類型 `admin_experience_config_saved`／`admin_experience_config_activated`（含標籤）；架構測試改為逐檔放行並加相依走訪。
- [x] T005 **Gate 0**：使用者 `npx prisma generate`、migrate（本機與測試資料庫）、ledger 與架構測試、typecheck、013 與後台既有測試。`FEATURE016_GATE_0=PASS`。

**Phase 0 執行證據（2026-11-22）**：

- T001：`specs/README.md` 登記 016；`.specify/feature.json` 指向 016。
- T002：migration `20261122000000_feature016_experience_config_source`（enum `AssistantExperienceConfigSource`、`source` 預設 `provisioning`、`createdByUserId TEXT`，不建外鍵），schema 與 ledger 已登記。
- T003：`DEFAULT_ASSISTANT_GREETING` 移到 `assistant-experience.types.ts`（service 重新匯出）。repository：`activate`（指令，upsert，可傳 origin）、`saveVersion`（後台，只新增，重複版本號 → 衝突）、`reactivate`；兩者以 `ExperienceActivationGuard`（`expectedActiveVersion`、同交易的 `afterActivate`）做樂觀鎖與稽核，P2002 轉為 `ExperienceConfigChangedError`。`findVersionForReview` 回傳無法解析的版本（`payload: null`、`errors`）。`nextExperienceVersion` 以 `semver` 比較與遞增。測試：persistence（來源、回復、樂觀鎖、稽核失敗回滾、同時儲存）、`assistant-experience-version.spec.ts`。
- T004：`ExperienceConfig` 權限改為 `read`、`update`（`ExperienceConfig:create` 由權限解析忽略，單元測試涵蓋）。後台環境變數 `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`（預設 `[]`，JSON 字串陣列驗證抽到 `common/config/json-string-array.ts` 與 Core 共用）。`experience-config/experience-validation.module.ts` 只列出驗證所需的 provider，啟動時載入 Pack。稽核事件 `admin_experience_config_saved`／`admin_experience_config_activated`（含標籤）、`AuditTarget` 新增 `ExperienceConfig`。架構測試改為沿相對 import 走訪後台實際載入的檔案（略過 `import type`），禁止的模組只放行列出的 13 個檔案，並檢查清單沒有多餘項目。VM：eslint 通過；typecheck 只剩需要 `prisma generate` 與 `@types/semver` 的錯誤。

## Phase 1 — 讀取與儲存

- [ ] T006 `experienceConfigs/getIntegrations`、`GET :integrationId`、`:integrationId/catalog`（`experience-catalog.ts`）。
- [ ] T007 `POST :integrationId/validate`、`POST :integrationId`（組 payload、id 產生、版本遞增、unchanged、樂觀鎖、交易內稽核）。
- [ ] T008 測試：權限矩陣、客戶隔離、目錄交集、儲存各情境（422、409、同時儲存、unchanged）、儲存後 Core service 讀到新版本；單元測試（目錄、版本、id）。
- [ ] T009 **Gate 1**：Phase 1 測試、typecheck、lint。`FEATURE016_GATE_1=PASS`。

## Phase 2 — 版本、指令、文件

- [ ] T010 `versions/getTable`、`versions/:configVersion`、`versions/:configVersion/activate`。
- [ ] T011 Provisioning 指令：`ADMIN_MANAGED`、`--force`、`source: provisioning`；指令測試。Core `EXPERIENCE_CHOICE_UNAVAILABLE`（US5-4）與 SDK 處理（US5-5，`internal-ai-assistant` main）。
- [ ] T012 文件：`docs/frontend-integration/admin-api.md`（體驗設定 API、錯誤碼）、`docs/architecture/admin-back-office.md`、`docs/architecture/assistant-conversation-experience.md`（後台優先）。
- [ ] T013 部署：`admin.env.example`、`compose.yaml` 掛載 Pack、`host-config.sh`。
- [ ] T014 **Gate 2**：全套測試、typecheck、lint；本機以 Swagger 儲存、回復並在 Assistant 確認生效。`FEATURE016_GATE_2=PASS`。

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

- T005 Gate 0（使用者於 Mac，2026-11-22）：`npm install semver`、`@types/semver`、`prisma generate`、本機與測試資料庫 migrate、typecheck、lint、架構與單元測試、persistence 與後台 DB 測試（9 個檔案 102 tests）通過。首次執行 `admin-mail.spec.ts` 失敗：新版 Node 的 ICU 在 `Intl.DateTimeFormat.format()` 的日期與時間之間放入 U+2009，與預期字串不同（014 既有問題）；改為以 `formatToParts` 組成 `yyyy/MM/dd HH:mm`，時區改用 `ADMIN_TIME_ZONE`（原本寫死台北），重跑通過。`FEATURE016_GATE_0=PASS`。

## Phase 1 — 讀取與儲存

- [x] T006 `experienceConfigs/getIntegrations`、`GET :integrationId`、`:integrationId/catalog`（`experience-catalog.ts`）。
- [x] T007 `POST :integrationId/validate`、`POST :integrationId`（組 payload、id 產生、版本遞增、unchanged、樂觀鎖、交易內稽核）。
- [x] T008 測試：權限矩陣、客戶隔離、目錄交集、儲存各情境（422、409、同時儲存、unchanged）、儲存後 Core service 讀到新版本；單元測試（目錄、版本、id）。
- [x] T009 **Gate 1**：Phase 1 測試、typecheck、lint。`FEATURE016_GATE_1=PASS`。

**Phase 1 執行證據（2026-11-22）**：

- T006：`experience-config/experience-configs.controller.ts`、`experience-configs.service.ts`。整合取此客戶啟用中的 `IntegrationBinding`，不符 → 404 `INTEGRATION_NOT_FOUND`。讀取回傳可編輯欄位、版本資訊與 `defaultGreeting`；`createdBy` 經 `auditActorView` 遮蔽開發工程師。`experience-catalog.ts`：多個 HostApp 的 Pack 取能力、參數、enum 值的交集，`label` 為 `safeLabel`；任一 HostApp 沒有 Pack → `available: false`。
- T007：`validate` 與儲存共用 `prepare()`：以 active 版本（沒有時以 binding）的 HostApp、語系組成 payload，`HUMAN_VERIFIED`，版本號 `nextExperienceVersion`，沒有 `id` 的項目產生 `qr-`／`fu-` 加 6 碼；再經 013 的 parser 與 validator。儲存：`baseConfigVersion` 不符 → 409 `EXPERIENCE_CONFIG_CHANGED`；錯誤 → 422 `EXPERIENCE_CONFIG_INVALID`（`details.errors`）；內容與 active 相同（排除版本號比對 checksum）→ `unchanged: true`；`saveVersion` 在同一交易寫入 `admin_experience_config_saved`（metadata 只有整合、版本與數量）。DTO 只檢查最外層形狀。
- T008：`test/integration/admin-experience-config.spec.ts`（10 tests：整合與預設問候語、能力目錄、第一次儲存與 Core `buildOpening` 立即使用、版本遞增與 unchanged、422 與 validate、409 與同時儲存、其他客戶、權限矩陣（含舊的 `ExperienceConfig:create` 無效）、開發工程師遮蔽、沒有 Pack）。測試輔助：`admin-experience.fixture.ts`（把 013 的合成 Pack 改到後台測試客戶並寫入暫存檔、以假的 Tool 註冊表取代資料庫中的 Tool、兩個客戶的整合）；`createAdminTestApp` 新增 `override` 參數，預設 `ASSISTANT_CAPABILITY_PACK_PATHS_JSON=[]`。VM：typecheck、eslint、架構走訪通過（DB 測試由使用者於 Mac 執行）。

## Phase 2 — 版本、指令、文件

- [ ] T010 `versions/getTable`、`versions/:configVersion`、`versions/:configVersion/activate`。
- [ ] T011 Provisioning 指令：`ADMIN_MANAGED`、`--force`、`source: provisioning`；指令測試。Core `EXPERIENCE_CHOICE_UNAVAILABLE`（US5-4）與 SDK 處理（US5-5，`internal-ai-assistant` main）。
- [ ] T012 文件：`docs/frontend-integration/admin-api.md`（體驗設定 API、錯誤碼）、`docs/architecture/admin-back-office.md`、`docs/architecture/assistant-conversation-experience.md`（後台優先）。
- [ ] T013 部署：`admin.env.example`、`compose.yaml` 掛載 Pack、`host-config.sh`。
- [ ] T014 **Gate 2**：全套測試、typecheck、lint；本機以 Swagger 儲存、回復並在 Assistant 確認生效。`FEATURE016_GATE_2=PASS`。

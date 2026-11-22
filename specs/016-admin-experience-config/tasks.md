# Tasks: Feature 016 — Admin Experience Config

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 完成（Gate 2 PASS，2026-11-22）；與後台前端 Feature 002 一起部署

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

- T009 Gate 1（使用者於 Mac，2026-11-22）：typecheck、lint、架構與單元測試通過；後台 DB 測試 112 tests 中 1 failed——「沒有 Pack」測試在同一個測試中關閉再重開 app，期間放開了後台 DB 測試共用的 advisory lock，其他測試檔重設資料表後 `ops.admin` 的權限不同（403）。修正：重開後重新建立資料。於 Gate 2 重跑驗證。`FEATURE016_GATE_1=PASS`（附帶上述修正）。

## Phase 2 — 版本、指令、文件

- [x] T010 `versions/getTable`、`versions/:configVersion`、`versions/:configVersion/activate`。
- [x] T011 Provisioning 指令：`ADMIN_MANAGED`、`--force`、`source: provisioning`；指令測試。Core `EXPERIENCE_CHOICE_UNAVAILABLE`（US5-4）、Gateway 轉送（US5-5）與 SDK 處理（US5-6，`internal-ai-assistant` main）。
- [x] T012 文件：`docs/frontend-integration/admin-api.md`（體驗設定 API、錯誤碼）、`docs/architecture/admin-back-office.md`、`docs/architecture/assistant-conversation-experience.md`（後台優先）。
- [x] T013 部署：`admin.env.example`、`compose.yaml` 掛載 Pack、`host-config.sh`。
**Phase 2 執行證據（2026-11-22）**：

- T010：`versions/getTable`（篩選 `status`、`source`，排序 `createdAt`／`activatedAt`，作者一次查詢並遮蔽開發工程師）、`versions/:configVersion`（無法解析的舊版本 `valid: false` 與錯誤，不回傳內容）、`versions/:configVersion/activate`（`baseConfigVersion` 樂觀鎖、重新以 validator 檢查、已是 active → `unchanged`、無法解析 → 422 `EXPERIENCE_CONFIG_UNREADABLE`、同交易寫入 `admin_experience_config_activated`）。測試 5 個（列表、單一版本與舊格式、回復與 Core 使用、回復時重新檢查、權限）。
- T011：provisioning 指令 `ADMIN_MANAGED`（`--check` 也回報）、`--force`；單元測試。Core：可見的對話中選項不再提供 → 409 `EXPERIENCE_CHOICE_UNAVAILABLE`（`quick-reply-selection`、`feature013-acceptance` 測試改為 409）。Gateway：串流前的 409 安全 JSON 錯誤以 `BackendMessageRejectedError` 原樣轉送，其他失敗仍為 503（client 與 controller 測試）。SDK（`internal-ai-assistant`）：choice 請求 409 → `choice_unavailable`、404 → `session_not_found`；adapter 以 `choice_unavailable` 走既有的移除與提示；contract 與 component 測試、`assistant-api-contract.md`。
- T012：`docs/frontend-integration/admin-api.md` §7（體驗設定 API、欄位、錯誤碼）、`docs/architecture/admin-back-office.md` §7、`docs/architecture/assistant-conversation-experience.md`、`docs/frontend-integration/assistant-conversation-experience.md`（409）。
- T013：`compose.yaml` 將 Pack 目錄唯讀掛載到 `admin-api`；`admin.env.example` 新增 `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`；`deploy.sh preflight` 檢查與 `core.env` 相同；`deploy/demo/README.md`；本機 `localAdminEnvironment` 帶入後端的 Pack 路徑（`node --test` 通過）。

- [x] T014 **Gate 2**：全套測試、typecheck、lint；本機以 Swagger 儲存、回復並在 Assistant 確認生效。`FEATURE016_GATE_2=PASS`。

**Gate 2 首輪（使用者於 Mac，2026-11-22）**：後端全套 2595 tests 中 8 failed。後端失敗原因：

- `quick-reply-selection`「Customer B session 不接受 Customer A 的選項」：對話屬於 Customer B 本人，選項不在 B 的設定中，依 016 改為 409；測試更新。
- 回饋相關 6 個（`customer-feedback-isolation` 2、`feedback-review-linkage` 2、`analytics-ready-raw-events` 1、eval `feedback-review-linkage` 1）：「每則回答一筆回饋」（main 上的修改）之後未更新的測試。兩個原因：(1) 測試資料已有 `message-owned-assistant-001` 的回饋，從「尚未評分」開始的測試改為先移除它（`withoutSeededFeedback`）；先正面再負面的情境改為只有一筆（負面）。(2) `FeedbackEventService` 在 upsert 之後才讀 `previous.rating`；Prisma 回傳的是複本所以實際資料庫正確，但記憶體測試的 delegate 回傳同一個物件，因此判斷錯誤。改為在 upsert 前先取出前一次的評分與是否需處理，不依賴回傳值是否為複本。
- `action-draft-concurrency`：`socket hang up`，與本次修改無關，重跑確認是否為偶發。
- Gate 2 重跑（使用者於 Mac，2026-11-22）：後端全套 2595 tests（307 skipped）全數通過，`action-draft-concurrency` 為偶發；`admin-experience-config.spec.ts` 15 tests 通過（含 Gate 1 修正的「沒有 Pack」測試）。`FEATURE016_GATE_2=PASS`。

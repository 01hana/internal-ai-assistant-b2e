# Feature Specification: Feature 016 — Admin Experience Config

**Canonical Feature Path**: `specs/016-admin-experience-config`
**Feature Branch**: `016-admin-experience-config`（自 main 分出）
**Created**: 2026-11-21
**Status**: 已審核（2026-11-22）
**Predecessor Baseline**: main（014、015 已合併；回饋每則回答一筆已在 main）

## Problem Statement

Feature 013 的體驗設定（問候語、Quick Reply、追問建議）只能由工程師編輯 `customers/<客戶>/assistant-experience/*.json`，再以 provisioning 指令寫入資料庫。客戶想調整問候語或常用問題時，都得透過我方修改設定檔並重新部署。016 在後台 API 提供體驗設定的檢視與編輯，讓具權限的後台使用者自行修改，儲存後立即生效，並保留每個版本以便回復。

## Scope and Authority

- 本 feature 只做後台 API（`src/admin/`）與必要的 Core 調整；後台網站的編輯頁面另以 `internal-ai-assistant-admin` 的 Feature 002 建置，依 `docs/frontend-integration/admin-api.md` 串接。
- **沿用 013 的資料與驗證**：同一張 `AssistantExperienceConfig` 版本表、同一個 payload v1 格式、同一個結構驗證（parser）與 Capability Pack 交叉驗證（validator）。後台不另寫一套規則。
- **儲存即生效**：每次儲存產生一個新版本並立即成為 active，前一個 active 版本改為 retired；沒有「草稿」流程。舊版本保留，可重新啟用（回復）。
- **可編輯**：問候語、Quick Reply 上限、Quick Reply、追問建議。`customerId`、`integrationId`、`hostApps`、`locale` 不可在後台修改。
- **後台優先**：provisioning 指令改為只提供新部署的初始內容；目前 active 版本是後台儲存的時，指令拒絕覆蓋，必須加 `--force`。
- **資料範圍**：一律以 `ADMIN_CUSTOMER_ID` 過濾（沿用 014）。
- **Core 行為不變**：Core 每次建立 session、產生追問建議、解析點選時都讀取 active 版本（沒有快取），儲存後下一次請求即生效；Core 程式只做 US5 列出的調整。
- **不在本 feature 範圍**：後台網站頁面、草稿與排程上線、版本差異比較、多語系、編輯 Capability Pack、刪除版本。

## User Scenarios & Testing

### User Story 0 — 開發基線（Priority: P0）

1. **Given** 開啟 `specs/README.md`，**then** 016 列為進行中；`.specify/feature.json` 指向 016。

### User Story 1 — 檢視體驗設定（Priority: P1）

身為具 `ExperienceConfig:read` 的後台使用者，我可以看到每個整合目前生效的體驗設定，以及編輯時可選擇的能力與參數。

**Independent Test**: 以 provisioning 寫入一份設定 → 整合列表顯示目前版本；讀取設定回傳可編輯欄位；能力目錄只含此整合 Capability Pack 中 active 的能力。

1. **Given** 具 `ExperienceConfig:read`，**when** `GET experienceConfigs/getIntegrations`，**then** 回傳此客戶啟用中的整合（`IntegrationBinding`）：`integrationId`、`hostApps`、目前版本（`configVersion`、`source`、`activatedAt`；沒有設定時為 `null`）。
2. **Given** 同上，**when** `GET experienceConfigs/:integrationId`，**then** 回傳 active 版本的可編輯欄位（`greeting`、`maxQuickReplies`、`quickReplies`、`followUps`）與版本資訊（`configVersion`、`source`、`createdBy`、`activatedAt`）；沒有 active 版本時 `config` 為 `null`，另回傳 Core 的預設問候語 `defaultGreeting`。
3. **Given** 同上，**when** `GET experienceConfigs/:integrationId/catalog`，**then** 回傳可引用的能力：`capabilityKey`、`label`（Pack 的 `safeLabel`）、參數（`name`、`type`、`required`；enum 附可選值與別名）。只列出在此整合每個 `hostApp` 的 Pack 中都 active 的能力（validator 的規則）；沒有載入 Pack 時 `available: false`。
4. **Given** 整合不存在、停用或不屬於此客戶，**then** 404。沒有 `ExperienceConfig:read`，403。

### User Story 2 — 編輯並儲存（Priority: P1）

身為具 `ExperienceConfig:update` 的後台使用者，我可以修改問候語、Quick Reply 與追問建議，儲存後立即生效。

**Independent Test**: 修改問候語並儲存 → 產生下一個版本並成為 active，舊版本為 retired；Core 建立新 session 時回傳新問候語；寫入 `admin_experience_config_saved`。

1. **Given** 具 `ExperienceConfig:update`，**when** `POST experienceConfigs/:integrationId/validate` 以編輯內容，**then** 執行與儲存相同的驗證但不寫入，回傳 `{ valid, errors[] }`（`path`、`code`，與 013 的錯誤格式相同）。
2. **Given** 同上，**when** `POST experienceConfigs/:integrationId` 以 `{ baseConfigVersion, greeting, maxQuickReplies, quickReplies, followUps }`，**then**：
   - 以目前 active 版本的 `hostApps`、`locale` 組成完整 payload（沒有 active 版本時：`hostApps` 取 `IntegrationBinding.allowedHostApp`，`locale` 為 `zh-TW`），`semanticReviewStatus` 為 `HUMAN_VERIFIED`（由後台使用者撰寫）。
   - 版本號為此整合所有版本中最大者的下一個 patch（`1.0.3` → `1.0.4`；沒有任何版本時 `1.0.0`）。
   - 依序執行 parser 與 validator；任一失敗回 422 `EXPERIENCE_CONFIG_INVALID`，`error.details.errors` 列出 `path`、`code`，不寫入。
   - 在同一個交易中將新版本設為 active（`source: admin`、`createdByUserId`），前一個 active 改為 retired；寫入 `admin_experience_config_saved`（前後版本、各項數量）。
   - 內容與目前 active 版本相同（checksum 相同）時不產生新版本，回傳 `unchanged: true`。
3. **Given** `baseConfigVersion` 與目前 active 版本不同（他人已儲存或已回復），**then** 409 `EXPERIENCE_CONFIG_CHANGED`，不寫入。兩人同時儲存時，只有一人成功，另一人 409。
4. **Given** 新增的 Quick Reply 或追問建議沒有 `id`，**then** 後端產生（`qr-`／`fu-` 加 6 碼隨機英數）；已有的 `id` 保留不變（已開啟對話中的選項以 `id` 解析）。
5. **Given** 沒有 `ExperienceConfig:update`，**then** validate 與儲存皆 403。

### User Story 3 — 版本紀錄與回復（Priority: P2）

身為具 `ExperienceConfig:read` 的後台使用者，我可以看到歷次版本；具 `ExperienceConfig:update` 時可以把舊版本重新啟用。

1. **Given** 具 `ExperienceConfig:read`，**when** `POST experienceConfigs/:integrationId/versions/getTable`，**then** 回傳版本：`configVersion`、`status`、`source`（後台／設定檔）、`createdBy`（帳號；開發工程師依 014 規則遮蔽，設定檔寫入者為 `null`）、`createdAt`、`activatedAt`；排序 `createdAt`（預設新到舊）；篩選 `status`、`source`。
2. **Given** 同上，**when** `GET experienceConfigs/:integrationId/versions/:configVersion`，**then** 回傳該版本的可編輯欄位與版本資訊；儲存的內容已無法通過目前的 parser 時，回傳 `valid: false` 與錯誤，不回傳內容。
3. **Given** 具 `ExperienceConfig:update`，**when** `POST experienceConfigs/:integrationId/versions/:configVersion/activate` 以 `{ baseConfigVersion }`，**then** 重新以 validator 檢查（能力可能已停用），通過後在同一交易中將該版本設為 active、原 active 改為 retired，寫入 `admin_experience_config_activated`；不產生新版本號。驗證失敗 422、版本已是 active 回傳 `unchanged: true`、`baseConfigVersion` 不符 409。

### User Story 4 — 設定檔指令改為初始值（Priority: P2）

1. **Given** 目前 active 版本的 `source` 為 `admin`，**when** 執行 provisioning 指令寫入另一個版本，**then** 失敗 `ADMIN_MANAGED`，不寫入；加上 `--force` 才寫入（`source: provisioning`）。
2. **Given** 沒有 active 版本，或 active 版本的 `source` 為 `provisioning`，**then** 行為與 013 相同。
3. `--check` 照常只驗證；同版本同內容仍為 `UNCHANGED`。

### User Story 5 — Core 調整（Priority: P1）

1. **Given** Prisma schema，**then** `AssistantExperienceConfig` 新增 `source`（`provisioning`｜`admin`，既有資料為 `provisioning`）與 `createdByUserId`（後台使用者 ID，可為 null，不建立外鍵）；migration 只新增欄位。
2. **Given** `AssistantExperienceRepository.activate`，**then** 接受 `source`、`createdByUserId`；新增 `listVersions`、`reactivate`，供後台與指令共用。
3. **Given** `DEFAULT_ASSISTANT_GREETING`，**then** 移到 `assistant-experience.types.ts`（service 重新匯出），後台不需載入 service。
4. **Given** 使用者點選的選項在目前 active 版本中已不存在或已無權限，**when** 送出訊息，**then** Core 在確認對話可見後回傳 409 `EXPERIENCE_CHOICE_UNAVAILABLE`（不再當成找不到對話）；不寫入訊息、不輸出 SSE。對話不存在或不可見仍為原本的錯誤。
5. **Given** SDK 收到 `EXPERIENCE_CHOICE_UNAVAILABLE`，**then** 提示「這個選項已更新，請重新選擇」，並重新取得開場的 Quick Reply（`internal-ai-assistant` repo，直接在 main 修改）。
6. 除上述外，Core 讀取 active 版本、組 opening、追問建議、解析點選的行為不變；既有 013 測試全數通過。

## Edge Cases

- **已開啟對話中的舊選項**：使用者在新版本儲存前開啟的對話，按鈕仍是舊的。`id` 仍存在 → 依新版本的內容執行；`id` 已被刪除 → `EXPERIENCE_CHOICE_UNAVAILABLE`，SDK 提示並更新選項（US5-4、5）。
- **Capability Pack 換版**：引用的能力被停用時，Core 本來就不顯示（013）；後台讀取設定照常回傳，下一次儲存或回復時 validator 會指出錯誤，使用者需移除或修改。
- **儲存的舊版本無法解析**（payload 格式未來改版）：列表照常顯示，詳情 `valid: false`，不能回復。
- **後台 process 沒有載入 Pack**：`catalog` 回 `available: false`，validate／儲存／回復回 422（`NO_ACTIVE_PACK`）。
- **大量版本**：每次儲存一個版本；列表分頁，不自動刪除。

## Requirements

- **FR-001** 新增的後台路由皆以 decorator 宣告權限（014 FR-006），對應見 API 一覽。
- **FR-002** 所有讀寫以 `ADMIN_CUSTOMER_ID` 過濾；整合必須是此客戶啟用中的 `IntegrationBinding`，否則 404。
- **FR-003** 驗證只沿用 013 的 parser 與 validator；後台不重複任何欄位規則（長度、格式、數量上限皆來自 `EXPERIENCE_LIMITS`）。
- **FR-004** 啟用新版本與退役舊版本在同一個交易中完成；`activeSlot` 的唯一鍵保證同時只有一份 active。
- **FR-005** 以 `baseConfigVersion` 做樂觀鎖；版本號衝突（同時儲存）以唯一鍵錯誤轉為 409。
- **FR-006** 儲存與回復都寫入 `UserAuditEvent`（`admin_experience_config_saved`、`admin_experience_config_activated`），`AuditTarget.type` 新增 `ExperienceConfig`；metadata 只含整合、版本與數量，不含設定文字。
- **FR-007** 後台 process 載入 Capability Pack：新增後台環境變數 `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`（與 Core 相同格式，啟動時驗證），部署範本將 Pack 目錄唯讀掛載到 admin-api。
- **FR-008** 後台只載入驗證所需的檔案（Pack 載入、目錄、binding 解析、Tool 註冊表、體驗設定的 parser／validator／repository）；架構測試改為逐檔放行，並檢查放行檔案的相依不會載入 Assistant runtime、LLM、retrieval、connectors。
- **FR-009** 權限只有兩個動作：`read` 檢視設定、能力目錄與版本；`update` 驗證、儲存與回復。`ExperienceConfig` 移除 014 登記的 `create`；資料庫中既有的 `ExperienceConfig:create` 由 014 的權限解析自動忽略，不需搬移資料。

### API 一覽（前綴 `/api/v1/admin`）

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `experienceConfigs/getIntegrations` | `ExperienceConfig:read` | 整合與目前版本 |
| GET | `experienceConfigs/:integrationId` | `ExperienceConfig:read` | 目前生效的設定 |
| GET | `experienceConfigs/:integrationId/catalog` | `ExperienceConfig:read` | 可引用的能力與參數 |
| POST | `experienceConfigs/:integrationId/validate` | `ExperienceConfig:update` | 只驗證不寫入 |
| POST | `experienceConfigs/:integrationId` | `ExperienceConfig:update` | 儲存為新版本並立即生效 |
| POST | `experienceConfigs/:integrationId/versions/getTable` | `ExperienceConfig:read` | 版本紀錄 |
| GET | `experienceConfigs/:integrationId/versions/:configVersion` | `ExperienceConfig:read` | 版本內容 |
| POST | `experienceConfigs/:integrationId/versions/:configVersion/activate` | `ExperienceConfig:update` | 回復為此版本 |

## Success Criteria

- **SC-001** 每支新 API 的允許／拒絕矩陣以 DB 測試覆蓋（內建群組、只有單一權限的自訂群組、沒有權限）。
- **SC-002** 儲存後，Core 的 `buildOpening`、`buildFollowUps`、`resolveChoice` 使用新版本（以 Core service 對同一資料庫驗證）。
- **SC-003** 任何驗證失敗都不寫入資料、不寫稽核；同時儲存時只有一個成功。
- **SC-004** 其他客戶的整合與設定不會出現在任何回應中，也無法被寫入。
- **SC-005** 架構測試：後台 process 不載入 Assistant runtime、LLM、retrieval、connectors；Core 不 import 後台。
- **SC-006** provisioning 指令在後台管理的設定上不加 `--force` 不會寫入；013 的指令測試全數通過。

## Decisions

1. **範圍**：後端 016 先完成，後台網站頁面另開前端 Feature 002。（2026-11-21 使用者決定）前端 002 第一版只有「編輯 → 儲存」，不做版本紀錄與回復頁面；後端仍每次儲存一個版本（稽核可對應當時的內容），並提供 US3 的 API 供之後使用。（2026-11-22 使用者決定）
2. **儲存即生效**：沒有草稿；每次儲存產生新版本並立即 active，可回復舊版本。（2026-11-21 使用者決定）
3. **可編輯項目**：問候語、Quick Reply、追問建議都做；能力與參數由 Capability Pack 目錄提供選項。（2026-11-21 使用者決定）
4. **設定檔指令**：只當新部署的初始值，後台優先；覆蓋後台的設定需 `--force`。（2026-11-21 使用者決定）
5. **版本號**：後台自動遞增 patch；使用者不需輸入版本號。
6. **權限**：只有「檢視」（`read`）與「編輯」（`update`，含儲存與回復）；移除 `create`。（2026-11-22 使用者決定）
7. **語系與 HostApp**：沿用目前 active 版本，不在後台修改。
8. **選項 ID**：新項目由後端產生，既有 ID 不變，前端不需顯示 ID。
9. **刪除的選項被點選**：Core 回傳 `EXPERIENCE_CHOICE_UNAVAILABLE`，SDK 提示「這個選項已更新」並重新取得 Quick Reply。（2026-11-22 使用者決定）

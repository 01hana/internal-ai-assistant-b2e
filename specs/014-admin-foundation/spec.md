# Feature Specification: Feature 014 — Admin Back-Office Foundation

**Canonical Feature Path**: `specs/014-admin-foundation`
**Feature Branch**: `014-admin-foundation`（同一分支後續承載 015 營運檢視、016 設定管理）
**Created**: 2026-11-17
**Status**: Draft — 決定已記錄（見 Decisions）；待人工審核通過後實作
**Predecessor Baseline**: `main` @ `0b724b3`（Feature 013 已合併）

## Problem Statement

Feature 013 之後，後端已累積多種「有記錄、沒有人看得到」的資料：無法回答的問題（`ReviewItem`，`sourceType: unsupported_question`）、使用者回饋（`FeedbackEvent`）、Assistant 稽核紀錄（`AuditEvent`）與對話內容；問候語與 Quick Reply 也只能改 JSON 後用 CLI 部署。要讓客戶與我方檢視、處理這些資料，需要一個管理後台。

後台會看到對話內容與業務資料，所以在任何畫面之前，必須先有：後台自己的使用者、群組、登入、權限模型與稽核。Feature 014 只做這個地基；檢視頁面（015）與設定編輯（016）建立在它之上。

## Scope and Authority

- **一個部署 = 一個客戶**：每個客戶是一套獨立部署（主機、資料庫、Core、Gateway、後台）。後台的資料表（使用者、群組、工作階段、後台稽核）不帶 `customerId`；後台 API 啟動時讀取部署設定 `ADMIN_CUSTOMER_ID`（必須是資料庫中存在的客戶，否則拒絕啟動），之後讀取 Assistant 既有資料（對話、訊息、稽核、待審項目，皆有 `customerId`）時一律以它過濾。
- **後台權限與客戶系統權限分開**：客戶系統的 `permissionScopes`（例如 `menu:SCM_DASHBOARD:read`）只決定使用者透過 Assistant 能查什麼；後台權限只決定後台使用者在後台能看與能改什麼。兩者互不推導。
- **後台使用者與 Assistant 使用者分開**：本 spec 的「使用者（User）」一律指後台帳號；客戶系統的使用者在既有資料中是 `actorId`，兩者沒有關聯。
- **權限以 CASL 表示**：一條權限是一對 `{ action, subject }`，在 CASL 中寫作 `can(action, subject)`（動作在前）；儲存與顯示的字串格式為 `subject:action`（例如 `Conversation:read`）。動作只有 `read`、`create`、`update`、`delete` 四種；四種都有即為 `manage`。前後端使用同一份權限清單。
- **權限掛在群組上**：使用者屬於一或多個使用者群組，權限取所屬群組的聯集。系統內建兩個群組：「開發工程師」（`developer`）與「最高管理者」（`admin`），兩者都擁有全部權限；其他群組由客戶自行建立並勾選權限（包含 `User`、`UserGroup`、`Conversation:read` 等，由客戶自由設定）。
- **開發工程師與客戶以群組區分**：屬於「開發工程師」群組的使用者是我方帳號；其他使用者看不到、也不能修改開發工程師帳號與「開發工程師」群組。
- **群組指派**：只有開發工程師能指派或移除「開發工程師」群組。「最高管理者」群組由最高管理者決定要指派給誰；客戶也可自建擁有全部權限（`all:manage` 除外）的群組，不需工程師修改程式。是否把使用者與群組的管理權限交給自訂群組，由最高管理者在設定群組權限時決定。
- **有 `Conversation:read` 才看得到對話**：此權限同時涵蓋對話列表與對話內容；沒有它就無法進入對話頁面。兩個內建群組都具備（最高管理者擁有全部權限，因此限制其查看對話並無實質效果，以每次查看都留稽核作為控制）；自訂群組由最高管理者決定是否勾選。
- **權限只在後端判斷**：前端依權限隱藏按鈕只是方便使用；每支後台 API 在後端檢查權限。
- **後台操作皆留稽核**：登入、登出、使用者與群組變更，以及（015 起）每次查看對話內容。
- **後台 API 不經過 Gateway**：Gateway 是客戶系統串接的入口；後台 API 是獨立行程與連接埠，只開放給後台網站。Core 的進入點不載入後台模組。註：Core 既有的 `/api/v1/admin/assistant/review-items`（Feature 001 的審核 API，使用客戶系統身分、不經後台登入）不受影響；部署時後台網域的 `/api/v1/admin/` 只轉送到後台 API，兩者不會衝突，015 再決定是否改由後台 API 提供。
- **API 寫法沿用既有後台範本**（`ecommerce-admin`）：列表以 `POST <資源>/getTable`、篩選選項以 `GET <資源>/getFilters`、下拉選項以 `GET <資源>/getOptions`、批次操作以 `PATCH <資源>/batch`、刪除以 `DELETE <資源>`（body 帶 `ids`）。
- **密碼只由使用者本人設定**：管理者建立帳號後，後端寄出含一次性連結的邀請信，使用者點連結進入首次登入頁設定密碼；忘記密碼時同樣以寄信的連結重設。管理者、開發工程師皆無法查看或代為設定任何人的密碼。
- **寄信**：後台透過各部署設定的 SMTP 伺服器寄信（客戶的郵件伺服器或指定服務）；本機開發不寄信，改把連結寫入日誌。
- **不在本 feature 範圍**：對話／回饋／無法回答問題／稽核的檢視 API 與頁面（015）、體驗設定編輯（016）、SSO、多因素驗證、多語系。
- **後台前端**：新 repo `internal-ai-assistant-admin`（Nuxt 4 + Nuxt UI），以其自身的 spec 建置骨架；本 feature 定義它要遵守的 API 與權限契約（見「前端契約」）。

## User Scenarios & Testing

### User Story 0 — 開發基線（Priority: P0）

身為開發者，我需要 `specs/README.md` 反映 013 已合併，並登記 014。

**Acceptance Scenarios**:

1. **Given** 開啟 `specs/README.md`，**then** 013 為「完成」、合併日期 2026-11-17；014 列為進行中；`.specify/feature.json` 指向 014。

### User Story 1 — 部署時建立第一位開發工程師（Priority: P1）

身為我方開發者，部署新客戶時，我需要一個指令建立該部署的第一個後台帳號（開發工程師），之後才能登入後台建立其他使用者。

**Why this priority**: 沒有它就無法進入後台；後台沒有「註冊」功能。

**Independent Test**: 空資料庫執行指令 → 建立內建群組與一個屬於「開發工程師」群組、尚未設定密碼的使用者，並寄出（也在終端機顯示）首次登入連結；再執行一次 → 拒絕，不覆寫。

**Acceptance Scenarios**:

1. **Given** 部署中沒有任何後台使用者，**when** 執行 `npm run admin:bootstrap -- --account <帳號> --name <名稱> --email <email>`（部署時 `deploy.sh admin-bootstrap`），**then** 建立兩個內建群組（若不存在）與該使用者（屬「開發工程師」群組、尚未設定密碼），產生首次登入連結：寄到該 email，並在終端機顯示一次（部署者即開發工程師本人，寄信失敗時仍可使用）；寫入 `admin_bootstrap` 稽核事件。
2. **Given** 已有任何後台使用者，**when** 再次執行，**then** 拒絕並說明原因，不建立、不修改任何資料。其他開發工程師由已登入的開發工程師在後台新增（每位工程師各自一個帳號）；客戶的第一位最高管理者也由開發工程師建立。

### User Story 2 — 設定密碼、登入、登出與工作階段（Priority: P1）

身為後台使用者，我收到邀請信後自己設定密碼，之後用帳號（自訂的使用者名稱）與密碼登入；忘記密碼時自己以 email 重設；閒置或登出後需要重新登入。

**Why this priority**: 所有後台功能的入口。

**Independent Test**: 邀請連結設定密碼後可登入；連結只能用一次、過期即失效；正確登入取得 httpOnly cookie，`GET auth/profile` 回傳使用者與權限規則；登出、閒置逾時、停用後同一 cookie 立即失效；連續失敗會暫時鎖定；忘記密碼不透露 email 是否存在。

**Acceptance Scenarios**:

1. **Given** 首次登入連結（`<後台網站>/auth/firstLogin?token=…`），**when** 前端以 `POST auth/verifyToken` 驗證，**then** 回傳該連結對應的帳號（供畫面顯示）與用途；連結無效、已使用或過期時回通用錯誤「連結無效或已過期」。
2. **Given** 有效的首次登入連結，**when** `POST auth/firstLogin` 送出 `{ token, password }`，**then** 設定密碼、連結失效（同一使用者其他未使用的首次登入連結一併失效）；寫入 `admin_password_set`；前端導向登入頁。新密碼至少 12 字元。連結有效 72 小時、只能使用一次。
3. **Given** 正確的帳號與密碼，**when** `POST auth/login`，**then** 建立伺服器端工作階段，以 `HttpOnly; Secure; SameSite=Strict` cookie 回傳不透明的工作階段代碼（瀏覽器 JavaScript 讀不到），回應內容與 `auth/profile` 相同；寫入 `admin_login_succeeded`。
4. **Given** 帳號不存在、密碼錯誤、使用者停用或尚未設定密碼，**when** 登入，**then** 一律回相同的通用錯誤（不透露是哪一種）；寫入 `admin_login_failed`（不記錄輸入的密碼）。
5. **Given** 同一帳號連續 5 次密碼錯誤，**when** 再登入，**then** 鎖定 15 分鐘，期間即使密碼正確也拒絕。
6. **Given** 已登入，**when** `POST auth/logout`，**then** 工作階段撤銷，cookie 清除；同一代碼再使用回 401。
7. **Given** 閒置超過 30 分鐘，或登入超過 12 小時，**when** 呼叫任何 API，**then** 401，需重新登入。
8. **Given** 使用者被停用或刪除，**when** 該使用者下一次呼叫 API，**then** 401（所有工作階段已撤銷）。**Given** 使用者的群組或群組的權限被變更，**then** 下一次呼叫即以新權限判斷。
9. **Given** 會改變狀態的已登入請求（POST／PUT／PATCH／DELETE），**when** 缺少或不符的 CSRF token，**then** 403。
10. **Given** 忘記密碼，**when** `POST auth/forgot` 送出 `{ email }`，**then** 不論 email 是否存在都回相同的成功訊息；若對應到已設定密碼、啟用中的使用者，寄出重設連結（`<後台網站>/auth/reset?token=…`，有效 1 小時、只能使用一次）；寫入 `admin_password_reset_requested`（不存在時不寫入使用者 ID）。同一 email 每 15 分鐘最多寄一次。
11. **Given** 有效的重設連結，**when** `POST auth/reset` 送出 `{ token, password }`，**then** 更新密碼、解除鎖定、撤銷該使用者所有工作階段、連結失效；寫入 `admin_password_reset`；前端導向登入頁。

### User Story 3 — 權限模型與群組（Priority: P1）

身為我方開發者，我需要一份前後端共用的權限清單、兩個內建群組，以及可由客戶自建的群組，讓每支後台 API 都能宣告並檢查所需權限。

**Why this priority**: 015、016 的每支 API 都依賴它；「查看對話」權限的隔離是本後台最重要的安全要求。

**Independent Test**: 不同群組的使用者呼叫同一組 API，只有具備對應權限者成功；非開發工程師看不到開發工程師帳號與「開發工程師」群組；權限清單只有一份來源，前後端引用同一份。

**Acceptance Scenarios**:

1. **Given** 權限定義 `src/admin/permissions/`（唯一來源，不依賴 NestJS 或 Prisma），**then** 它提供：subject 清單與中文標籤、每個 subject 允許的 action、兩個內建群組的權限、自訂群組不可勾選的權限、`subject:action` 字串轉換，以及可直接餵給 CASL 的規則格式；不含任何客戶專屬內容。
2. **Given** 一支後台 API 宣告所需權限（例如 `can('read', 'User')`），**when** 呼叫者的權限不包含它，**then** 403，並不執行任何查詢。
3. **Given** 非開發工程師，**when** 查詢使用者或群組列表、篩選或下拉選項，**then** 不出現開發工程師帳號與「開發工程師」群組；以 ID 讀取或修改它們一律 404。
4. **Given** `GET auth/profile`，**then** 回傳該使用者的 CASL 規則，前端以 `@casl/vue` 直接使用。
5. **Given** 具 `UserGroup:create`／`update`，**when** 建立或修改自訂群組並勾選權限，**then** 只能勾選權限定義中允許的 `subject:action`（動作限 `read`／`create`／`update`／`delete`），且不得包含 `all:manage`（全部權限只屬於兩個內建群組）；`User`、`UserGroup` 可以勾選；寫入 `admin_user_group_created`／`admin_user_group_updated`（含變更前後的權限）。
6. **Given** 內建群組，**when** 修改其權限、改名或刪除，**then** 400（內建群組的權限只能隨版本更新，由 `src/admin/permissions/` 定義）。
7. **Given** 自訂群組仍有成員，**when** 刪除，**then** 400；沒有成員才可刪除，寫入 `admin_user_group_deleted`。

### User Story 4 — 使用者管理（Priority: P1）

身為最高管理者，我可以新增後台使用者、指定群組、停用、刪除，並在需要時重寄邀請信；我無法查看或設定任何人的密碼；所有變更都有紀錄。客戶也可以把使用者管理權限交給自訂群組。

**Why this priority**: 讓客戶自行管理後台使用者。

**Independent Test**: 最高管理者能建立使用者並加入自訂群組，對方收到邀請信；只有開發工程師能指派「開發工程師」群組；沒有人能停用或刪除自己、移除最後一位最高管理者；啟用後的 email 不可修改；每次變更都有稽核事件。

**Acceptance Scenarios**:

1. **Given** 具 `User:create`，**when** 建立使用者（帳號、名稱、email、群組），**then** 建立尚未設定密碼的使用者，並寄出首次登入邀請信；寫入 `admin_user_created`。帳號 3–64 字元，限英數字與 `.`、`_`、`-`；帳號與 email 皆唯一（不分大小寫）。寄信失敗時使用者仍建立成功，回應以 `inviteSent: false` 告知，管理者可稍後重寄。
2. **Given** 具 `User:update`，**when** 修改使用者（名稱、群組；尚未設定密碼者可改 email），**then** 群組變更寫入 `admin_user_groups_changed`（含變更前後的群組），其他欄位變更寫入 `admin_user_updated`。帳號建立後不可修改。修改邀請中使用者的 email 時，舊的邀請連結失效（需重寄）。
3. **Given** 使用者已設定密碼（已啟用），**when** 非開發工程師修改其 email，**then** 400；email 改為唯讀，需要更改時由客戶通知開發工程師處理（開發工程師修改時寫入 `admin_user_email_changed`，並撤銷該使用者的工作階段與未使用的連結）。理由：若可任意修改 email，修改者就能把 email 改成自己的信箱，再以「忘記密碼」取得對方帳號。
4. **Given** 具 `User:update` 的使用者（無論屬於哪個群組），**when** 指派或移除「最高管理者」群組，**then** 依其權限允許（`User:update` 即可），並受 US4-6、US4-7 的保護規則限制；寫入 `admin_user_groups_changed`。是否把 `User`、`UserGroup` 權限交給自訂群組由最高管理者決定（Decision 26）。
5. **Given** 非開發工程師，**when** 指派「開發工程師」群組，**then** 403；**when** 修改、停用、刪除、重寄邀請的對象是開發工程師帳號，**then** 404。
6. **Given** 任何使用者，**when** 停用或刪除自己、或把自己移出所屬的內建群組，**then** 400。
7. **Given** 僅剩一位啟用中的最高管理者（開發工程師不計入），**when** 停用、刪除他或將他移出「最高管理者」群組，**then** 400（避免客戶被鎖在後台外）。
8. **Given** 具 `User:update`，**when** `PATCH users/batch` 以 `{ ids, status }` 停用或啟用，**then** 停用立即撤銷這些使用者的所有工作階段；分別寫入 `admin_user_disabled`／`admin_user_enabled`。
9. **Given** 具 `User:update`，**when** `POST users/:id/resendInvite`，**then** 僅限尚未設定密碼的使用者：舊的首次登入連結失效、寄出新連結；已設定密碼者回 400（請使用者自行「忘記密碼」）。寫入 `admin_user_invite_resent`。
10. **Given** 具 `User:delete`，**when** `DELETE users` 以 `{ ids }` 刪除，**then** 撤銷其工作階段、刪除其未使用的連結與群組關聯；稽核事件保留（以使用者 ID 與帳號快照記錄，不依賴使用者資料仍存在）；寫入 `admin_user_deleted`。被刪除的帳號名稱與 email 可再次使用。
11. **Given** 任何 API，**then** 沒有可讓他人查看、設定或重設某使用者密碼的端點。

### User Story 5 — 後台稽核紀錄（Priority: P1）

身為開發工程師或最高管理者，我需要事後追查誰在何時登入、改了哪個使用者或群組。

**Independent Test**: US1–US4 的每個狀態變更都產生一筆後台稽核事件；事件不含密碼、雜湊或工作階段代碼；稽核事件無法透過 API 修改或刪除。

**Acceptance Scenarios**:

1. **Given** US1–US4 的任一事件，**then** `UserAuditEvent` 新增一筆：時間、`requestId`、執行者（ID、帳號快照、是否為開發工程師）、事件類型、目標類型與 ID、來源 IP 與 User-Agent 摘要、變更前後摘要。
3. **Given** 非開發工程師檢視稽核紀錄（015），**then** 執行者或對象為開發工程師時一律顯示為「開發工程師」，不顯示其帳號、名稱或 email。
2. **Given** 任何後台 API，**then** 沒有修改或刪除稽核事件的端點；檢視 API 在 015 提供（`AuditEvent:read`）。

### Edge Cases

- 帳號大小寫不同視為同一帳號（以小寫儲存與比對）。
- 鎖定期間的登入失敗不延長鎖定、不重複計數。
- 連結代碼放在網址 query 中：前端讀取後立即以 `history.replaceState` 移除，頁面設定 `Referrer-Policy: no-referrer`；代碼只存雜湊、只能使用一次。
- 同時存在多個未使用的連結（例如重寄）時，只有最新的有效。
- 登入回應時間不因「帳號不存在」與「密碼錯誤」而明顯不同（不存在時仍做一次雜湊比對）。
- 停用或刪除後，既有工作階段立即失效，不等逾時。
- 開發工程師帳號同時屬於「最高管理者」群組時，仍視為開發工程師（不計入「最後一位最高管理者」，對其他人隱藏）。
- `ADMIN_CUSTOMER_ID` 未設定或不存在於資料庫：後台 API 拒絕啟動並說明原因。
- 部署升級後既有使用者、群組與工作階段不受影響（migration 只新增）；新版本若在權限定義中新增 subject，內建群組的權限隨之更新，自訂群組不自動取得新權限。

## Requirements

### Functional Requirements

- **FR-001** 後台 API 程式位於 Core 的 `src/admin/`，以獨立進入點 `src/admin-main.ts`（產出 `dist/src/admin-main.js`）啟動：與 Core 同一份 build 與 Docker image，但為獨立行程、獨立連接埠，路徑前綴 `/api/v1/admin`。Core 的 `AppModule` 不引入後台模組；後台不接受 Gateway 或 Core 的身分 token。
- **FR-002** 以帳號（自訂使用者名稱）登入；密碼以 Node 內建 `scrypt` 加鹽雜湊；密碼只能由使用者本人透過首次登入或重設連結設定。
- **FR-003** 工作階段存於資料庫（可撤銷），cookie 只放不透明代碼；資料庫只存代碼的雜湊。閒置 30 分鐘、絕對 12 小時逾時。
- **FR-004** CSRF：登入時另發非 httpOnly 的 CSRF cookie，狀態變更請求須以 `X-CSRF-Token` header 帶回相同值，並檢查 `Origin` 為設定的後台網站來源。
- **FR-005** CORS 只允許設定的後台網站來源，並允許攜帶 cookie。`auth/login`、`auth/forgot`、`auth/verifyToken`、`auth/firstLogin`、`auth/reset` 有速率限制。
- **FR-006** 權限定義 `src/admin/permissions/` 為唯一來源；後端以 `@casl/ability` 判斷、以 `@casl/prisma` 將條件轉為查詢；每支後台 API 以 decorator 宣告所需權限，未宣告的 API 一律拒絕。
- **FR-007** 群組指派與自訂群組規則見 US3-3、US3-5～7、US4-2～7；群組變更、停用、刪除立即生效。
- **FR-008** 後台稽核寫入獨立的 `UserAuditEvent`（既有 `AuditEvent` 記錄 Assistant 的問答與工具呼叫，要求 `organizationId`、`hostApp`、`actorId`，不適用於後台使用者；015 的稽核頁可同時查兩者）。
- **FR-009** `admin:bootstrap` 指令只在沒有任何後台使用者時執行；`deploy.sh` 新增 `admin-bootstrap` 步驟；部署設定新增 `admin-api` 服務（與 `core` 同一 image、不同啟動指令）與 `ADMIN_CUSTOMER_ID`。
- **FR-010** 本機開發：`npm run local:start` 一併啟動後台 API（連接埠 3200）；不自動建立使用者，由開發者執行 `admin:bootstrap`。
- **FR-011** 任何 API 都不回傳 `passwordHash`、`failedLoginCount`、`lockedUntil`、`passwordChangedAt`，以及任何連結代碼或其雜湊。
- **FR-012** 首次登入與重設連結：32 bytes 隨機代碼，資料庫只存雜湊；首次登入 72 小時、重設 1 小時有效；只能使用一次；新連結產生時同用途的舊連結失效。
- **FR-013** 寄信透過 SMTP（設定 `ADMIN_SMTP_HOST`、`ADMIN_SMTP_PORT`、`ADMIN_SMTP_SECURE`、`ADMIN_SMTP_USER`、`ADMIN_SMTP_PASSWORD`、`ADMIN_MAIL_FROM`）；`ADMIN_MAIL_TRANSPORT=log` 時改寫入日誌，只允許在本機開發使用（`NODE_ENV=production` 時設定此值則拒絕啟動）。信件內容只含連結、帳號與有效期限，不含密碼。

### 權限清單（初版）

字串格式 `subject:action`；CASL 中為 `can(action, subject)`。動作只有 `read`、`create`、`update`、`delete`；某 subject 四種都有時可寫成 `subject:manage`。014 只實作 `User`、`UserGroup` 相關 API，其他 subject 先登記，供 015、016 使用。

| Subject | Actions | 用途 | 實作於 |
| --- | --- | --- | --- |
| `User` | `read`、`create`、`update`、`delete` | 後台使用者（`update` 含變更群組、停用／啟用、重寄邀請信） | 014 |
| `UserGroup` | `read`、`create`、`update`、`delete` | 使用者群組與其權限 | 014 |
| `AuditEvent` | `read` | Assistant 稽核與後台稽核 | 015 |
| `Stats` | `read` | 使用量、回饋比例等統計 | 015 |
| `Conversation` | `read` | 對話列表與對話內容（每次查看內容都留稽核） | 015 |
| `ReviewItem` | `read`、`update` | 無法回答的問題、待審項目（`update` 為標記處理狀態） | 015 |
| `Feedback` | `read` | 👍／👎 與對應回答 | 015 |
| `ExperienceConfig` | `read`、`create`、`update` | 問候語與 Quick Reply（`update` 含啟用版本） | 016 |
| `all` | `manage` | 全部 subject 的全部動作（只屬於兩個內建群組，不可加入自訂群組） | 014 |

### 內建群組

| 群組 | 代碼 | 權限 | 誰可以指派 |
| --- | --- | --- | --- |
| 開發工程師 | `developer` | `all:manage`；對其他人隱藏 | 開發工程師 |
| 最高管理者 | `admin` | `all:manage`（看不到、也不能修改開發工程師帳號與「開發工程師」群組） | 開發工程師、最高管理者 |

其他群組皆為客戶自建，權限由客戶勾選（`all:manage` 除外）。一個使用者可屬於多個群組，權限取聯集。

### Key Entities（資料表）

- **User**（後台使用者）：`id`、`account`（唯一、小寫）、`name`、`email`（必填、唯一、小寫）、`status`（布林，`true` 為啟用）、`lastLoginAt`、`createdAt`、`updatedAt`——以上為 API 可回傳的欄位；另以 `groups` 回傳所屬群組、以 `invitationPending`（尚未設定密碼）供「重寄邀請信」使用。內部欄位 `passwordHash`（尚未設定密碼時為空）、`failedLoginCount`、`lockedUntil`、`passwordChangedAt` 只供後端使用（FR-011）。
- **UserGroup**（使用者群組）：`id`、`code`（內建群組的固定代碼 `developer`／`admin`；自訂群組為空）、`name`（唯一）、`description`、`isSystem`、`permissions`（自訂群組的 `subject:action` 清單；內建群組由 `src/admin/permissions/` 決定，不存於此）、`createdAt`、`updatedAt`。
- **使用者與群組的對應**：多對多。一個欄位只能存一個群組，因此不在 `User` 上放 `groupId`，而以 Prisma 的隱含多對多關聯（`User.groups` ↔ `UserGroup.users`）表示：Prisma 自動建立只有兩個外鍵欄的對應表 `_UserToUserGroup`，schema 中不另外宣告 model；誰在何時變更群組由稽核事件記錄。
- **UserToken**（設定密碼連結）：`id`、`userId`、`purpose`（`first_login`／`reset_password`）、`tokenHash`、`expiresAt`、`usedAt`、`createdAt`。邀請信與重設信的連結各一筆；只存代碼雜湊。
- **UserSession**（登入工作階段）：`id`、`tokenHash`、`userId`、`createdAt`、`lastSeenAt`、`expiresAt`、`revokedAt`、`ipSummary`、`userAgentSummary`。每次登入一筆；cookie 只放隨機代碼，後端以它找到這筆紀錄，才能做到登出、停用、重設密碼後立即失效。
- **UserAuditEvent**（後台稽核）：`id`、`requestId`、`timestamp`、`actorUserId`（登入失敗時為空）、`actorAccount`（帳號快照）、`actorIsDeveloper`、`eventType`、`targetType`、`targetId`、`targetIsDeveloper`、`ipSummary`、`userAgentSummary`、`metadata`（不含密碼、雜湊、工作階段代碼）。不與 `User` 建立外鍵，使用者刪除後紀錄仍完整；`actorIsDeveloper`／`targetIsDeveloper` 供 015 對非開發工程師隱藏開發工程師的身分。

### API（014）

路徑前綴 `/api/v1/admin`。

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| POST | `auth/login` | 公開（有速率限制） | 登入 |
| POST | `auth/logout` | 已登入 | 登出 |
| GET | `auth/profile` | 已登入 | 目前使用者、群組、CASL 規則 |
| POST | `auth/verifyToken` | 公開（有速率限制） | 驗證首次登入或重設連結，回傳帳號與用途 |
| POST | `auth/firstLogin` | 公開（憑首次登入連結） | 設定密碼 |
| POST | `auth/forgot` | 公開（有速率限制） | 寄出重設連結（不透露 email 是否存在） |
| POST | `auth/reset` | 公開（憑重設連結） | 重設密碼 |
| POST | `users/getTable` | `User:read` | 使用者列表（分頁、排序、篩選） |
| GET | `users/getFilters` | `User:read` | 列表篩選選項（群組、狀態） |
| GET | `users/:id` | `User:read` | 單一使用者 |
| POST | `users` | `User:create` | 建立並寄出邀請信；回應含 `inviteSent` |
| PUT | `users/:id` | `User:update` | 修改名稱、群組；email 只在邀請中可改（開發工程師除外） |
| PATCH | `users/batch` | `User:update` | 批次停用／啟用（`{ ids, status }`） |
| POST | `users/:id/resendInvite` | `User:update` | 重寄邀請信（僅限尚未設定密碼者） |
| DELETE | `users` | `User:delete` | 批次刪除（`{ ids }`） |
| POST | `groups/getTable` | `UserGroup:read` | 群組列表 |
| GET | `groups/getOptions` | `User:read` 或 `UserGroup:read` | 群組下拉選項（建立／修改使用者時用） |
| GET | `groups/getPermissions` | `UserGroup:read` | 可勾選的權限清單（subject × action），供群組權限矩陣使用 |
| GET | `groups/:id` | `UserGroup:read` | 單一群組 |
| POST | `groups` | `UserGroup:create` | 建立自訂群組 |
| PATCH | `groups/:id` | `UserGroup:update` | 修改自訂群組（名稱、說明、權限） |
| DELETE | `groups` | `UserGroup:delete` | 批次刪除無成員的自訂群組（`{ ids }`） |

- `getTable` 的 body：`{ page, pageSize, sort?: { field, order }, filters?: { … }, keyword? }`；回應 `{ items, total }`。
- 回應沿用 Core 的 envelope：`{ requestId, data }`／`{ requestId, error: { code, message } }`。
- 批次操作（`users/batch`、`DELETE users`、`DELETE groups`）為全有或全無：任一筆違反規則即整批拒絕並說明是哪一筆（`error.details.ids`）。

### 前端契約（給 `internal-ai-assistant-admin`）

- 以 cookie 維持登入，前端不保存任何 token；請求帶 `credentials: 'include'`，狀態變更請求帶 `X-CSRF-Token`（取自 CSRF cookie）。
- 開啟或重新整理需要登入的頁面時呼叫 `GET auth/profile`：成功即以回傳的 CASL 規則 `createMongoAbility(rules)` 建立 ability；401 即導向登入頁。選單與路由各自標註所需 `{ action, subject }`，不以路由名稱當 subject。
- 首次登入頁 `/auth/firstLogin?token=…` 與重設頁 `/auth/reset?token=…`：讀取 token 後立即從網址移除，以 `auth/verifyToken` 取得帳號顯示，送出 `auth/firstLogin`／`auth/reset` 成功後導向登入頁。忘記密碼頁呼叫 `auth/forgot`，一律顯示相同的成功訊息。
- 群組的權限矩陣以 `groups/getPermissions` 的清單產生（列為 subject、欄為 action），不在前端寫死。
- 401 → 導向登入頁；403 → 顯示無權限，不登出。
- 前端不引用後端程式：權限矩陣取自 `groups/getPermissions`、使用者權限取自 `auth/profile`；選單與路由所需的 subject 名稱在前端以型別檔維護，並以測試比對 `groups/getPermissions` 的回傳，避免兩邊不一致。

## Success Criteria

- **SC-001** 兩個內建群組與數種自訂群組（含／不含 `User`、`UserGroup`、`Conversation:read`）對所有 014 API 的允許／拒絕矩陣全部有測試，結果與權限表一致。
- **SC-002** 非開發工程師在所有列表、篩選、下拉選項與單筆 API 中都看不到開發工程師帳號與「開發工程師」群組，也無法修改它們。
- **SC-009** 只有開發工程師能指派「開發工程師」群組；任何人都無法停用或刪除自己、移除最後一位最高管理者，或修改已啟用使用者的 email（開發工程師除外）。
- **SC-003** 登出、停用、刪除、重設密碼、逾時後，舊工作階段代碼一律 401；連結代碼使用後或過期即失效；資料庫與日誌中找不到明文密碼、工作階段代碼或連結代碼（`ADMIN_MAIL_TRANSPORT=log` 的本機日誌除外）。
- **SC-008** 沒有任何 API 能讓他人查看、設定或重設某使用者的密碼。
- **SC-004** US1–US4 的每個狀態變更都有對應的 `UserAuditEvent`。
- **SC-005** 權限清單在後端只有一份（`src/admin/permissions/`）；新增 subject 或 action 只需修改該處，前端經由 API 取得。
- **SC-006** Core、Gateway 的既有測試全數通過；Core 不載入後台模組（架構測試鎖定），後台路由只存在於後台 API；客戶系統串接的 API 行為不變。
- **SC-007** 所有後台 API 的回應都不含 FR-011 列出的內部欄位（以測試掃描每個端點的回應）。

## Assumptions

- 後台網站與後台 API 在同一個網域下（例如 `admin.<客戶網域>` 提供網站，`admin.<客戶網域>/api/v1/admin` 轉送到後台 API），由反向代理轉送；`SameSite=Strict` cookie 因此可用。若不同網域，需改用 `SameSite=None` 並加強 CSRF，屬部署調整。
- 每個部署的後台使用者數量少（數十個以內）。
- 新增依賴：`@casl/ability`、`@casl/prisma`、`cookie-parser`、`nodemailer`（需在 Mac 上安裝並提交 lockfile）。
- 每個部署能提供可寄信的 SMTP 設定（客戶的郵件伺服器或指定的寄信服務）；部署前需確認寄出的信不會被客戶的郵件系統擋下。

## Decisions（2026-11-17 審核決定）

1. **程式位置**：`src/admin/` 加獨立進入點 `src/admin-main.ts`，與 Core 同 image、不同指令啟動（取代原規劃的 `apps/admin-api`：`apps/gateway` 的隔離模式無法共用 Core 的業務規則）。
2. **登入**：以自訂使用者名稱（帳號）登入；資料以「使用者」與「使用者群組」組成，權限掛在群組上，可自建群組；一個使用者可屬於多個群組。
3. **逾時**：閒置 30 分鐘、絕對 12 小時。
4. **多因素驗證**：本 feature 不做。
5. **開發工程師帳號**：每位工程師各自一個帳號；第一個由 `admin:bootstrap` 建立，其他在後台新增。
6. **（2026-11-17 晚間修訂）內建群組**：只有「開發工程師」（`developer`）與「最高管理者」（`admin`），兩者皆擁有全部權限；取消「對話稽核」等其他內建群組，查看對話改為可勾選的權限 `Conversation:read`。
7. **分支**：`014-admin-foundation`，後續 015、016 沿用同一分支。
8. **API 路徑與寫法**：前綴 `/api/v1/admin`；登入為 `auth/login`，其餘沿用既有後台範本（`auth/profile`、`auth/firstLogin`、`auth/forgot`、`auth/reset`、`<資源>/getTable`、`getFilters`、`getOptions`、`batch`、`DELETE <資源>` 帶 `ids`；群組路徑為 `groups`）。範本沒有的操作以同樣風格命名：`auth/logout`、`auth/verifyToken`、`users/:id/resendInvite`、`groups/getPermissions`。
9. **使用者欄位**：名稱欄位為 `name`；`status` 為布林；`email` 必填且唯一；密碼雜湊等內部欄位任何 API 都不回傳。
10. **動作只有四種**：`read`、`create`、`update`、`delete`，四種都有即 `manage`；變更群組、停用、重設密碼歸 `User:update`，處理待審項目歸 `ReviewItem:update`，啟用體驗設定版本歸 `ExperienceConfig:update`。
11. **對話**：`Conversation:read` 同時涵蓋列表與內容；內建群組皆具備，自訂群組由客戶決定。
12. **使用者與群組的對應**：多對多，以 Prisma 隱含多對多表示（不在 `User` 上放單一 `groupId`）。
13. **後台稽核表**：命名為 `UserAuditEvent`（既有的 `AuditEvent` 為 Assistant 稽核，同名會衝突）。
14. **不帶 `customerId`**：後台資料表不放 `customerId`；後台 API 以部署設定 `ADMIN_CUSTOMER_ID` 決定讀取哪個客戶的 Assistant 資料；開發工程師與客戶以群組區分。
15. **刪除使用者**：依範本提供刪除；稽核紀錄以 ID 與帳號快照保留，不受刪除影響。
16. **密碼只由本人設定**：建立帳號後寄出首次登入連結（`auth/firstLogin`）；不提供自行改密碼或由管理者重設密碼的 API；管理者無法查看或代設任何人的密碼。
17. **忘記密碼**：照範本提供 `auth/forgot`（輸入 email 寄出重設連結）與 `auth/reset`；使用者想更換密碼也走這個流程。
18. **重寄邀請信**：`users/:id/resendInvite`，僅限尚未設定密碼的使用者。
19. **連結期限**：首次登入 72 小時、重設 1 小時，皆只能使用一次。
20. **設定密碼後**：導向登入頁重新登入，不自動登入。
21. **寄信服務**：目前先使用公司的寄信服務（SMTP）；之後若客戶要求改用自己的郵件伺服器，只需調整該部署的設定。
22. **email 啟用後唯讀**：使用者設定密碼後 email 不可修改；需要時由客戶通知開發工程師處理（避免以修改 email 加「忘記密碼」盜用帳號）。
23. **體驗設定**：客戶可自行修改；目前沒有「僅限開發工程師」的功能。
24. **稽核顯示**：非開發工程師檢視稽核紀錄時，開發工程師一律顯示為「開發工程師」。
25. **自訂群組可勾選的權限**：除 `all:manage` 外不限制（含 `User`、`UserGroup`），由客戶自由設定。
26. **不限制「最高管理者」群組的指派者**（2026-11-18）：具 `User:update` 即可指派；是否把使用者與群組管理權限交給自訂群組，由最高管理者設定群組時把關，保留客戶建立「與最高管理者同等權限」群組的彈性。保留的保護規則：只有開發工程師能指派「開發工程師」群組、不能停用或刪除自己、不能把自己移出所屬內建群組、至少保留一位啟用中的最高管理者、已啟用使用者的 email 唯讀、內建群組不可修改或刪除。
27. **權限定義不另外打包**（2026-11-18）：放在 `src/admin/permissions/`，不建立獨立的 `packages/` 套件；後台前端在另一個 repo，改由 API 取得權限清單與規則，只在前端保留 subject 名稱的型別。之後若有多個前端或服務需要共用，再抽出成套件。
28. **Swagger 只供本機測試**（2026-11-18）：`ADMIN_ENABLE_SWAGGER_DOCS=true` 時於 `/api/v1/admin/docs` 提供 Swagger UI，預設關閉，正式環境開啟即拒絕啟動。驗證方式為 session cookie 加 `X-CSRF-Token` header；DTO 欄位由 `@nestjs/swagger` CLI plugin 在 build 時依型別與 class-validator 自動產生，不逐一手寫 `@ApiProperty`。

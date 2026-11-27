# 前端串接指南：後台管理 API（Feature 014、015、016）

給後台網站（`internal-ai-assistant-admin`，Nuxt 4 + Nuxt UI）串接用。架構見 [`docs/architecture/admin-back-office.md`](../architecture/admin-back-office.md)；本機啟動 API 後，完整的欄位說明可在 Swagger UI `http://localhost:3200/api/v1/admin/docs` 查看與試打。

## 1. 連線、登入狀態與 CSRF

- 路徑前綴 `/api/v1/admin`。正式環境網站與 API 同源（同一個網域，Nginx 轉送 `/api/v1/admin/`）。
- 登入狀態只靠 cookie，前端**不保存任何 token**：
  - `admin_session`：httpOnly，前端讀不到也不需要讀。
  - `admin_csrf`：前端可讀；所有 `POST`／`PUT`／`PATCH`／`DELETE` 都要把它的值放在 `X-CSRF-Token` header。
- 請求一律帶 cookie（`credentials: 'include'`）；API 另會檢查 `Origin` 必須是設定的後台網站來源之一（`ADMIN_WEB_ORIGIN`，可用逗號設定多個；信件連結使用第一個）。
- **本機開發**：用 Nuxt 的 dev proxy 讓網站與 API 同源（dev server 3300 埠）。`npm run local:start` 預設 `ADMIN_WEB_ORIGIN=http://localhost:3300,http://localhost:3200`，同時允許網站與 Swagger UI，信件連結指向網站：

  ```ts
  // nuxt.config.ts
  export default defineNuxtConfig({
    nitro: { devProxy: { '/api/v1/admin': { target: 'http://localhost:3200/api/v1/admin', changeOrigin: false } } }
  });
  ```

## 2. 回應與錯誤格式

成功：`{ "requestId": "…", "data": … }`。失敗：

```json
{ "requestId": "…", "error": { "code": "CANNOT_DELETE_SELF", "message": "不可刪除自己的帳號。", "details": { "ids": ["…"] } } }
```

- `message` 是可以直接顯示的中文訊息；程式判斷請用 `code`。
- 欄位驗證失敗（400 `BAD_REQUEST`）時 `details.validationErrors` 列出每個欄位的錯誤。
- 批次操作（`users/batch`、`DELETE users`、`DELETE groups`）全有或全無，被拒的那幾筆在 `details.ids`。
- `401` → 導向登入頁；`403` → 顯示無權限，不登出；`404` 也用於「看不到」的資料（例如非開發工程師查開發工程師帳號）；`429 TOO_MANY_REQUESTS` → 提示稍後再試。

## 3. 登入與密碼流程

| Method | Path | Body | 回應 `data` |
| --- | --- | --- | --- |
| POST | `auth/login` | `{ account, password }` | `{ user, permissions }`，並設定兩個 cookie |
| POST | `auth/logout` | — | `null` |
| GET | `auth/profile` | — | `{ user, permissions }` |
| PUT | `auth/profile` | `{ currentPassword, newPassword }` | `null`（修改自己的密碼） |
| POST | `auth/verifyToken` | `{ token }` | `{ account, purpose: 'first_login' \| 'reset_password' }` |
| POST | `auth/firstLogin` | `{ token, password }` | `null` |
| POST | `auth/forgot` | `{ email }` | `{ accepted: true }`（一律相同，不透露 email 是否存在） |
| POST | `auth/reset` | `{ token, password }` | `null` |

- 開啟或重新整理需要登入的頁面時呼叫 `auth/profile`：成功就用 `permissions` 建立 ability（`createMongoAbility(permissions)`，`@casl/ability`）；401 就導向登入頁。
- `permissions` 為 CASL 規則 `[{ action, subject }]`，例如 `{ action: 'manage', subject: 'User' }`；開發工程師是 `{ action: 'manage', subject: 'all' }`。選單、路由與按鈕各自標註所需的 `{ action, subject }`，不要用路由名稱當 subject。
- 信件連結：首次登入 `/auth/firstLogin?token=…`、重設 `/auth/reset?token=…`。頁面讀到 token 後立即從網址移除，用 `auth/verifyToken` 取得帳號顯示；送出成功後導向登入頁。連結無效或過期時 `code` 為 `INVALID_OR_EXPIRED_LINK`。
- 密碼規則：8–128 個字元、不可與帳號相同（`PASSWORD_TOO_SHORT`、`PASSWORD_TOO_LONG`、`PASSWORD_SAME_AS_ACCOUNT`）。
- 修改自己的密碼（`PUT auth/profile`）：目前的密碼錯誤為 `CURRENT_PASSWORD_INCORRECT`，新舊相同為 `PASSWORD_UNCHANGED`，另套用上面的密碼規則；成功後其他裝置的登入全部登出（目前這個保留），尚未使用的重設密碼連結失效，並留下 `admin_password_changed` 稽核。每個 IP 每分鐘 10 次。
- 登入失敗一律為 `INVALID_CREDENTIALS`（不區分帳號不存在、密碼錯誤、停用或鎖定）。

## 4. 使用者 `users`

`user` 的形狀：`{ id, account, name, email, status, invitationPending, lastLoginAt, createdAt, updatedAt, groups: [{ id, name, code }] }`。`status` 為布林值（`true` 啟用）；`invitationPending` 為 `true` 表示尚未設定密碼。

| Method | Path | 權限 | Body | 回應 `data` |
| --- | --- | --- | --- | --- |
| POST | `users/getTable` | `User:read` | `{ page, pageSize, sort?: { field, order }, filters?: { groups?: string[], status?: boolean[] }, keyword? }` | `{ items: user[], total }` |
| GET | `users/getFilters` | `User:read` | — | `{ groups: [{ value, label }], status: [{ value, label }] }` |
| GET | `users/:id` | `User:read` | — | `user` |
| POST | `users` | `User:create` | `{ account, name, email, groupIds }` | `{ user, inviteSent }` |
| PUT | `users/:id` | `User:update` | `{ name?, email?, groupIds? }` | `user` |
| PATCH | `users/batch` | `User:update` | `{ ids, status }` | `{ updated }` |
| POST | `users/:id/resendInvite` | `User:update` | — | `{ inviteSent }` |
| DELETE | `users` | `User:delete` | `{ ids }` | `{ deleted }` |

- `page` 從 1 開始，`pageSize` 最多 100；`sort.field` 可用 `account`、`name`、`lastLoginAt`、`createdAt`；`keyword` 比對帳號、名稱、email。
- 列表中登入者本人（符合搜尋與篩選時）永遠是第 1 頁第 1 筆，不受排序影響，之後的頁面不會再出現；其他人依排序（預設建立時間新到舊）。`total` 含本人。
- 帳號 3–64 字元，限英數字與 `.`、`_`、`-`，建立後不可修改；帳號與 email 不分大小寫唯一（`ACCOUNT_TAKEN`、`EMAIL_TAKEN`）。
- `inviteSent: false` 表示使用者已建立但信沒寄出，請提示管理者稍後「重寄邀請信」。
- email：`invitationPending` 為 `true` 時可修改（舊連結失效，需重寄）；已啟用後只有開發工程師能改（其他人 `EMAIL_LOCKED`），表單應改為唯讀並提示聯絡開發工程師。
- 重寄邀請只限尚未設定密碼、啟用中的使用者（`ALREADY_ACTIVATED`、`USER_DISABLED`）。
- 不能授予超過自己的權限：新增或移除的群組，權限都必須是登入者本身權限的子集，否則 403 `GROUP_BEYOND_YOUR_PERMISSIONS`（`details.ids`）；使用者原本就有、這次沒變動的群組不重新檢查。只有持有 `all:manage` 的人（開發工程師、最高管理者）能指派「最高管理者」。
- 不能修改自己的群組：編輯自己時 `groupIds` 若與目前不同，回 400 `CANNOT_CHANGE_OWN_GROUPS`；表單應把群組欄位設為唯讀（名稱仍可改）。
- 其他規則錯誤：`DEVELOPER_GROUP_FORBIDDEN`（403）、`CANNOT_DISABLE_SELF`、`CANNOT_DELETE_SELF`、`GROUP_NOT_FOUND`、`USER_NOT_FOUND`。
- 群組下拉選單用 `groups/getOptions`（見下節），`assignable: false` 的選項應停用。

## 5. 群組 `groups`

`group` 的形狀：`{ id, code, name, description, isSystem, permissions, manageable, memberCount, createdAt, updatedAt }`；內建群組的 `code` 為 `developer`／`admin`，自訂群組為 `null`。`manageable` 依登入者計算：自訂群組、不是自己所屬、權限不超過自己時為 `true`，前端只在 `true` 時提供編輯與刪除，其餘唯讀。

| Method | Path | 權限 | Body | 回應 `data` |
| --- | --- | --- | --- | --- |
| POST | `groups/getTable` | `UserGroup:read` | `{ page, pageSize, sort?, keyword? }` | `{ items: group[], total }` |
| GET | `groups/getOptions` | `User:read` 或 `UserGroup:read` | — | `[{ id, label, isSystem, assignable }]` |
| GET | `groups/getPermissions` | `UserGroup:read` | — | `[{ subject, label, actions }]` |
| GET | `groups/:id` | `UserGroup:read` | — | `group` |
| POST | `groups` | `UserGroup:create` | `{ name, description?, permissions }` | `group` |
| PATCH | `groups/:id` | `UserGroup:update` | `{ name?, description?, permissions? }` | `group` |
| DELETE | `groups` | `UserGroup:delete` | `{ ids }` | `{ deleted }` |

- 權限矩陣以 `groups/getPermissions` 產生（列為 subject、欄為 action），不要寫死在前端；`permissions` 送 `subject:action` 字串，例如 `["User:read", "Conversation:read"]`。
- 新增或修改群組時，勾選的權限必須是登入者本身擁有的（矩陣中其他格應停用），否則 403 `PERMISSIONS_BEYOND_YOUR_OWN`。
- 不能修改自己所屬的群組（403 `CANNOT_EDIT_OWN_GROUP`）；不能修改或刪除權限超過自己的群組（403 `GROUP_BEYOND_YOUR_PERMISSIONS`，刪除時附 `details.ids`）。
- 內建群組不可修改或刪除（`SYSTEM_GROUP_LOCKED`）；有成員的群組不可刪除（`GROUP_HAS_MEMBERS`）；名稱重複為 `GROUP_NAME_TAKEN`；不允許的權限為 `INVALID_PERMISSIONS`（`details.invalid`）。

## 6. 營運檢視（Feature 015）

### 6.1 對話內容的權限與稽核

- **問答文字**（對話標題、訊息內容）一律需要 `Conversation:read`。只有 `Feedback:read`、`ReviewItem:read` 的人看得到評分、原因、狀態等資料，看不到問答文字。
- **讀取內容會留稽核**：`conversations/:id`、`feedback/:id`、`reviewItems/:id`（有 `Conversation:read` 時）每次都寫一筆 `admin_conversation_viewed`；列表不寫。前端不要為了預覽而預先呼叫詳情 API。
- 客戶系統使用者只有 `actorId`、`organizationId`、`hostApp`，沒有姓名，直接顯示這三個值。
- 列表的 `filters.from`／`filters.to` 為 ISO 8601 時間（`from` 含、`to` 不含），前端依使用者時區換算後送出。
- 狀態、類型等代碼的中文標籤由各自的 `getFilters` 提供（`{ value, label }`），回應只回代碼。

### 6.2 對話 `conversations`（`Conversation:read`）

| Method | Path | Body／Query | 回應 `data` |
| --- | --- | --- | --- |
| POST | `conversations/getTable` | `{ page, pageSize, sort?, keyword?, filters?: { status?, hostApp?, organizationId?, actorId?, from?, to?, hasNegativeFeedback?, hasUnanswered? } }` | `{ items, total }` |
| GET | `conversations/getFilters` | — | `{ status: [{ value, label }], hostApps: [{ value, label }] }` |
| GET | `conversations/:id` | — | 對話與訊息（留稽核） |

- 列表每一列：`{ id, title, actorId, organizationId, hostApp, status, messageCount, createdAt, lastMessageAt, hasNegativeFeedback, hasUnanswered }`。`status` 預設不含 `deleted`（使用者已刪除的對話，要看時明確傳入）；`keyword` 比對標題；`sort.field` 為 `lastMessageAt`（預設，新到舊）或 `createdAt`；`period` 篩選最後訊息時間。
- `hasUnanswered`：有「無法回答」「權限不足」「工具失敗」的回答（「需澄清」不算）。
- 詳情：對話欄位加上 `truncated` 與 `messages: [{ id, role: 'user' | 'assistant', content, answerDecision, createdAt, feedback }]`。`feedback` 為該則回答的評分（`positive`／`negative`，沒有回饋為 `null`）；回饋的原因與留言在回饋頁，待審項目在待審項目頁，對話詳情不提供。訊息依時間排序；超過 500 則時只回最新 500 則，`truncated: true`。

### 6.3 統計 `stats`（`Stats:read`）

`GET stats/getSummary?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week`（日期為部署時區 `timeZone` 的日期，含頭尾，最長 366 天；週從星期一開始）：

```json
{
  "from": "2026-11-01", "to": "2026-11-30", "granularity": "day", "timeZone": "Asia/Taipei",
  "usage": { "total": { "sessions": 12, "questions": 40, "actors": 5 }, "series": [{ "period": "2026-11-01", "sessions": 1, "questions": 3, "actors": 1 }] },
  "answers": { "labels": { "answered": "已回答", "no_answer": "無法回答" }, "total": { "answered": 30, "no_answer": 5 }, "series": [{ "period": "2026-11-01", "answered": 2, "no_answer": 1 }] }
}
```

- `series` 涵蓋期間內每一天（或每一週），沒有資料為 0；`answers` 的每一筆都含全部回答結果的鍵（上例為節錄）。
- `usage.total.actors` 是整段期間的不重複人數（不是各期間相加）。使用者已刪除的對話照樣計入。
- 期間錯誤為 400 `INVALID_PERIOD`。

### 6.4 回饋 `feedback`（`Feedback:read`）

| Method | Path | Body | 回應 `data` |
| --- | --- | --- | --- |
| POST | `feedback/getTable` | `{ page, pageSize, sort?, keyword?, filters?: { rating?, hasComment?, from?, to? } }` | `{ items: [{ id, rating, reason, comment, answerDecision, createdAt, updatedAt, sessionId, messageId }], total }` |
| GET | `feedback/getFilters` | — | `{ rating: [{ value, label }] }` |
| GET | `feedback/:id` | — | 回饋欄位加 `conversation` |

- 每則回答只有一筆回饋：使用者改評分或補原因時更新同一筆，`updatedAt` 為最後一次的時間。`keyword` 比對原因與留言；`sort.field` 為 `createdAt`。
- `conversation`：有 `Conversation:read` 時為 `{ sessionId, sessionStatus, question, answer }`（`question`／`answer` 為 `{ id, content, answerDecision, createdAt }` 或 `null`），並留稽核；沒有時為 `null`。

### 6.5 待審項目 `reviewItems`（讀取 `ReviewItem:read`、更新 `ReviewItem:update`）

| Method | Path | Body | 回應 `data` |
| --- | --- | --- | --- |
| POST | `reviewItems/getTable` | `{ page, pageSize, sort?, keyword?, filters?: { status?, sourceType?, priority?, from?, to? } }` | `{ items, total }` |
| GET | `reviewItems/getFilters` | — | `{ sourceType, status, priority }`（各為 `[{ value, label }]`） |
| GET | `reviewItems/:id` | — | 項目、`suggestedImprovement`、`history`、`conversation` |
| PATCH | `reviewItems/batch` | `{ ids, status, note? }` | `{ updated }` |

- 列表每一列：`{ id, sourceType, status, priority, summary, note, createdAt, updatedAt, resolvedAt, sessionId, messageId }`（來源訊息已不存在時 `sessionId`、`messageId` 為 `null`）。`status` 預設為 `open`、`in_review`；`keyword` 比對摘要；`sort.field` 為 `createdAt`（預設）或 `priority`。
- 狀態：`open` 待處理、`in_review` 處理中、`resolved` 已解決、`dismissed` 不處理，可任意切換。改為已解決／不處理時記錄 `resolvedAt`（已是關閉狀態則保留原時間），改回其他狀態時清除。`note` 最多 500 字，有傳才覆寫。
- 批次全有或全無：任一筆找不到（或屬於其他客戶）為 404 `REVIEW_ITEM_NOT_FOUND`，`details.ids` 列出是哪幾筆。
- `history`：`[{ at, actor: { account, label }, before, after, note }]`；處理者為開發工程師時，非開發工程師看到 `{ account: null, label: '開發工程師' }`。
- `conversation` 同回饋。

### 6.6 稽核（`AuditEvent:read`）

| Method | Path | Body | 回應 `data` |
| --- | --- | --- | --- |
| POST | `auditEvents/getTable` | `{ page, pageSize, sort?, filters?: { eventType?, actorId?, sessionId?, requestId?, from?, to? } }` | `{ items, total }` |
| GET | `auditEvents/getFilters` | — | `{ eventType: [{ value, label }] }`（此客戶出現過的事件，標籤即代碼） |
| POST | `adminAuditEvents/getTable` | `{ page, pageSize, sort?, filters?: { eventType?, actorAccount?, from?, to? } }` | `{ items, total }` |
| GET | `adminAuditEvents/getFilters` | — | `{ eventType: [{ value, label }] }` |

- Assistant 稽核每一列：`{ id, timestamp, eventType, requestId, actorId, organizationId, hostApp, sessionId, messageId, decision, durationMs }`（不含 `metadata`）。
- 後台稽核每一列：`{ id, timestamp, requestId, eventType, actor: { account, label }, targetType, targetId, ipSummary, userAgentSummary, metadata }`。非開發工程師看到開發工程師為「開發工程師」（`account: null`）；對象是開發工程師帳號的事件，`targetId` 與 `metadata` 為 `null`；以 `actorAccount` 篩選時不會查出開發工程師的紀錄。
- `sort.field` 為 `timestamp`（預設，新到舊）。沒有修改或刪除稽核的 API。

## 7. 體驗設定 `experienceConfigs`（Feature 016；檢視 `ExperienceConfig:read`、編輯 `ExperienceConfig:update`）

問候語、Quick Reply 與追問建議，每個整合一份。**儲存即生效**：每次儲存產生下一個版本（`1.0.0`、`1.0.1`…，前端不需處理版本號）並立即成為 Assistant 使用的版本；舊版本保留，可回復。

| Method | Path | 權限 | Body | 回應 `data` |
| --- | --- | --- | --- | --- |
| GET | `experienceConfigs/getIntegrations` | 檢視 | — | `[{ integrationId, hostApps, current: { configVersion, source, activatedAt } \| null }]` |
| GET | `experienceConfigs/:integrationId` | 檢視 | — | `{ integrationId, hostApps, defaultGreeting, config }` |
| GET | `experienceConfigs/:integrationId/catalog` | 檢視 | — | `{ available, hostApps, capabilities }` |
| POST | `experienceConfigs/:integrationId/validate` | 編輯 | 編輯內容 | `{ valid, errors: [{ path, code }] }` |
| POST | `experienceConfigs/:integrationId` | 編輯 | 編輯內容 | `{ unchanged, integrationId, hostApps, defaultGreeting, config }` |
| POST | `experienceConfigs/:integrationId/versions/getTable` | 檢視 | `{ page, pageSize, sort?, filters?: { status?, source? } }` | `{ items, total }` |
| GET | `experienceConfigs/:integrationId/versions/:configVersion` | 檢視 | — | 版本資訊與內容 |
| POST | `experienceConfigs/:integrationId/versions/:configVersion/activate` | 編輯 | `{ baseConfigVersion }` | 同儲存 |

- **`config`**：`{ configVersion, source, createdBy, activatedAt, greeting: { text }, maxQuickReplies, quickReplies, followUps }`；還沒有設定時為 `null`，編輯畫面以 `defaultGreeting`（Assistant 預設問候語）與空的清單開始。`source` 為 `admin`（後台儲存）或 `provisioning`（部署時的設定檔）；`createdBy` 為 `{ account, label }`（開發工程師對非開發工程師顯示為 `{ account: null, label: '開發工程師' }`），設定檔寫入的版本為 `null`。
- **編輯內容**：`{ baseConfigVersion, greeting: { text }, maxQuickReplies, quickReplies, followUps }`。
  - `baseConfigVersion`：開始編輯時讀到的 `config.configVersion`（沒有設定時 `null`），必填。
  - Quick Reply：`{ id?, kind: 'capability' | 'capability_overview', label, message, priority, capabilityKey?, parameters?, pageScope?: { modules } }`；`capability_overview`（「你能查詢哪些資料？」）不帶 `capabilityKey`、`parameters`。
  - 追問建議：`{ id?, whenCapabilityKey, whenParameters?, label, message, capabilityKey, parameters? }`：回答 `whenCapabilityKey`（且參數符合 `whenParameters`）之後出現。
  - 新項目不帶 `id`，由後端產生（`qr-…`、`fu-…`）；**已有的 `id` 必須原樣送回**（已開啟的對話以 `id` 點選）。
  - 長度、數量等限制與 Feature 013 相同（標籤 40 字、訊息 200 字、問候語 500 字、Quick Reply 最多 20、追問建議最多 50、`maxQuickReplies` 1–6、`priority` 0–1000），由後端檢查。
- **能力目錄**：`capabilities: [{ capabilityKey, label, parameters: [{ name, type: 'enum', required, values: [{ value, aliases }] } | { name, type: 'bounded_string', required, maxLength }] }]`。下拉選單顯示 `label`；enum 值可顯示 `aliases[0]`。`available: false` 表示後台沒有載入此整合的 Capability Pack，此時無法儲存。
- **錯誤**：
  - 422 `EXPERIENCE_CONFIG_INVALID`：`details.errors` 為 `[{ path, code }]`，`path` 如 `$.quickReplies[1].label`，可對應到欄位。常見 `code`：`REQUIRED`、`EMPTY`、`TOO_LONG`、`OUT_OF_RANGE`（數值或項目數超出範圍）、`DUPLICATE_ID`、`UNKNOWN_KEY`、`CAPABILITY_NOT_IN_PACK`（能力不存在或已停用）、`PARAMETER_VALUE_NOT_DECLARED`、`PARAMETERS_NOT_BOUND`（這組參數沒有對應的查詢）、`NO_ACTIVE_PACK`。
  - 409 `EXPERIENCE_CONFIG_CHANGED`：開始編輯後已有人儲存或回復；請重新讀取。
  - 404 `INTEGRATION_NOT_FOUND`、`EXPERIENCE_CONFIG_VERSION_NOT_FOUND`。
- **內容沒有變更**時儲存回傳 `unchanged: true`，不產生新版本。
- **版本**（第一版前端可不做）：列表每一列 `{ configVersion, status: 'active' | 'retired', source, createdBy, createdAt, activatedAt }`，`sort.field` 為 `createdAt`（預設）或 `activatedAt`；單一版本另有 `valid`、`errors` 與內容欄位（無法解析的舊版本 `valid: false`、不含內容，回復時 422 `EXPERIENCE_CONFIG_UNREADABLE`）。回復會重新以目前的 Capability Pack 檢查。

## 8. subject 名稱的型別

前端不引用後端程式。選單與路由所需的 subject 名稱在前端以型別檔維護（`User`、`UserGroup`、`AuditEvent`、`Stats`、`Conversation`、`ReviewItem`、`Feedback`、`ExperienceConfig`），並以測試比對 `groups/getPermissions` 的回傳，避免兩邊不一致。

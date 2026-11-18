# 前端串接指南：後台管理 API（Feature 014）

給後台網站（`internal-ai-assistant-admin`，Nuxt 4 + Nuxt UI）串接用。架構見 [`docs/architecture/admin-back-office.md`](../architecture/admin-back-office.md)；本機啟動 API 後，完整的欄位說明可在 Swagger UI `http://localhost:3200/api/v1/admin/docs` 查看與試打。

## 1. 連線、登入狀態與 CSRF

- 路徑前綴 `/api/v1/admin`。正式環境網站與 API 同源（同一個網域，Nginx 轉送 `/api/v1/admin/`）。
- 登入狀態只靠 cookie，前端**不保存任何 token**：
  - `admin_session`：httpOnly，前端讀不到也不需要讀。
  - `admin_csrf`：前端可讀；所有 `POST`／`PUT`／`PATCH`／`DELETE` 都要把它的值放在 `X-CSRF-Token` header。
- 請求一律帶 cookie（`credentials: 'include'`）；API 另會檢查 `Origin` 必須是設定的後台網站來源（`ADMIN_WEB_ORIGIN`）。
- **本機開發**：建議用 Nuxt 的 dev proxy 讓網站與 API 同源，並在 API 的 `.env` 設定 `ADMIN_WEB_ORIGIN=http://localhost:3000`（Nuxt dev server 的來源），重新執行 `npm run local:start`：

  ```ts
  // nuxt.config.ts
  export default defineNuxtConfig({
    nitro: { devProxy: { '/api/v1/admin': { target: 'http://localhost:3200/api/v1/admin', changeOrigin: false } } }
  });
  ```

## 2. 回應與錯誤格式

成功：`{ "requestId": "…", "data": … }`。失敗：

```json
{ "requestId": "…", "error": { "code": "LAST_ADMIN", "message": "至少需保留一位啟用中的最高管理者。", "details": { "ids": ["…"] } } }
```

- `message` 是可以直接顯示的中文訊息；程式判斷請用 `code`。
- 欄位驗證失敗（400 `BAD_REQUEST`）時 `details.validationErrors` 列出每個欄位的錯誤。
- 批次操作（`users/batch`、`DELETE users`、`DELETE groups`）全有或全無，被拒的那幾筆在 `details.ids`。
- `401` → 導向登入頁；`403` → 顯示無權限，不登出；`404` 也用於「看不到」的資料（例如非開發工程師查開發工程師帳號）；`429 TOO_MANY_REQUESTS` → 提示稍後再試。

## 3. 登入與密碼流程

| Method | Path | Body | 回應 `data` |
| --- | --- | --- | --- |
| POST | `auth/login` | `{ account, password }` | `{ user, rules }`，並設定兩個 cookie |
| POST | `auth/logout` | — | `null` |
| GET | `auth/profile` | — | `{ user, rules }` |
| POST | `auth/verifyToken` | `{ token }` | `{ account, purpose: 'first_login' \| 'reset_password' }` |
| POST | `auth/firstLogin` | `{ token, password }` | `null` |
| POST | `auth/forgot` | `{ email }` | `{ accepted: true }`（一律相同，不透露 email 是否存在） |
| POST | `auth/reset` | `{ token, password }` | `null` |

- 開啟或重新整理需要登入的頁面時呼叫 `auth/profile`：成功就用 `rules` 建立 ability（`createMongoAbility(rules)`，`@casl/ability`）；401 就導向登入頁。
- `rules` 為 `[{ action, subject }]`，例如 `{ action: 'manage', subject: 'User' }`；開發工程師是 `{ action: 'manage', subject: 'all' }`。選單、路由與按鈕各自標註所需的 `{ action, subject }`，不要用路由名稱當 subject。
- 信件連結：首次登入 `/auth/firstLogin?token=…`、重設 `/auth/reset?token=…`。頁面讀到 token 後立即從網址移除，用 `auth/verifyToken` 取得帳號顯示；送出成功後導向登入頁。連結無效或過期時 `code` 為 `INVALID_OR_EXPIRED_LINK`。
- 密碼規則：12–128 個字元、不可與帳號相同（`PASSWORD_TOO_SHORT`、`PASSWORD_TOO_LONG`、`PASSWORD_SAME_AS_ACCOUNT`）。
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
- 帳號 3–64 字元，限英數字與 `.`、`_`、`-`，建立後不可修改；帳號與 email 不分大小寫唯一（`ACCOUNT_TAKEN`、`EMAIL_TAKEN`）。
- `inviteSent: false` 表示使用者已建立但信沒寄出，請提示管理者稍後「重寄邀請信」。
- email：`invitationPending` 為 `true` 時可修改（舊連結失效，需重寄）；已啟用後只有開發工程師能改（其他人 `EMAIL_LOCKED`），表單應改為唯讀並提示聯絡開發工程師。
- 重寄邀請只限尚未設定密碼、啟用中的使用者（`ALREADY_ACTIVATED`、`USER_DISABLED`）。
- 其他規則錯誤：`DEVELOPER_GROUP_FORBIDDEN`（403）、`CANNOT_DISABLE_SELF`、`CANNOT_DELETE_SELF`、`CANNOT_LEAVE_SYSTEM_GROUP`、`LAST_ADMIN`、`GROUP_NOT_FOUND`、`USER_NOT_FOUND`。
- 群組下拉選單用 `groups/getOptions`（見下節）。

## 5. 群組 `groups`

`group` 的形狀：`{ id, code, name, description, isSystem, permissions, memberCount, createdAt, updatedAt }`；內建群組的 `code` 為 `developer`／`admin`，自訂群組為 `null`。

| Method | Path | 權限 | Body | 回應 `data` |
| --- | --- | --- | --- | --- |
| POST | `groups/getTable` | `UserGroup:read` | `{ page, pageSize, sort?, keyword? }` | `{ items: group[], total }` |
| GET | `groups/getOptions` | `User:read` 或 `UserGroup:read` | — | `[{ id, label, isSystem }]` |
| GET | `groups/getPermissions` | `UserGroup:read` | — | `[{ subject, label, actions }]` |
| GET | `groups/:id` | `UserGroup:read` | — | `group` |
| POST | `groups` | `UserGroup:create` | `{ name, description?, permissions }` | `group` |
| PATCH | `groups/:id` | `UserGroup:update` | `{ name?, description?, permissions? }` | `group` |
| DELETE | `groups` | `UserGroup:delete` | `{ ids }` | `{ deleted }` |

- 權限矩陣以 `groups/getPermissions` 產生（列為 subject、欄為 action），不要寫死在前端；`permissions` 送 `subject:action` 字串，例如 `["User:read", "Conversation:read"]`。
- 內建群組不可修改或刪除（`SYSTEM_GROUP_LOCKED`）；有成員的群組不可刪除（`GROUP_HAS_MEMBERS`）；名稱重複為 `GROUP_NAME_TAKEN`；不允許的權限為 `INVALID_PERMISSIONS`（`details.invalid`）。

## 6. subject 名稱的型別

前端不引用後端程式。選單與路由所需的 subject 名稱在前端以型別檔維護（`User`、`UserGroup`、`AuditEvent`、`Stats`、`Conversation`、`ReviewItem`、`Feedback`、`ExperienceConfig`），並以測試比對 `groups/getPermissions` 的回傳，避免兩邊不一致。

# 前端串接指南：Assistant 對話體驗（Feature 013）

給 `internal-ai-assistant`（聊天介面／SDK）串接用。所有路徑都經過 Gateway（`/api/v1/assistant/...`），身分與權限照舊由 Gateway 驗證，前端不需要也不能傳任何權限資訊。所有變更都是**新增欄位或新端點**：沒有設定體驗設定的客戶，回應與現在完全相同。

架構說明見 [`docs/architecture/assistant-conversation-experience.md`](../architecture/assistant-conversation-experience.md)。

## 1. 開場問候與 Quick Reply

`POST /sessions`（現有）回應的 `data` 多一個 `opening`：

```json
{
  "requestId": "…",
  "data": {
    "sessionId": "…",
    "status": "active",
    "opening": {
      "configVersion": "1.0.0",
      "greeting": "你好，我可以協助查詢訂單資訊。",
      "quickReplies": [
        { "id": "overview", "label": "你能查詢哪些資料？" },
        { "id": "order-status-10001", "label": "訂單 SO-10001 的狀態" }
      ]
    }
  }
}
```

- 建立 session 時照舊送 `pageContext`；`pageContext.module` 決定哪些 Quick Reply 只在特定頁面出現（例如只在 `orders` 頁）。
- 把 `greeting` 顯示成第一則助理訊息，`quickReplies` 顯示成按鈕。
- 問候語與選項是各客戶的設定（`customers/<customer>/assistant-experience/<version>.json`，部署時寫入該客戶的資料庫），由後端在執行時回傳；本文件的範例內容僅供說明格式。前端程式對所有客戶相同。
- 沒有設定時：`configVersion: null`、Core 預設問候、`quickReplies: []`。使用者沒有任何可用功能時，`quickReplies` 也是空的。
- **只顯示伺服器給的選項**，不要在前端寫死或快取選項；選項已依目前使用者的權限篩選。

## 2. 點擊選項：送 `choiceId`

`POST /sessions/:id/messages`（現有）的 body 改成 `message` 與 `choiceId` **二選一**：

```json
{ "choiceId": "order-status-10001", "pageContext": { "module": "orders" } }
```

- 使用者點 Quick Reply 或延伸建議時送 `choiceId`；使用者自己打字時照舊送 `message`。兩者同時送或都不送會回 400。
- 先在畫面上顯示該按鈕的 `label` 作為使用者訊息即可。伺服器會把設定中的完整問句存成使用者訊息，所以之後讀歷史時看到的文字可能和 label 不同。
- 回應仍是同一條 SSE 串流，處理方式不變。
- `choiceId` 不存在、已不在目前的設定中、或使用者已沒有權限：回 **404**（與 session 不存在相同）。建議前端移除該按鈕，並提示使用者直接輸入問題。
- `choiceId` 格式：小寫英數字開頭，可含 `.`、`_`、`-`，最多 64 字。

## 3. 回答後的建議（延伸建議、能力總覽）

SSE `final` 事件的 `data` 可能多一個 `suggestions`（沒有時不會出現這個欄位）：

```json
{ "answerDecision": "answered", "answer": "…", "evidenceRefs": ["…"],
  "suggestions": [{ "id": "follow-order-10002", "label": "看 SO-10002" }] }
```

會出現的情況：
- 成功回答後：設定的延伸建議（最多 3 個）。
- 使用者問「你能查什麼」：能力總覽的文字回答，加上可直接點的查詢選項。
- 助理無法辨識問題時：可直接點的查詢選項。

點擊方式和 Quick Reply 相同（送 `choiceId`）。建議只掛在**最新一則**助理回答下方；使用者送出下一則訊息後就隱藏舊的建議。讀取歷史訊息時不會帶回建議。

## 4. 對話紀錄列表

`GET /sessions?limit=20&cursor=…`（新）：

```json
{
  "requestId": "…",
  "data": {
    "sessions": [
      { "sessionId": "…", "title": "查詢訂單 SO-10001 狀態",
        "createdAt": "2026-11-16T02:00:00.000Z", "lastMessageAt": "2026-11-16T02:05:00.000Z" }
    ],
    "nextCursor": "eyJ0Ijoi…"
  }
}
```

- 只列出目前使用者自己、**至少有一則訊息**、未封存的 session，依最後訊息時間由新到舊。打開助理但沒發問的 session 不會出現。
- `title` 是第一則使用者訊息的前 40 個字，可能為 `null`（理論上列出的都有標題，仍請做預設顯示）。
- `limit` 1–50，預設 20。`nextCursor` 為 `null` 表示沒有下一頁；有值時原樣帶回 `cursor`，不要解析或自行組合。cursor 或 limit 不合法回 400。
- 點擊列表項目後，照舊用 `GET /sessions/:id` 與 `GET /sessions/:id/messages` 讀取並還原對話。還原舊對話時不會有開場 Quick Reply。

## 5. 封存對話

`POST /sessions/:id/archive`（新），不帶 body 與 query：

```json
{ "requestId": "…", "data": { "sessionId": "…", "status": "closed" } }
```

- 成功後從列表移除該項目。封存後對該 session 送訊息或讀取會回 404，前端應開新的 session。
- session 不存在、已封存或不屬於該使用者：404。

## 5a. 已封存、取消封存與刪除

- `GET /sessions?status=archived&limit&cursor`：列出已封存的對話，格式與第 4 節相同。`status` 只接受 `archived`，其他值回 400。
- `POST /sessions/:id/unarchive`（不帶 body 與 query）：把已封存的對話移回一般列表，回 `{ sessionId, status: "active" }`。對話不存在、不是已封存、或不屬於該使用者：404。已封存的對話要先取消封存才能開啟。
- `DELETE /sessions/:id`（不帶 body 與 query）：刪除一般或已封存的對話，回 `{ sessionId, status: "deleted" }`。刪除後兩個列表都不會出現，也無法讀取或取消封存（404）；後端仍保留資料作為稽核紀錄，使用者無法復原。

## 5b. 回饋

`POST /messages/:messageId/feedback`（Gateway 轉送到 Core 的同一路徑）：

```json
{ "rating": "negative", "intent": "not_helpful", "reason": "答非所問", "comment": "…" }
```

- `rating` 必填（`positive`、`negative`、`neutral`）；`intent`（`correction`、`unsafe`、`not_helpful`、`missing_evidence`、`other`）、`reason`（最多 160 字）、`comment`（最多 1000 字）可省略；其他欄位與 query 一律回 400。
- 成功回 201：`{ requestId, data: { feedbackEventId, messageId, rating, intent, reviewItemId } }`；負評會建立待審項目（`reviewItemId`）。
- 訊息不存在或不屬於該客戶：404；不是助理的回答：400。

## 6. 錯誤與相容性

- 錯誤格式與現有端點相同：`{ requestId, error: { code, message } }`；Gateway 層的身分錯誤照舊（401／403／503）。
- 新的 Gateway 必須搭配新的 Core 部署（Core 先更新）。如果在舊環境測試時看到 `choiceId`、列表或封存回 400／503，請先確認 Core 版本。

## 7. 前端檢查清單

- [ ] 開新 session 顯示 `greeting` 與 `quickReplies`；空陣列時不顯示按鈕區。
- [ ] 點選項送 `choiceId`（不送 `message`），並帶目前頁面的 `pageContext`。
- [ ] `final.suggestions` 顯示在最新回答下方，送出下一則訊息後隱藏。
- [ ] `choiceId` 回 404 時移除按鈕並提示改用輸入。
- [ ] 對話紀錄列表分頁（`nextCursor`），點擊後還原對話。
- [ ] 封存後從列表移除，並在目前畫面開新 session。

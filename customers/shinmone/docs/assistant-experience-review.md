# Shinmone Assistant 體驗設定審核（Feature 013）

**設定檔**：`customers/shinmone/assistant-experience/1.0.0.json`
**狀態**：`HUMAN_VERIFIED`（2026-11-16 由產品負責人確認全部問題；AI 僅依確認結果更新檔案）
**對應 pack**：`capability-packs/shinmone-scm-kpistats/1.0.0.json`（`shinmone.dashboard.kpistats.snapshot`，today / this_week / this_month）

技術驗證已通過：每個選項宣告的能力與參數都能解析到 active binding（`test/contract/shinmone-assistant-experience.contract.spec.ts`）。以下為需要人工確認的內容；全部問題已確認，`semanticReviewStatus` 已改為 `HUMAN_VERIFIED`，可 provision 到正式環境。之後任何文案或選項變更都須提高 `configVersion` 並重新審核。

## 需要確認的問題

1. **問候語**：「你好，我是 SCM 系統的 AI 助理，可以協助查詢儀表板的工單統計。」——**已確認符合**（2026-11-16）。
2. **Quick Reply 的文字與順序**：「工單統計」涵蓋整體資料，改為具體指標——**已確認**（2026-11-16）：你能查詢哪些資料？／今天新增幾張工單？（今天）／目前逾期工單有幾張？（今天）／本月完工幾張工單？（本月）。
   - 三個指標按鈕都執行同一個 KPIStats 能力（一次回傳六項指標），按鈕文字作為使用者問題，回答時只挑出相關指標。
   - 逾期工單依 Dashboard「截至今天結束」口徑，不分期間，所以按鈕不寫期間。
   - 不放出貨：`TodayShipments` 的計算口徑仍待確認（`business-semantic-catalog.md` Q5）。
3. **頁面限制**——**已決定要設定**（2026-11-16），三個指標按鈕只在 Dashboard 頁出現，「你能查詢哪些資料？」在所有頁面出現。Dashboard 頁的 `pageContext.module` 實際值為 `dashboard`——**已確認**（2026-11-16）；Shinmone 前端以各頁的 route 填入 `module`。
4. **延伸建議組合**：今天 → 本週、本月；本週 → 今天、本月；本月 → 本週——**已確認**（2026-11-16）。延伸建議的條件只看期間、不看指標，所以文字維持「那本週呢？」「看本月」這類不指定指標的說法。
5. **顯示數量**：`maxQuickReplies` 最多 4 個——**已確認**（2026-11-16）。

## 另列待辦（不屬於 Feature 013）

- **Pack 語意資料不足**：正式 pack 的確定性語意解析無法辨識常見問法（包含 pack 自身範例「查詢儀表板已核准統計資料」），目前依賴 LLM 工具選擇。建議另出 pack 版本補充中文別名、範例、意圖詞與指標詞（需人工確認）。Feature 013 的 Quick Reply 與延伸建議以宣告的能力執行，不受此影響（spec Decision 4）。

## 審核紀錄

| 日期 | 審核人 | 結論 |
|---|---|---|
| 2026-11-16 | 產品負責人（對話中確認） | 問題 1、2、4、5 確認；問題 3 待確認 Dashboard 的 module 值 |
| 2026-11-16 | 產品負責人（對話中確認） | 問題 3 確認（`module` = `dashboard`）；全部確認，標記 `HUMAN_VERIFIED` |

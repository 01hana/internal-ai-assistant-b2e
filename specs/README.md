# Specs 索引

每個 feature 一個資料夾，依 speckit 流程產出 `spec.md`（要做什麼）、`design.md`（在系統裡怎麼做）、`plan.md`（階段與關卡）、`tasks.md`（逐項工作與完成證據）。

- **合併回 main 後即凍結**：只作為「當初為什麼這樣設計」的歷史紀錄，不再修改。
- **描述系統現況的文件**放在 `docs/`，由它持續更新。
- 目前進行中的 feature 記錄在 `.specify/feature.json`。

開發期間取自該資料夾的第一個 commit 與 `tasks.md` 的最後一個 commit。「延後項目」是 `tasks.md` 中刻意未執行、需另行審核的 task，細節見各自的 `tasks.md`。

| 編號 | 功能 | 狀態 | 開發期間 | 合併回 main | 延後項目 |
|---|---|---|---|---|---|
| 001 | internal-assistant-core | 完成 | 2026-06-12 – 06-23 | 2026-08-07（PR #1） | — |
| 002 | customer-scoped-assistant-core | 完成 | 2026-08-03 – 08-07 | 2026-08-07（PR #2） | — |
| 003 | identity-gateway-customer-registry | 完成 | 2026-07-30 – 08-12 | 2026-11-14 | — |
| 004 | customer-integration-contract | 完成 | 2026-08-17 – 08-18 | 2026-11-14 | — |
| 005 | managed-identity-exchange | 完成 | 2026-08-20 – 08-25 | 2026-11-14 | — |
| 006 | idx-production-provider-session-bootstrap | 完成 | 2026-08-25 – 08-27 | 2026-11-14 | — |
| 007 | customer-identity-bridge | 完成（有延後項目） | 2026-08-28 – 09-01 | 2026-11-14 | T065–T088 |
| 008 | generic-host-integration-data-adapter-foundation | 完成（有延後項目） | 2026-09-07 – 09-09 | 2026-11-14 | T013 |
| 009 | productized-business-connector-runtime | 完成（有延後項目） | 2026-09-10 – 09-16 | 2026-11-14 | T126–T142（live staging，需人工審核） |
| 010 | conversational-context-grounded-retrieval | 完成 | 2026-09-16 – 09-18 | 2026-11-14 | — |
| 011 | customer-capability-semantic-discovery | 完成（有延後項目） | 2026-09-25 – 10-02 | 2026-11-14 | T078–T100（Phase G/H/I） |
| 012 | grounded-llm-conversation-sse-streaming | 完成 | 2026-10-04 – 10-07 | 2026-11-14 | — |
| — | post-feature012-consolidation（無 spec） | 完成 | 2026-10 – 11-14 | 2026-11-14 | — |
| 013 | assistant-conversation-experience | 完成（後端） | 2026-11-15 – 11-16 | — | 前端串接（internal-ai-assistant） |

新 feature 開始時在表格新增一列；合併回 main 時更新狀態與日期。

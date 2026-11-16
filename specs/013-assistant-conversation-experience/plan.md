# Implementation Plan: Feature 013 — Assistant Conversation Experience

**Canonical Feature Path**: `specs/013-assistant-conversation-experience`
**Branch**: `013-assistant-conversation-experience` | **Date**: 2026-11-15
**Status**: Approved spec（2026-11-15）；plan 待人工確認
**Spec**: `specs/013-assistant-conversation-experience/spec.md`
**Design**: `specs/013-assistant-conversation-experience/design.md`

## Summary

先抽出一個「可用能力」服務作為所有體驗功能的權限來源，再新增可版本化的體驗設定表與 provisioning 指令。之後依序交付開場語與 Quick Reply、能力總覽三層判斷、延伸建議、Session 列表與封存、未支援問題收集。所有公開 API 只新增欄位與端點；Gateway 的固定路由白名單與送訊息欄位同步擴充。

## Technical Context and Existing Interfaces

- **Platform**：TypeScript 6、NestJS 11、Prisma 7.10 / PostgreSQL 16、Jest（unit / integration / contract / eval）。公開入口 `/api/v1/assistant/**` 經 Gateway 轉發到 Core。
- **可用能力的現有實作**：`LlmToolSelectionService.resolveOffered()`（`src/query-understanding/llm-tool-selection.service.ts`）已完整實作 spec FR-001 的判斷：active binding → active capability → `ToolRegistryService.resolveExactToolForCustomer` → 唯讀可執行 → `requiredRoles` → `requiredPermissionScopes` → result policy 與 permission mask。它目前是 private 且只在 LLM 開關開啟時被用到。本 plan 把它抽成 `AvailableCapabilityService`，LLM 選擇改為呼叫新服務，行為不變。
- **能力總覽現況**：`classifyControlledConversation()`（`src/query-understanding/rule-based-query-understanding.pipeline.ts`）以整句清單比對；`capability_discovery` 回答依賴 `llmToolSelection.describeAvailable()`。
- **Session**：`AssistantSessionService` 已有 `listVisibleSessions`（無分頁）、`closeVisibleSession`（無 API）。`AssistantSessionStatus` 已有 `closed`，封存沿用此狀態，不新增 enum 值。
- **ReviewItem**：`ReviewItemService.createFromAssistantOutcome` 只在 `no_answer` gate 呼叫（`assistant-message.service.ts`）。
- **SSE**：`final` 由 `assistant-sse-event.builder.ts` 組成，`finalData` 型別在 `assistant-sse.types.ts`。
- **Gateway**：`apps/gateway/src/backend-client/backend-route-definition.ts` 是固定四條路由的白名單；`gateway-assistant.controller.ts` 的 `readSendMessageInput` 只讀 `message`、`pageContext`。新增端點與欄位必須在這兩處一起加，否則公開路徑無法使用。
- **既有 provisioning 模式**：`src/tools/provision-customer-tool-policy.command.ts` + `scripts/provision-customer-tool-policy.ts`。體驗設定 provisioning 比照此模式。

## Constitution Check

- **C1 可維護架構**：新增 `src/assistant-experience/` 模組，只依賴 capabilities / tools / prisma / audit；不在 Core 出現客戶分支。
- **C2 測試先行**：每個 task 先有 RED 測試（既有正確行為記為 EXISTING GREEN，不刻意弄壞）。
- **C3 Trusted Identity**：所有可見性判斷只用已驗證的 host context；`quickReplyId`、`origin` 不提供任何權限，伺服器重新檢查。
- **C4 API 一致性**：只新增欄位與端點；舊 contract 測試預期值不得修改（SC-003）。
- **C5 品質可衡量**：體驗設定在 provisioning 時以能力解析驗證每則 `message`；US5 收集未支援問題。
- **C6 全鏈路可稽核**：新增 `quick_reply_selected`、`suggestion_selected`、`session_archived`；`session_created` 記錄設定版本與顯示的 Quick Reply。
- **C7 人工介入**：不新增寫入類工具；客戶文案正式上線前需 `HUMAN_VERIFIED`。

**Schema 變更已由 spec 核准**（FR-002、FR-009、FR-010）：一支只新增的 migration。超出此範圍的 schema 變更須停下審查。

## Design

詳細設計（D1–D9 與既有元件處置表）見 `design.md`。

## Phases and Gates

| Phase | 內容 | Gate（全部通過才進下一階段） |
|---|---|---|
| 0 | US0 基線整理 | 保留的安全檢查仍會抓到違規；`specs/README.md` 完成；全套測試結果不比 baseline 差 |
| 1 | D1 抽出服務、D2 migration、D3 設定模組與 provisioning | LLM 選擇行為等價；provisioning 正反案例通過；migration 可在測試 DB 套用 |
| 2 | US1（D4 + D9 的 session/message 部分） | US1 情境 1–7、跨客戶隔離、舊 contract 未改 |
| 3 | US2（D5） | US2 情境 1–8；SC-002、SC-006 正反問句表通過 |
| 4 | US3（D6） | US3 情境 1–5 |
| 5 | US4（D7 + D9 列表／封存） | US4 情境 1–5、跨客戶隔離 |
| 6 | US5（D8） | US5 情境 1–4；`clarification-required` 更新 |
| 7 | 收尾 | SC-001～SC-006；Core 全套 + `customers/shinmone` 測試 + typecheck；文件更新 |

每個 Gate 通過後，由 Claude stage 該階段檔案並提供 commit message，使用者手動 commit / push。

## Risks

- **抽出 `resolveOffered` 改變 LLM 選擇行為**：Phase 1 先寫等價測試（同輸入同 offered 清單）才搬移。
- **規則層句型過寬**：SC-006 的反向問句表為必要 Gate；新增句型必須同時新增反向案例。
- **`ADD VALUE` enum 在部分環境需非 transaction 執行**：migration 單獨一支，並在測試 DB 與 deploy 的 `migrate` 流程驗證。
- **Gateway 與 Core 版本需同時部署**：新端點在 Gateway 未升級前會回 404，舊前端不受影響；部署順序為 Core → Gateway（runbook 第 8 節照常）。

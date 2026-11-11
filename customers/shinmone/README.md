# Shinmone（新模）

新模委外託工系統（SCM）的 AI 助理整合資料。放置規則見 repo 根目錄的 `AGENTS.md`。

## 客戶範圍

| 環境 | customerId | integrationId | hostApp |
| --- | --- | --- | --- |
| Demo（192.168.10.110） | `customer-shinmone` | `shinmone-scm-assistant` | `shinmone-scm` |
| 本機開發 | `customer-shinmone-scm-local` | `shinmone-scm-assistant-local` | `shinmone-scm` |

目前上線能力：Dashboard KPIStats 六指標統計（`/Dashboard/KPIStats`，期間 today / thisWeek / thisMonth），唯讀，需 `menu:SCM_DASHBOARD:read`。

## 目錄內容

| 路徑 | 內容 |
| --- | --- |
| `capability-packs/shinmone-scm-local/1.0.0.json` | 本機開發用 pack（`work-orders.count`） |
| `capability-packs/shinmone-scm-kpistats-demo/1.0.0.json` | 本機 KPIStats Demo pack |
| `docs/` | onboarding 紀錄：業務語意目錄、審核批次、信任邊界驗證、`work-orders.count` 驗收 |
| `scripts/provision-shinmone-kpistats-local.ts` | 本機 KPIStats provisioning（`npm run kpistats:local:provision`），不是正式環境初始化 |
| `test/` | 新模專屬的 unit / contract / integration 測試，以及其 fixtures 與 support |

執行新模測試：`npm test -- customers/shinmone`

## 尚未搬入此目錄的新模檔案（已知例外）

這些檔案因為綁定建置或部署流程，暫時留在原處。搬移時需同步修改建置設定，並在下次部署前重新驗證映像。

| 位置 | 原因 |
| --- | --- |
| `apps/customer-connector-runtime/integrations/shinmone/` | Connector 程式與 manifest；`apps/customer-connector-runtime/Dockerfile` 的 CMD 指向 `dist/integrations/shinmone/production.main.js` |
| `apps/customer-connector-runtime/test/integrations/shinmone-*.spec.ts` | 測試上述 Connector 程式，跟程式一起搬 |
| `src/customer-query-scope/` | 公司範圍規則寫在 Core，且只註冊本機 customerId；應改為客戶設定驅動 |
| `deploy/demo/`（含 `production-pack/`、`provision/`） | Demo 部署腳本與正式 pack，正用於 192.168.10.110 |
| `dev/connector-local/`、`dev/local-assistant/` | 本機開發工具 |
| `scripts/seed.ts` | 新模 Tool 定義（產品端的全域 Tool 註冊） |
| Core 測試使用新模 fixture：`test/unit/connectors-module.spec.ts`、`test/unit/llm-tool-selection.service.spec.ts`、`test/unit/query-scope-validation.service.spec.ts`、`test/integration/feature011-*.spec.ts`、`test/integration/llm-tool-selection.live.spec.ts`、`test/eval/feature011-capability-resolution.eval.spec.ts` | 這些是 Core 測試，但以新模 pack 當測試資料；之後應改用合成客戶 fixture |
| `test/unit/shinmone-reference-boundary.guard.spec.ts` | Core 架構守門測試（確認通用程式不含新模假設），屬於 Core，留在原處 |

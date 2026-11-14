# Shinmone（新模）

新模委外託工系統（SCM）的 AI 助理整合資料。放置規則見 repo 根目錄的 `AGENTS.md`。

## 客戶範圍

| 環境 | customerId | integrationId | hostApp |
| --- | --- | --- | --- |
| Demo（公司 Demo 主機） | `customer-shinmone` | `shinmone-scm-assistant` | `shinmone-scm` |
| 本機開發 | `customer-shinmone-scm-local` | `shinmone-scm-assistant-local` | `shinmone-scm` |

目前上線能力：Dashboard KPIStats 六指標統計（`/Dashboard/KPIStats`，期間 today / thisWeek / thisMonth），唯讀，需 `menu:SCM_DASHBOARD:read`。

## 目錄內容

| 路徑 | 內容 |
| --- | --- |
| `capability-packs/shinmone-scm-local/1.0.0.json` | 本機開發用 pack（`work-orders.count`） |
| `capability-packs/shinmone-scm-kpistats-demo/1.0.0.json` | 本機 KPIStats Demo pack |
| `capability-packs/shinmone-scm-kpistats/1.0.0.json` | 正式部署用 Active pack（與 Demo pack 能力相同，使用正式 customerId / integrationId）；交付時上傳到主機的 `DEMO_CAPABILITY_PACK_DIR/shinmone-scm-kpistats.json` |
| `docs/` | onboarding 紀錄：業務語意目錄、審核批次、信任邊界驗證、`work-orders.count` 驗收 |
| `query-scope/company-scope.local.v1.json` | 本機公司範圍規則：`work-orders.count` 只允許查詢登入公司 |
| `query-scope/company-scope.demo.v1.json` | Demo 公司範圍規則：KPIStats 三個期間只允許查詢登入公司（**已準備，未啟用**） |
| `scripts/provision-shinmone-kpistats-local.ts` | 本機 KPIStats provisioning（`npm run kpistats:local:provision`），不是正式環境初始化 |
| `test/` | 新模專屬的 unit / contract / integration 測試，以及其 fixtures 與 support |

執行新模測試：`npm test -- customers/shinmone`

## 尚未搬入此目錄的新模檔案（已知例外）

這些檔案因為綁定建置或部署流程，暫時留在原處。搬移時需同步修改建置設定，並在下次部署前重新驗證映像。

| 位置 | 原因 |
| --- | --- |
| `apps/customer-connector-runtime/integrations/shinmone/` | Connector 程式與 manifest；`apps/customer-connector-runtime/Dockerfile` 的 CMD 指向 `dist/integrations/shinmone/production.main.js` |
| `apps/customer-connector-runtime/test/integrations/shinmone-*.spec.ts` | 測試上述 Connector 程式，跟程式一起搬 |
| `deploy/demo/`（含 `provision/`） | Demo 部署腳本，正用於公司 Demo 主機。正式 pack 已移到 `capability-packs/shinmone-scm-kpistats/`；`provision/tool-catalog.json` 由 `deploy/demo/prepare-delivery.sh` 產生 |
| `dev/connector-local/`、`dev/local-assistant/` | 本機開發工具 |
| `scripts/seed.ts` | 新模 Tool 定義（產品端的全域 Tool 註冊） |
| Core 測試使用新模 fixture：`test/unit/connectors-module.spec.ts`、`test/unit/llm-tool-selection.service.spec.ts`、`test/unit/query-scope-validation.service.spec.ts`、`test/integration/feature011-*.spec.ts`、`test/integration/llm-tool-selection.live.spec.ts`、`test/eval/feature011-capability-resolution.eval.spec.ts` | 這些是 Core 測試，但以新模 pack 當測試資料；之後應改用合成客戶 fixture |
| `test/unit/shinmone-reference-boundary.guard.spec.ts` | Core 架構守門測試（確認通用程式不含新模假設），屬於 Core，留在原處 |

## 公司範圍規則（query-scope）

規則判斷由 Core 的通用引擎（`src/query-scope/company-scope.policy.ts`）執行；這裡只提供詞彙與要套用的工具。它只會把已授權的請求進一步收窄為允許、要求澄清或拒絕，不會授予任何權限。

- 兩份設定的詞彙相同，皆沿用原本 Core 內的 C01 規則，另把「查詢」「查看」列為完整動詞（修正「請查詢今日…」被誤判為範圍不明）。
- Demo 設定另在 `scopeAnchorTerms` 加入 KPIStats 指標詞（完工、完工率、生產中、逾期、出貨），用來偵測「查某某的完工率」這類指定對象的問法。**這些詞尚待業務確認（AI_INFERRED）。**
- 追問不受限（2026-11-11 產品決定）：以「那…」「剛才…」等開頭、沒有指名對象的追問（例：「那本週呢？」）沿用登入公司範圍直接允許；原 C01 規則中「追問一律要求澄清」的條件已從通用引擎移除。追問中若指名其他公司（「那別家公司呢？」）仍依公司判斷拒絕，指稱不明（「那那家公司呢？」）仍要求澄清。唯一例外：若同一對話的上一句因公司範圍被拒絕或要求澄清，下一句沒明確寫出「本公司」的問句會先要求確認，避免使用者把本公司的數字誤讀為另一家公司的（判斷在 Core 的 `QueryScopeValidationService`，依上一句的 `query_scope_validation_completed` 稽核紀錄）。`docs/assistant-side-trust-boundary-verification.md` 記錄的是變更前的驗證結果。

### 啟用 Demo 設定（尚未執行）

1. 將 `company-scope.demo.v1.json` 以唯讀方式掛進 Core 容器，例如 `/app/customer-query-scope/company-scope.demo.v1.json`（Core 映像目前不包含此目錄）。
2. Core 環境變數設定 `ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON=["/app/customer-query-scope/company-scope.demo.v1.json"]`（必須是絕對路徑）。
3. 移除 `deploy/demo/config/core.env` 中已無作用的 `SHINMONE_C01_QUERY_SCOPE_POLICY_ENABLED`。
4. 設定檔格式錯誤、路徑不存在或與其他設定重複套用同一工具時，Core 會拒絕啟動（fail closed）。

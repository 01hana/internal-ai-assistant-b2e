<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

# Customer artifacts（客戶整合資料放置規則）

本 repo 分成「通用 Core」與「客戶資料」兩部分。新增或修改任何客戶整合時，Codex、Claude 與人工一律依此規則放置。

## 1. 客戶資料一律放在 `customers/<customer>/`

`<customer>` 用小寫英數與連字號（例：`shinmone`）。一個客戶一個資料夾，結構固定：

```
customers/<customer>/
  README.md               客戶範圍（customerId / integrationId / hostApp）、檔案索引、尚未搬入的例外
  capability-packs/       Capability Pack（<packId>/<version>.json），部署時掛到容器的 /app/customer-capability-packs
  query-scope/            公司範圍規則設定（company-scope.<environment>.v1.json），由 ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON 載入
  docs/                   onboarding 紀錄：來源清單、業務語意目錄、Human Review 問題與結論、驗收紀錄
  scripts/                僅供此客戶使用的 provisioning / 維運腳本
  test/
    unit/ contract/ integration/   此客戶的測試（jest 會自動收錄 customers/*/test/**/*.spec.ts）
    fixtures/                      此客戶的測試 pack、tool catalog 等資料
    support/                       此客戶的測試 helper
```

## 1-1. 目前無法放進 `customers/` 的客戶資料（新客戶也照此放置）

| 內容 | 目前位置 | 原因 |
| --- | --- | --- |
| Connector 程式與 operation manifest | `apps/customer-connector-runtime/integrations/<customer>/` | Connector Runtime 只建置此目錄（`apps/customer-connector-runtime/tsconfig.json` 的 `include`）。待 Connector 改為從 `customers/<customer>/connector/` 建置後再遷移 |
| 上述 Connector 的測試 | `apps/customer-connector-runtime/test/integrations/<customer>-*.spec.ts` | 由 Connector Runtime 的 jest 設定執行 |
| Tool 定義（全域 Tool 註冊） | `scripts/seed.ts` | 產品端集中管理的全域 Tool 清單；註冊 Tool 不代表授權給任何客戶 |
| CustomerToolPolicy、權限對應、Customer / Integration 紀錄 | 資料庫（以 operator 指令 provisioning） | 執行期授權資料，不是 repo 檔案；provisioning 腳本放 `customers/<customer>/scripts/` |
| API 憑證 | 客戶端 credential provider | 不進 repo，只記錄 profile 名稱 |
| 部署設定（pack 掛載目錄、環境變數） | 各部署環境（例：`deploy/<environment>/`） | 依環境而非依客戶管理 |

以上位置之外，新客戶的檔案一律放 `customers/<customer>/`。

## 2. Core 不得出現客戶專屬內容

Core 指 `src/`、`test/`（客戶以外的測試）、`scripts/`、`packages/`、`apps/*/src/`。唯一例外是 1-1 節列出的 `scripts/seed.ts` Tool 定義（Tool 的描述與 output schema 可以描述該 API 的欄位，但不得含客戶業務邏輯或授權）。在這些位置：

- 不得新增客戶名稱、客戶詞彙或範例問句、客戶 API 路徑或回應欄位、客戶專屬權限或角色。
- 不得以 `customerId`、`integrationId`、`hostApp` 做 `if` / `switch` 分支。
- Core 程式與 Core 測試不得 import `customers/` 底下的任何檔案。客戶測試可以 import Core。
- 若接入某客戶「必須」修改 Core（新的安全或執行機制、schema 變更），停下來提出架構審查，不要用客戶分支繞過。

## 3. 業務語意的審核狀態

依 `docs/customer-onboarding/onboarding-guide.md`：

- AI 工具（Codex、Claude）可以產生 `AUTO_EXTRACTED`（從 Swagger / 原始碼抽出的技術事實）與 `AI_INFERRED`（推測的業務語意）內容。
- 只有標記為 `HUMAN_VERIFIED` 的語意可以寫進正式 Capability Pack、Tool 描述或 Connector 對應。
- AI 工具不得自行把任何項目標為 `HUMAN_VERIFIED`；不確定的項目標 `NEEDS_HUMAN_REVIEW` 並寫出具體的 Human Review 問題。
- 來源、審核人與日期記在 `customers/<customer>/docs/`。

## 4. 機密與資料

不得提交憑證、token、金鑰或真實客戶資料。憑證只記錄 reference 或 profile 名稱。`.local-secrets/`、`.local-state/` 不進版控，也不得引用其內容到文件中。

## 5. 新客戶接入流程

1. 建立 `customers/<customer>/README.md`，寫清楚客戶範圍與負責人。
2. 依 `docs/customer-onboarding/onboarding-guide.md`、`capability-onboarding-checklist.md` 產出來源清單與語意目錄（放 `docs/`）。
3. 語意經 Human Review 後，才寫 `capability-packs/` 與對應的 Tool / Connector 設定。
4. 在 `test/` 補齊正向、反向、缺參數、不支援期間、追問、跨客戶隔離案例。
5. 驗證：`npx tsc --noEmit -p tsconfig.spec.json`、`npm test -- customers/<customer>`，以及 Core 全套 `npm test`（確認沒有影響其他客戶）。

## 6. 已知例外（尚未搬入 `customers/`，不得仿效）

以下是第一個客戶（新模 / Shinmone）在本規則建立前留下的位置（不含 1-1 節列出的正常位置）。新客戶不得照這些位置放檔案，也不得新增同類例外。清單維護在 `customers/shinmone/README.md`：

- `deploy/demo/`、`dev/`（Demo 部署與本機工具）
- 部分 Core 測試使用新模 fixture 當測試資料（例：`test/unit/connectors-module.spec.ts`、`test/integration/feature011-*.spec.ts`）

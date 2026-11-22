# Implementation Plan: Feature 016 — Admin Experience Config

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Branch**: `016-admin-experience-config`（自 main 分出）

## Summary

在後台 API 提供體驗設定（問候語、Quick Reply、追問建議）的檢視、編輯與版本回復；儲存即生效。沿用 013 的版本表、parser 與 validator；後台 process 載入 Capability Pack 以提供能力目錄與驗證。provisioning 指令改為只提供初始值。

## Technical Context

- 沿用 014／015：NestJS 11、Prisma 7、CASL、後台 envelope 與錯誤格式；`semver` 由間接相依改為直接相依（使用者 `npm install semver`）。
- 一支只新增欄位的 migration（`source`、`createdByUserId`）；使用者在 Mac 執行 `prisma generate` 與 migrate。
- DB 測試以 `RUN_DB_BACKED_ADMIN_TESTS=true` 啟用；測試用 Pack 使用既有的 fixture。

## Constitution Check

- 客戶專屬內容：無；設定文字只存在資料庫與 `customers/<客戶>/`。
- 後台只放行驗證需要的 Core 檔案，並以架構測試確認不載入 Assistant runtime。
- 驗證規則只有一份（013 的 parser／validator）。
- 每次修改留稽核，稽核失敗不生效。

## Phases and Gates

| Phase | 內容 | Gate |
| --- | --- | --- |
| 0 | 基線、migration、repository 擴充、`DEFAULT_ASSISTANT_GREETING` 搬移、後台載入 Pack 與架構測試、稽核事件 | Gate 0：migration 與 schema 一致、ledger、架構測試、013 與後台既有測試 |
| 1 | 讀取（US1）、儲存與驗證（US2） | Gate 1：DB 測試、權限矩陣、Core 讀到新版本 |
| 2 | 版本與回復（US3）、指令（US4）、文件、部署範本 | Gate 2：全套、typecheck、lint、本機 Swagger 檢查 |

每個 Phase 不超過 5 個實作 task，一次完成；使用者確認並 commit 後才進下一個 Phase。

## Risks

- **後台載入 Pack 的相依**：`CapabilityPackLoader` 或 binding 解析若間接 import 語意解析、LLM，需先把型別或函式移出，再放行；以 D2 的走訪測試把關。
- **Pack 與 Core 不一致**：後台與 Core 必須載入相同的 Pack；部署範本以同一個變數產生兩邊的設定，文件註明。
- **已開啟對話的舊選項**：Core 新錯誤碼與 SDK 處理需同時部署；SDK 舊版收到 409 時顯示一般錯誤，不影響其他功能。

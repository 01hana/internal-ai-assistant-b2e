---
name: Codex Engine Read-only Smoke Test
on:
  workflow_dispatch:
permissions:
  contents: read
engine:
  id: codex
  harness:
    max-retries: 0
timeout-minutes: 5
max-turns: 2
max-ai-credits: 50
max-daily-ai-credits: -1
max-turn-cache-misses: 2
tools:
  timeout: 30
  startup-timeout: 30
network:
  allowed: []
sandbox:
  agent:
    id: awf
    config:
      filesystem:
        allowWrite: []
safe-outputs:
  timeout-minutes: 3
  report-failure-as-issue: false
  noop: false
  missing-tool: false
  missing-data: false
  report-incomplete: false
  scripts:
    smoke-summary:
      description: 將唯讀 smoke test 結果寫入 workflow summary；不得修改 GitHub 資源。
      inputs:
        engine:
          description: 必須為 Codex。
          required: true
          type: string
        stack:
          description: 僅依允許檔案歸納的 Repository 技術棧摘要。
          required: true
          type: string
        lint:
          description: package.json 偵測到的 lint 指令；未偵測到時填「未設定」。
          required: true
          type: string
        typecheck:
          description: package.json 偵測到的 typecheck 指令；未偵測到時填「未設定」。
          required: true
          type: string
        test:
          description: package.json 偵測到的 test 指令；未偵測到時填「未設定」。
          required: true
          type: string
        status:
          description: 必須為 SMOKE_TEST_PASS。
          required: true
          type: string
      script: |
        const fields = [item.engine, item.stack, item.lint, item.typecheck, item.test, item.status];
        if (fields.some((value) => typeof value !== "string" || value.trim() === "")) {
          core.setFailed("smoke_summary 的所有欄位皆為必填。");
          return { success: false };
        }
        if (item.engine !== "Codex" || item.status !== "SMOKE_TEST_PASS") {
          core.setFailed("smoke_summary 的引擎或狀態不符合 smoke test 契約。");
          return { success: false };
        }
        await core.summary
          .addRaw(`使用的引擎名稱：${item.engine}\nRepository 技術棧摘要：${item.stack}\n偵測到的 lint 指令：${item.lint}\n偵測到的 typecheck 指令：${item.typecheck}\n偵測到的 test 指令：${item.test}\n${item.status}\n`)
          .write();
        return { success: true };
---

# Codex engine 唯讀 smoke test

這是引擎啟動與最小 Repository 讀取驗證，僅可由 `workflow_dispatch` 手動觸發。

只允許讀取下列檔案：`AGENTS.md`、`package.json`、`README.md`、`.github/copilot-instructions.md`、
`.github/agents/`、`.github/workflows/`、`.specify/workflows/`、`scripts/agentic-sdd.sh`、
`scripts/quality-gate.sh` 與 `docs/agentic-sdd-workflow.md`。不得讀取其他檔案。

不得修改檔案、執行 git 寫入操作、建立或更新 Issue、留言、Pull Request、commit、branch、release
或任何 GitHub 資源。不得使用 GitHub API、不得嘗試讀取、顯示或輸出任何 Secret、token 或環境
變數。不得執行 lint、typecheck、測試、安裝套件或網路請求。

僅根據允許的檔案，以繁體中文整理結果。完成時必須呼叫且只能呼叫 `smoke_summary` Safe Output，
不得呼叫任何其他 Safe Output 或 GitHub 寫入工具；不可完成時必須讓 workflow 失敗，且不得建立 Issue。
`smoke_summary` 的所有欄位都必須提供，`engine` 固定為 `Codex`、`status` 固定為
`SMOKE_TEST_PASS`。Safe Output 會將結果寫入 workflow run summary；結果必須且只能包含以下內容：

```text
使用的引擎名稱：Codex
Repository 技術棧摘要：<摘要>
偵測到的 lint 指令：<逗號分隔指令或未設定>
偵測到的 typecheck 指令：<逗號分隔指令或未設定>
偵測到的 test 指令：<逗號分隔指令或未設定>
SMOKE_TEST_PASS
```

# 本機 Agentic SDD 閉環工作流（第一階段）

本工作流只協調本機 Spec Kit 與驗證，不實作產品功能、不部署，也不修改正式環境設定。
產品規則以 `.specify/memory/constitution.md` 為最高依據；工作開始前必讀 active Feature 的
`spec.md`、`design.md`、`plan.md`、`tasks.md`。

## 啟動、暫停與恢復

以單一指令啟動：

```bash
scripts/agentic-sdd.sh start --spec "功能描述"
```

workflow 的 `gate` 選擇 reject 時會原生暫停並印出 run ID。查看與恢復：

```bash
scripts/agentic-sdd.sh status
scripts/agentic-sdd.sh resume <run-id>
```

也可直接以 `specify workflow run .specify/workflows/agentic-sdd-local/workflow.yml` 啟動。State
由 Spec Kit 保存；不可刪除 `.specify` 下的 run state，否則無法 resume。

## 已自動化步驟

workflow 會依序 dispatch `speckit.specify`、`speckit.clarify`、`speckit.plan`、
`speckit.checklist`、`speckit.tasks`、`speckit.analyze`、`speckit.implement`，並在實作後執行
`scripts/quality-gate.sh`。Quality Gate 固定執行 lint、typecheck、unit、integration、contract
與 E2E tests；任一失敗立即以非零碼停止。

## 必要人工 Gate 與輪次限制

Spec Kit 0.14.4 command step 僅提供 command exit code，無法把獨立 Reviewer 的結構化 YAML
結果安全地轉成 workflow condition。因此以下決策保留人工 Gate，不能假裝為自動判讀：

- `artifact-reviewer` 的 `PASS`／`REVISE`／`HUMAN_REQUIRED`。
- `design.md` 的存在與審查。
- analyze 的 blocking finding 是否已修正。
- quality failure 的根因修復與 converge 是否新增 tasks。

遇到 `REVISE`，修正來源文件後選 reject 暫停並用相同 run ID resume；spec review、analyze
與 quality repair 各最多三輪。遇到 `HUMAN_REQUIRED`，保持暫停，取得人工產品決策或高風險
確認後再 resume。第三輪仍未通過時不可繼續，必須回報 `HUMAN_REQUIRED`。

若 converge 追加 tasks，依序重做 implement → quality gate → converge；每輪都要維持
Feature Issue/spec requirement 的可追溯性。AI Reviewer 不是唯一測試 Gate。

## 驗證與 GitHub Actions

執行無 Feature 的 smoke test：

```bash
scripts/agentic-sdd-smoke-test.sh
```

GitHub Actions 只執行 `scripts/quality-gate.sh`。第二階段才處理 GitHub Issue 自動觸發、Issue
狀態同步、PR/approval 整合與遠端 agent dispatch；本階段不建立上述自動化。

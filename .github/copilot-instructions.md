# Repository instructions

本 Repository 的產品規則以 `.specify/memory/constitution.md` 為最高依據；架構、技術限制與
測試範圍以目前 Feature 目錄中的 `spec.md`、`design.md`、`plan.md`、`tasks.md` 為準。開始修改
前必須先閱讀它們，不得以本文件重新定義產品規則。

- 所有規格產物與程式碼修改必須可追溯至 Feature Issue 或明確的 spec requirement；不得擅自新增產品需求。
- 不得為了使檢查通過而刪除、skip、弱化或改寫測試。
- 規格有產品歧義時，停止並回報 `HUMAN_REQUIRED`，不可自行猜測。
- lint、typecheck 或適用測試未通過時，不得宣告完成。實作後執行 `scripts/quality-gate.sh`；AI review 不能取代此 Gate。
- 高風險資料庫 migration、權限或安全、個資，以及任何外部寫入操作，必須先要求人工確認。
- 所有執行回報與新增工作流程說明一律使用繁體中文。

本機 Agentic SDD 啟動、暫停與恢復方式請見 `docs/agentic-sdd-workflow.md`。

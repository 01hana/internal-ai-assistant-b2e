# 資料模型決策備註

## AssistantContextState.taskState

Phase 2 採用完整的 task state enum：

`idle | planning | waiting_clarification | waiting_confirmation | waiting_approval | waiting_escalation | completed | failed`

`AssistantContextState.taskState` 是對話層級的流程狀態投影，用於恢復對話與路由 assistant flow。它不取代真正的 workflow source-of-truth records：

- `ActionDraft.status` 追蹤 medium-risk confirmation 的來源狀態。
- `ApprovalRequest.status` 追蹤 high / critical-risk approval 的來源狀態。
- `EscalationRequest.status` 追蹤內部 handoff / escalation 的來源狀態。

Context state 可以指向 pending workflow records，但在任何 tool、retrieval 或 side-effect execution 之前，仍必須從來源 records 重新讀取並檢查 permission、ownership、status、expiration 與 idempotency。

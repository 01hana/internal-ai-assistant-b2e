import { AnswerDecisionStatus, AssistantSessionStatus, FeedbackRating, ReviewItemStatus, ReviewPriority, ReviewSourceType } from '../../generated/prisma/client';
import type { AdminAuditEventType } from '../audit/user-audit.service';

/**
 * Feature 015: display labels of the values the admin API returns, in one place so `getFilters`
 * options and responses agree. `satisfies Record<…>` makes a new enum value a compile error until labelled.
 */
export const ANSWER_DECISION_LABELS = {
  [AnswerDecisionStatus.answered]: '已回答',
  [AnswerDecisionStatus.clarification_required]: '需澄清',
  [AnswerDecisionStatus.no_answer]: '無法回答',
  [AnswerDecisionStatus.permission_denied]: '權限不足',
  [AnswerDecisionStatus.tool_failed]: '工具失敗',
  [AnswerDecisionStatus.approval_required]: '需核准',
  [AnswerDecisionStatus.confirmation_required]: '需確認',
  [AnswerDecisionStatus.escalation_required]: '需轉人工'
} satisfies Record<AnswerDecisionStatus, string>;

export const SESSION_STATUS_LABELS = {
  [AssistantSessionStatus.active]: '進行中',
  [AssistantSessionStatus.closed]: '已封存',
  [AssistantSessionStatus.expired]: '已逾期',
  [AssistantSessionStatus.deleted]: '使用者已刪除'
} satisfies Record<AssistantSessionStatus, string>;

export const FEEDBACK_RATING_LABELS = {
  [FeedbackRating.positive]: '正面',
  [FeedbackRating.negative]: '負面',
  [FeedbackRating.neutral]: '中立'
} satisfies Record<FeedbackRating, string>;

export const REVIEW_SOURCE_LABELS = {
  [ReviewSourceType.failed_query]: '查詢失敗',
  [ReviewSourceType.unsupported_question]: '不支援的問題',
  [ReviewSourceType.no_answer]: '無法回答',
  [ReviewSourceType.tool_failure]: '工具失敗',
  [ReviewSourceType.negative_feedback]: '負評',
  [ReviewSourceType.missing_evidence]: '缺少依據',
  [ReviewSourceType.bad_tool_routing]: '工具選擇錯誤',
  [ReviewSourceType.permission_mapping_issue]: '權限對應問題'
} satisfies Record<ReviewSourceType, string>;

export const REVIEW_STATUS_LABELS = {
  [ReviewItemStatus.open]: '待處理',
  [ReviewItemStatus.in_review]: '處理中',
  [ReviewItemStatus.resolved]: '已解決',
  [ReviewItemStatus.dismissed]: '不處理'
} satisfies Record<ReviewItemStatus, string>;

export const REVIEW_PRIORITY_LABELS = {
  [ReviewPriority.high]: '高',
  [ReviewPriority.medium]: '中',
  [ReviewPriority.low]: '低'
} satisfies Record<ReviewPriority, string>;

export const ADMIN_AUDIT_EVENT_LABELS = {
  admin_bootstrap: '建立第一個帳號',
  admin_login_succeeded: '登入成功',
  admin_login_failed: '登入失敗',
  admin_logout: '登出',
  admin_password_set: '設定密碼',
  admin_password_reset_requested: '申請重設密碼',
  admin_password_reset: '重設密碼',
  admin_password_changed: '修改密碼',
  admin_user_created: '建立使用者',
  admin_user_updated: '修改使用者',
  admin_user_email_changed: '修改使用者 email',
  admin_user_groups_changed: '變更使用者群組',
  admin_user_disabled: '停用使用者',
  admin_user_enabled: '啟用使用者',
  admin_user_invite_resent: '重寄邀請信',
  admin_user_deleted: '刪除使用者',
  admin_user_group_created: '建立群組',
  admin_user_group_updated: '修改群組',
  admin_user_group_deleted: '刪除群組',
  admin_conversation_viewed: '查看對話內容',
  admin_review_item_updated: '更新待審項目'
} satisfies Record<AdminAuditEventType, string>;

/** `{ value, label }` options for `getFilters`, in declaration order. */
export function optionsOf<T extends string>(labels: Record<T, string>): Array<{ value: T; label: string }> {
  return (Object.entries(labels) as Array<[T, string]>).map(([value, label]) => ({ value, label }));
}

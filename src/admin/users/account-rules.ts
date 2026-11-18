/** Accounts: 3–64 lower-case letters, digits, ".", "_" or "-" (spec US4-1). Shared by the API and the bootstrap CLI. */
export const ACCOUNT_PATTERN = /^[a-z0-9._-]{3,64}$/;
export const ACCOUNT_RULE_MESSAGE = '帳號需為 3–64 個字元，只能包含英文字母、數字與「.」「_」「-」。';

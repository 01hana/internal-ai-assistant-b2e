# Assistant Conversation Experience (Feature 013)

Spec: [`specs/013-assistant-conversation-experience/`](../../specs/013-assistant-conversation-experience/spec.md). Frontend contract: [frontend integration guide](../frontend-integration/assistant-conversation-experience.md).

Feature 013 adds a guided conversation on top of the existing grounded-answer flow: an opening greeting with Quick Replies, follow-up suggestions after an answer, a capability overview, a session history list with archive, and collection of questions the Assistant cannot support. None of it bypasses the existing trust chain: every choice runs through the same capability binding, CustomerToolPolicy, permission checks, evidence and audit as a typed question.

## Components

| Component | Location | Role |
| --- | --- | --- |
| `AvailableCapabilityService` | `src/capabilities/available-capability.service.ts` | The single rule for "what can this actor run": active binding → exact tool → read-only → roles/scopes → result policy. Used by LLM tool selection, Quick Replies, the overview and follow-ups. Visibility never replaces execution-time checks. |
| `AssistantExperienceConfig` | Prisma model; `src/assistant-experience/` | Versioned per Customer + Integration (`draft` / `active` / `retired`; `activeSlot` keeps one active). Holds greeting, Quick Replies, follow-ups. Customer content lives in `customers/<customer>/assistant-experience/<version>.json`, never in Core. |
| Provisioning CLI | `src/assistant-experience/provision-assistant-experience.cli.ts` (`npm run assistant-experience:provision`; `deploy.sh experience`) | Validates schema, scope, `HUMAN_VERIFIED` review status and that every declared capability + parameters resolves to an active binding; `--check` is read-only. Same version with different content is rejected. |
| `AssistantExperienceService` | `src/assistant-experience/assistant-experience.service.ts` | `buildOpening`, `buildCapabilityQuickReplies`, `buildFollowUps`, `resolveChoice`. All filter through `AvailableCapabilityService`. |
| Declared choices | `CapabilityResolutionService.resolveDeclared` | A clicked choice (`choiceId`) executes the capability and parameters declared in the active configuration, skipping semantic matching and the LLM (audit `reasonCode: DECLARED_CHOICE`). The choice's `message` is only the user-visible text. |
| Controlled conversation | `src/query-understanding/controlled-conversation.classifier.ts` | Greeting, help and capability-discovery questions are answered without tools. The overview lists only capabilities the actor can run. |
| Sessions | `src/assistant/session/` | `title` set once from the first user message (40 characters, no LLM); `lastMessageAt` updated on each user message; list excludes sessions without messages; archive closes the session. |
| Unsupported questions | `src/assistant/message/unsupported-question.ts`, `ReviewItemService.createUnsupportedQuestion` | `CAPABILITY_NOT_RECOGNIZED` / `LLM_NO_MATCH` on a typed question creates a `ReviewItem` (`sourceType: unsupported_question`, `sourceId` = user message). The text is not copied; `suggestedImprovement` is `{ reasonCode, module }`. Every occurrence is recorded. |

## Endpoints

Core (`/api/v1/assistant`, internal identity) and Gateway (same public paths, fixed route catalogue in `apps/gateway/src/backend-client/backend-route-definition.ts`):

| Method | Path | Change |
| --- | --- | --- |
| POST | `/sessions` | Response adds `opening { configVersion, greeting, quickReplies[] }`. |
| POST | `/sessions/:id/messages` | Body accepts exactly one of `message` or `choiceId`. SSE `final` may add `suggestions[]`. |
| GET | `/sessions?limit&cursor` | New. Actor's own active sessions with messages, newest first; opaque cursor; `limit` 1–50 (default 20). Not audited. |
| GET | `/sessions?status=archived` | Archived (closed) sessions, same shape and paging as the active list. |
| POST | `/sessions/:id/archive` | New. Closes the session; audit `session_archived`. |
| POST | `/sessions/:id/unarchive` | New. Archived → active; audit `session_unarchived`. |
| DELETE | `/sessions/:id` | New. Active or archived → `deleted` (hidden from the user for good; messages and audit retained); audit `session_deleted`. |

Questions no capability recognizes are stored as `ReviewItem` (`sourceType: unsupported_question`). They are reviewed in the admin API (`reviewItems/*`, see [`admin-api.md`](../frontend-integration/admin-api.md)); Core's former `/admin/assistant/review-items` route was removed in Feature 015.

## Audit events

`session_created` metadata adds `experienceConfigVersion` and `quickReplyIds`. New: `quick_reply_selected`, `suggestion_selected`, `session_archived`, `session_unarchived`, `session_deleted`, and `review_item_created` with `sourceType: unsupported_question`.

## Deployment

Migrations `20261116000000_feature013_assistant_experience` and `20261117000000_feature013_session_deleted` (adds `AssistantSessionStatus.deleted`) are additive. Provision the experience configuration with `deploy.sh experience` (see [`deploy/demo/README.md`](../../deploy/demo/README.md)). When upgrading, deploy Core before Gateway: a new Gateway forwards `choiceId`, list and archive, which an old Core rejects.

## Known limits

- Ambiguous questions that previously listed candidates now resolve to `CAPABILITY_NOT_RECOGNIZED` (spec Decision 1), so they are also collected as unsupported questions.
- Suggestions are not restored in message history; the client shows them only on the latest answer.

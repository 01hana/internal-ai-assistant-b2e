# Regression Scope Checklist

Use this checklist before accepting a v1 change. It keeps the internal
assistant focused on its safety and evidence contracts rather than quietly
turning into a broader platform.

## Out Of Scope For v1

- [ ] No complete admin UI or generic CRUD back office.
- [ ] No taxonomy or settings-management UI.
- [ ] No real ERP, MES, WMS, SCM, or CRM connector.
- [ ] No frontend SDK or embeddable widget.
- [ ] No fully productized active-session auto-resolution strategy.
- [ ] No production deployment design.
- [ ] No Kubernetes, Helm, or CI/CD implementation.
- [ ] No queue, worker, or mandatory Redis dependency.
- [ ] No production-grade vector database or embedding-ingestion pipeline.
- [ ] No automatic fine-tuning.
- [ ] No automatic modification of the production knowledge base.
- [ ] No dashboard or analytics UI.

## Non-Negotiable Runtime Checks

- [ ] Validate identity before session, message, history, tool, and retrieval
  work.
- [ ] Never treat `AssistantContextState` as a substitute for identity or
  permission checks.
- [ ] Run Query Understanding before creating an ExecutionPlan.
- [ ] Route live business data through connectors and tools.
- [ ] Route SOPs, policies, manuals, and field guides through document
  retrieval.
- [ ] Do not execute a side effect before confirmation or approval.
- [ ] Re-check permission, organization and host-app boundaries, tool contract,
  and idempotency before confirm or approve execution.
- [ ] Exclude unauthorized fields from LLM input.
- [ ] Return a safe non-answer for missing evidence, permission denial, tool
  failure, or evidence conflict; never fabricate an answer.
- [ ] Keep feedback, review, and audit metadata free of raw sensitive payloads.
- [ ] Keep OpenAI API keys, connector secrets, and database credentials out of
  README files, fixtures, audit events, error responses, and logs.

## Regression Evidence

- [ ] Health and readiness report safe dependency summaries.
- [ ] Structured lookup, document retrieval, clarification, no-answer, and
  side-effect gate regression tests remain green.
- [ ] SSE final events retain their expected decision and evidence shape.
- [ ] Docker Compose remains a local development/test baseline only; Redis is
  optional and profile-based.

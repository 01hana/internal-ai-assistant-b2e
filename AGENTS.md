<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->

## Repository-level SDD rules

- Treat `.specify/memory/constitution.md` as the highest-level product constraint
  and read the active feature's `spec.md`, `design.md`, `plan.md`, and `tasks.md`
  before changing code or specification artifacts.
- Every specification artifact and code change must be traceable to a Feature
  Issue or an explicit requirement in the active feature specification. Do not
  invent product requirements.
- Do not delete, skip, weaken, or rewrite tests merely to make a check pass.
- Stop and report `HUMAN_REQUIRED` when product intent is ambiguous. Require
  human confirmation before high-risk migrations, authorization/security or
  personal-data changes, and external write operations.
- Do not declare work complete while lint, typecheck, or applicable tests fail.
- Use Traditional Chinese for execution reports and workflow documentation.
- Run `scripts/quality-gate.sh` after implementation changes. It is a
  deterministic gate and cannot be replaced by an AI review.

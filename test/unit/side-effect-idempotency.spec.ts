import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToolExecutionStatus } from '../../src/generated/prisma/enums';

// This suite intentionally locks only the schema/enum baseline.
// Behavior-level duplicate confirm / approve / execution tests will be added
// with T086/T087 when side-effect idempotency and confirm/approve re-check
// runtime are implemented.
describe('US3 side-effect idempotency schema baseline', () => {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it('keeps idempotencyKey as the persisted dedupe key schema for ActionDraft and ApprovalRequest', () => {
    expect(schema).toContain('model ApprovalRequest');
    expect(schema).toContain('model ActionDraft');
    expect(schema).toContain('idempotencyKey   String?');
    expect(schema).toContain('@@unique([idempotencyKey])');
  });

  it('does not treat requestId as the only dedupe guard in the schema baseline for side-effect requests', () => {
    expect(schema).toContain('requestId        String');
    expect(schema).not.toContain('@@unique([requestId])');
  });

  it('reserves a duplicate-safe execution status enum for replay and retry protection', () => {
    expect(ToolExecutionStatus.skipped_duplicate).toBe('skipped_duplicate');
  });
});

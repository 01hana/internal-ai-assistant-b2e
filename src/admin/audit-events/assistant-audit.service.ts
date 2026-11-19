import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { periodWhere } from '../common/period.dto';
import { orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { AdminSettings } from '../config/admin-settings';
import type { AssistantAuditFiltersDto, AssistantAuditTableQueryDto } from './audit-events.dto';

const SORTABLE = ['timestamp'] as const;
/** `metadata`, `permissionResult` and evidence references are not returned (spec Decision 6). */
const COLUMNS = {
  id: true, timestamp: true, eventType: true, requestId: true, actorId: true, organizationId: true, hostApp: true,
  sessionId: true, messageId: true, decision: true, durationMs: true
} satisfies Prisma.AuditEventSelect;

/** Feature 015 US5-1: the Assistant's own audit trail for this Customer. */
@Injectable()
export class AssistantAuditService {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings) {}

  async table(query: AssistantAuditTableQueryDto): Promise<TablePage<Prisma.AuditEventGetPayload<{ select: typeof COLUMNS }>>> {
    const where: Prisma.AuditEventWhereInput = { customerId: this.settings.customerId, ...filtersWhere(query.filters) };
    const [items, total] = await this.prisma.db.$transaction([
      this.prisma.db.auditEvent.findMany({ where, select: COLUMNS, orderBy: [orderByOf(query.sort, SORTABLE, { timestamp: 'desc' }), { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.db.auditEvent.count({ where })
    ]);
    return { items, total };
  }

  /** Event types that occur for this Customer; shown as codes (technical, many). */
  async filters() {
    const types = await this.prisma.db.auditEvent.findMany({
      where: { customerId: this.settings.customerId }, distinct: ['eventType'], select: { eventType: true }, orderBy: { eventType: 'asc' }
    });
    return { eventType: types.map(({ eventType }) => ({ value: eventType, label: eventType })) };
  }
}

function filtersWhere(filters: AssistantAuditFiltersDto | undefined): Prisma.AuditEventWhereInput {
  return {
    ...(filters?.eventType?.length ? { eventType: { in: filters.eventType } } : {}),
    ...(filters?.actorId ? { actorId: filters.actorId } : {}),
    ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
    ...(filters?.requestId ? { requestId: filters.requestId } : {}),
    ...(periodWhere(filters) ? { timestamp: periodWhere(filters) } : {})
  };
}

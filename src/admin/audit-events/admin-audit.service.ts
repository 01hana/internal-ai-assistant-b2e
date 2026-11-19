import { Injectable } from '@nestjs/common';
import type { Prisma, UserAuditEvent } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { auditActorView } from '../audit/audit-actor';
import type { AdminPrincipal } from '../common/admin-request';
import { ADMIN_AUDIT_EVENT_LABELS, optionsOf } from '../common/labels';
import { periodWhere } from '../common/period.dto';
import { orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import type { AdminAuditFiltersDto, AdminAuditTableQueryDto } from './audit-events.dto';

const SORTABLE = ['timestamp'] as const;

/**
 * Feature 015 US5-2: the back-office audit trail (one deployment = one Customer, so no customer
 * filter). Non-developers see developers only as 開發工程師: no account, and for events about a
 * developer account neither the target ID nor the metadata (which holds its account, name and email).
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async table(principal: AdminPrincipal, query: AdminAuditTableQueryDto): Promise<TablePage<ReturnType<typeof eventView>>> {
    const where = filtersWhere(query.filters, principal.isDeveloper);
    const [events, total] = await this.prisma.db.$transaction([
      this.prisma.db.userAuditEvent.findMany({ where, orderBy: [orderByOf(query.sort, SORTABLE, { timestamp: 'desc' }), { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.db.userAuditEvent.count({ where })
    ]);
    return { items: events.map((event) => eventView(event, principal.isDeveloper)), total };
  }

  filters() {
    return { eventType: optionsOf(ADMIN_AUDIT_EVENT_LABELS) };
  }
}

/** Filtering by account must not reveal which events a developer account caused. */
function filtersWhere(filters: AdminAuditFiltersDto | undefined, viewerIsDeveloper: boolean): Prisma.UserAuditEventWhereInput {
  return {
    ...(filters?.eventType?.length ? { eventType: { in: filters.eventType } } : {}),
    ...(filters?.actorAccount ? { actorAccount: filters.actorAccount, ...(viewerIsDeveloper ? {} : { actorIsDeveloper: false }) } : {}),
    ...(periodWhere(filters) ? { timestamp: periodWhere(filters) } : {})
  };
}

function eventView(event: UserAuditEvent, viewerIsDeveloper: boolean) {
  const hideTarget = event.targetIsDeveloper && !viewerIsDeveloper;
  return {
    id: event.id, timestamp: event.timestamp.toISOString(), requestId: event.requestId, eventType: event.eventType,
    actor: auditActorView(event, viewerIsDeveloper),
    targetType: event.targetType, targetId: hideTarget ? null : event.targetId,
    ipSummary: event.ipSummary, userAgentSummary: event.userAgentSummary,
    metadata: hideTarget ? null : event.metadata
  };
}

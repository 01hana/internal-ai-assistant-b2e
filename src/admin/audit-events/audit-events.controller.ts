import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, CurrentAdmin } from '../common/admin-request';
import { AdminAuditService } from './admin-audit.service';
import { AssistantAuditService } from './assistant-audit.service';
import { AdminAuditTableQueryDto, AssistantAuditTableQueryDto } from './audit-events.dto';

/** Feature 015 US5-1: Assistant audit events. Read-only: there is no route to change or delete audit. */
@Controller('auditEvents')
export class AssistantAuditController {
  constructor(private readonly audit: AssistantAuditService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'AuditEvent')
  table(@Body() query: AssistantAuditTableQueryDto) {
    return this.audit.table(query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'AuditEvent')
  filters() {
    return this.audit.filters();
  }
}

/** Feature 015 US5-2: back-office audit events. Read-only. */
@Controller('adminAuditEvents')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'AuditEvent')
  table(@CurrentAdmin() admin: AdminPrincipal, @Body() query: AdminAuditTableQueryDto) {
    return this.audit.table(admin, query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'AuditEvent')
  filters() {
    return this.audit.filters();
  }
}

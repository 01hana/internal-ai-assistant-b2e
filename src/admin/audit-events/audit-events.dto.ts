import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ADMIN_AUDIT_EVENT_LABELS } from '../common/labels';
import { PeriodFilterDto } from '../common/period.dto';
import { TableQueryDto } from '../common/table-query.dto';

/** Assistant audit (`AuditEvent`); `from`／`to` filter on the event time. */
export class AssistantAuditFiltersDto extends PeriodFilterDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  eventType?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  requestId?: string;
}

export class AssistantAuditTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantAuditFiltersDto)
  filters?: AssistantAuditFiltersDto;
}

/** Back-office audit (`UserAuditEvent`); `from`／`to` filter on the event time. */
export class AdminAuditFiltersDto extends PeriodFilterDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsIn(Object.keys(ADMIN_AUDIT_EVENT_LABELS), { each: true })
  eventType?: string[];

  /** Exact account of the person who acted. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actorAccount?: string;
}

export class AdminAuditTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminAuditFiltersDto)
  filters?: AdminAuditFiltersDto;
}

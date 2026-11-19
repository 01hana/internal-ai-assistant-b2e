import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AssistantSessionStatus } from '../../generated/prisma/client';
import { PeriodFilterDto } from '../common/period.dto';
import { TableQueryDto } from '../common/table-query.dto';

/** `from`／`to` filter on the last message time. */
export class ConversationFiltersDto extends PeriodFilterDto {
  /** Default: every status except `deleted` (conversations the user deleted). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(AssistantSessionStatus, { each: true })
  status?: AssistantSessionStatus[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hostApp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organizationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorId?: string;

  @IsOptional()
  @IsBoolean()
  hasNegativeFeedback?: boolean;

  /** Has an answer that was not given: no answer, permission denied or tool failure. */
  @IsOptional()
  @IsBoolean()
  hasUnanswered?: boolean;
}

/** `keyword` matches the conversation title. */
export class ConversationTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationFiltersDto)
  filters?: ConversationFiltersDto;
}

import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { ReviewItemStatus, ReviewPriority, ReviewSourceType } from '../../generated/prisma/client';
import { trim } from '../common/dto-transforms';
import { IdsDto } from '../common/ids.dto';
import { PeriodFilterDto } from '../common/period.dto';
import { TableQueryDto } from '../common/table-query.dto';

/** `from`／`to` filter on when the item was created. */
export class ReviewItemFiltersDto extends PeriodFilterDto {
  /** Default: open and in review. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(ReviewItemStatus, { each: true })
  status?: ReviewItemStatus[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(ReviewSourceType, { each: true })
  sourceType?: ReviewSourceType[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(ReviewPriority, { each: true })
  priority?: ReviewPriority[];
}

/** `keyword` matches the summary. */
export class ReviewItemTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ReviewItemFiltersDto)
  filters?: ReviewItemFiltersDto;
}

export class ReviewItemBatchDto extends IdsDto {
  @IsEnum(ReviewItemStatus)
  status!: ReviewItemStatus;

  /** Replaces the item's note when given; kept in the handling history either way. */
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { FeedbackRating } from '../../generated/prisma/client';
import { PeriodFilterDto } from '../common/period.dto';
import { TableQueryDto } from '../common/table-query.dto';

/** `from`／`to` filter on when the feedback was given. */
export class FeedbackFiltersDto extends PeriodFilterDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(FeedbackRating, { each: true })
  rating?: FeedbackRating[];

  @IsOptional()
  @IsBoolean()
  hasComment?: boolean;
}

/** `keyword` matches the reason and the comment. */
export class FeedbackTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => FeedbackFiltersDto)
  filters?: FeedbackFiltersDto;
}

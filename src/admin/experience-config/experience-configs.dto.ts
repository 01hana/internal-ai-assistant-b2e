import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsObject, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { AssistantExperienceConfigSource, AssistantExperienceConfigStatus } from '../../generated/prisma/enums';
import { TableQueryDto } from '../common/table-query.dto';

/**
 * Feature 016 US2: the editable part of an experience configuration. Only the outer shape is checked here; every
 * field rule (lengths, counts, IDs, capability references) belongs to Feature 013's parser and validator.
 */
export class ExperienceConfigInputDto {
  /** The active version the editor started from; null when the integration had none. Required. */
  @ValidateIf((input: ExperienceConfigInputDto) => input.baseConfigVersion !== null)
  @IsString()
  baseConfigVersion!: string | null;

  @IsObject()
  greeting!: Record<string, unknown>;

  @IsInt()
  maxQuickReplies!: number;

  /** Items without `id` get one; existing IDs must be kept (open conversations resolve choices by ID). */
  @IsArray()
  @IsObject({ each: true })
  quickReplies!: Record<string, unknown>[];

  @IsArray()
  @IsObject({ each: true })
  followUps!: Record<string, unknown>[];
}

/** Feature 016 US3-3: the active version the editor last saw, as for saving. */
export class ExperienceConfigActivateDto {
  @ValidateIf((input: ExperienceConfigActivateDto) => input.baseConfigVersion !== null)
  @IsString()
  baseConfigVersion!: string | null;
}

export class ExperienceVersionFiltersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsEnum(AssistantExperienceConfigStatus, { each: true })
  status?: AssistantExperienceConfigStatus[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsEnum(AssistantExperienceConfigSource, { each: true })
  source?: AssistantExperienceConfigSource[];
}

/** Feature 016 US3-1. No keyword: versions have no searchable text. */
export class ExperienceVersionTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ExperienceVersionFiltersDto)
  filters?: ExperienceVersionFiltersDto;
}

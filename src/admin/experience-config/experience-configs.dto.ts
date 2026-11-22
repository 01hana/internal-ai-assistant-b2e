import { IsArray, IsInt, IsObject, IsString, ValidateIf } from 'class-validator';

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

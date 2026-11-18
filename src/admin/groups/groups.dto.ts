import { PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../common/dto-transforms';
import { TableQueryDto } from '../common/table-query.dto';

export class GroupTableQueryDto extends TableQueryDto {}


export class CreateGroupDto {
  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** `subject:action` strings; `subject:manage` is expanded. Validated against src/admin/permissions. */
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TableQueryDto } from '../common/table-query';

export class GroupTableQueryDto extends TableQueryDto {}

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

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

export class DeleteGroupsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

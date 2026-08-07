import { Type } from 'class-transformer';
import { IsArray, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

class PageContextSelectedRowDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class PageContextDto {
  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsString()
  screenId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PageContextSelectedRowDto)
  selectedRows?: PageContextSelectedRowDto[];

  @IsOptional()
  @IsArray()
  activeFilters?: unknown[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  visibleColumns?: string[];

  @IsOptional()
  @IsObject()
  userVisibleState?: Record<string, unknown>;
}

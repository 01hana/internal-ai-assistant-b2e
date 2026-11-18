import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class TableSortDto {
  @IsString()
  field!: string;

  @IsIn(['asc', 'desc'])
  order!: 'asc' | 'desc';
}

/** Body of every `POST <resource>/getTable`. Resources extend it with their own `filters`. */
export class TableQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @ValidateNested()
  @Type(() => TableSortDto)
  sort?: TableSortDto;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;
}

export type TablePage<T> = { items: T[]; total: number };

export function pageArgs(query: TableQueryDto): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/** `{ field, order }` → Prisma `orderBy`, accepting only the fields a resource allows. */
export function orderByOf<TField extends string>(
  sort: TableSortDto | undefined,
  allowed: readonly TField[],
  fallback: Partial<Record<TField, 'asc' | 'desc'>>
): Partial<Record<TField, 'asc' | 'desc'>> {
  if (!sort) return fallback;
  if (!(allowed as readonly string[]).includes(sort.field)) {
    throw new BadRequestException({ error: 'invalid_sort_field', message: `不支援依「${sort.field}」排序。` });
  }
  return { [sort.field]: sort.order } as Partial<Record<TField, 'asc' | 'desc'>>;
}

/** Case-insensitive "contains" on several text columns. */
export function keywordWhere<TField extends string>(keyword: string | undefined, fields: readonly TField[]) {
  const value = keyword?.trim();
  if (!value) return {};
  return { OR: fields.map((field) => ({ [field]: { contains: value, mode: 'insensitive' as const } })) };
}

import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/** Body of batch operations (`DELETE <resource>`, `<resource>/batch`): 1–100 record IDs. */
export class IdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}

/** Batch IDs without duplicates, in request order. */
export const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids)];

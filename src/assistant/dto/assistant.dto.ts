import { Type } from 'class-transformer';
import { IsIn, IsNumberString, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { PageContextDto } from '../page-context/page-context.dto';

export class CreateAssistantSessionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}

export class SendAssistantMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}

export class AssistantMessageHistoryQueryDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['asc'])
  order?: 'asc';
}

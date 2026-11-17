import { Type } from 'class-transformer';
import {
  IsIn, IsNumberString, IsOptional, IsString, Matches, MaxLength, MinLength, Validate, ValidateIf, ValidateNested,
  ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface
} from 'class-validator';
import { PageContextDto } from '../page-context/page-context.dto';

export class CreateAssistantSessionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}

export const EXPERIENCE_CHOICE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Feature 013 FR-005: exactly one of `message` or `choiceId`. */
@ValidatorConstraint({ name: 'messageOrChoiceId', async: false })
class MessageOrChoiceIdConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const body = args.object as { message?: unknown; choiceId?: unknown };
    return (body.message === undefined) !== (body.choiceId === undefined);
  }
  defaultMessage(): string { return 'Exactly one of message or choiceId is required.'; }
}

export class SendAssistantMessageDto {
  /** Required unless choiceId is supplied. */
  @ValidateIf((body: SendAssistantMessageDto) => body.choiceId === undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message?: string;

  /** Feature 013: ID of a Quick Reply or follow-up from the active experience configuration. */
  @ValidateIf((body: SendAssistantMessageDto) => body.choiceId !== undefined)
  @Validate(MessageOrChoiceIdConstraint)
  @IsString()
  @Matches(EXPERIENCE_CHOICE_ID_PATTERN)
  choiceId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PageContextDto)
  pageContext?: PageContextDto;
}

/** Feature 013 US4: session history list query; values are validated again by session-cursor. */
export class AssistantSessionListQueryDto {
  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  /** Omitted for the active list; `archived` lists the actor's archived sessions. */
  @IsOptional()
  @IsIn(['archived'])
  status?: 'archived';
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

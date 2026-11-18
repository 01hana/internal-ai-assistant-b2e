import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { trim, trimLower } from '../common/dto-transforms';
import { IdsDto } from '../common/ids.dto';
import { TableQueryDto } from '../common/table-query.dto';
import { ACCOUNT_PATTERN, ACCOUNT_RULE_MESSAGE } from './account-rules';

export class UserTableFiltersDto {
  /** Users in any of these groups. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  groups?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsBoolean({ each: true })
  status?: boolean[];
}

export class UserTableQueryDto extends TableQueryDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UserTableFiltersDto)
  filters?: UserTableFiltersDto;
}

export class CreateUserDto {
  /** Login name; stored in lower case and fixed after creation. */
  @trimLower()
  @IsString()
  @Matches(ACCOUNT_PATTERN, { message: ACCOUNT_RULE_MESSAGE })
  account!: string;

  @trim()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @trimLower()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** IDs from `groups/getOptions`. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  groupIds!: string[];
}

/** The account cannot change; the email only while the invitation is pending (developers excepted). */
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['account'] as const)) {}

export class BatchStatusDto extends IdsDto {
  /** true = enable, false = disable (revokes their sessions). */
  @IsBoolean()
  status!: boolean;
}

import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MaxLength(64)
  account!: string;

  @IsString()
  @MaxLength(256)
  password!: string;
}

export class TokenDto {
  @IsString()
  @MaxLength(128)
  token!: string;
}

export class SetPasswordDto extends TokenDto {
  @IsString()
  @MaxLength(256)
  password!: string;
}

/** Changing one's own password while signed in. */
export class ChangePasswordDto {
  @IsString()
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MaxLength(256)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

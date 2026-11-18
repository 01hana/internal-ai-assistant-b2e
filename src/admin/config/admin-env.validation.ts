import { plainToInstance, Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min, validateSync } from 'class-validator';

const runtimeEnvironments = ['development', 'test', 'production'] as const;
const booleanStrings = ['true', 'false'] as const;
const mailTransports = ['smtp', 'log'] as const;

/**
 * Feature 014: environment of the admin API process (src/admin-main.ts). Kept separate from the Core
 * variables so the admin process does not need LLM or identity settings, and Core does not need these.
 */
export class AdminEnvironmentVariables {
  @IsOptional()
  @IsIn(runtimeEnvironments)
  NODE_ENV: (typeof runtimeEnvironments)[number] = 'development';

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(65535)
  ADMIN_PORT = 3200;

  /** The admin website origin, e.g. https://admin.example.com. Used for CORS, Origin checks and mail links. */
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  ADMIN_WEB_ORIGIN!: string;

  /** The one customer this deployment serves; must exist in the Customer table. */
  @IsString()
  @IsNotEmpty()
  ADMIN_CUSTOMER_ID!: string;

  @IsOptional()
  @IsIn(booleanStrings)
  ADMIN_COOKIE_SECURE: (typeof booleanStrings)[number] = 'true';

  /** Serves Swagger UI at /api/v1/admin/docs. Local development only (rejected in production). */
  @IsOptional()
  @IsIn(booleanStrings)
  ADMIN_ENABLE_SWAGGER_DOCS: (typeof booleanStrings)[number] = 'false';

  /** `log` writes mail links to the log instead of sending; local development only. */
  @IsOptional()
  @IsIn(mailTransports)
  ADMIN_MAIL_TRANSPORT: (typeof mailTransports)[number] = 'smtp';

  /** Sender, e.g. `AI 助理後台 <no-reply@example.com>`. */
  @IsOptional()
  @IsString()
  ADMIN_MAIL_FROM?: string;

  @IsOptional()
  @IsString()
  ADMIN_SMTP_HOST?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  ADMIN_SMTP_PORT?: number;

  @IsOptional()
  @IsIn(booleanStrings)
  ADMIN_SMTP_SECURE: (typeof booleanStrings)[number] = 'false';

  @IsOptional()
  @IsString()
  ADMIN_SMTP_USER?: string;

  @IsOptional()
  @IsString()
  ADMIN_SMTP_PASSWORD?: string;
}

export function validateAdminEnvironment(config: Record<string, unknown>): AdminEnvironmentVariables {
  const validated = plainToInstance(AdminEnvironmentVariables, config, { enableImplicitConversion: false });
  const errors = validateSync(validated, { skipMissingProperties: false });
  const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));

  if (validated.ADMIN_MAIL_TRANSPORT === 'log' && validated.NODE_ENV === 'production') {
    messages.push('ADMIN_MAIL_TRANSPORT=log is only allowed outside production.');
  }
  if (validated.ADMIN_MAIL_TRANSPORT === 'smtp') {
    if (!validated.ADMIN_SMTP_HOST) messages.push('ADMIN_SMTP_HOST is required when ADMIN_MAIL_TRANSPORT=smtp.');
    if (!validated.ADMIN_SMTP_PORT) messages.push('ADMIN_SMTP_PORT is required when ADMIN_MAIL_TRANSPORT=smtp.');
    if (!validated.ADMIN_MAIL_FROM) messages.push('ADMIN_MAIL_FROM is required when ADMIN_MAIL_TRANSPORT=smtp.');
  }
  if (validated.ADMIN_ENABLE_SWAGGER_DOCS === 'true' && validated.NODE_ENV === 'production') {
    messages.push('ADMIN_ENABLE_SWAGGER_DOCS=true is only allowed outside production.');
  }
  if (validated.ADMIN_COOKIE_SECURE === 'false' && validated.NODE_ENV === 'production') {
    messages.push('ADMIN_COOKIE_SECURE=false is only allowed outside production.');
  }

  if (messages.length > 0) {
    throw new Error(`Invalid admin environment: ${messages.join('; ')}`);
  }
  return validated;
}


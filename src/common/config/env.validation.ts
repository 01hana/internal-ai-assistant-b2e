import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, Max, Min, validateSync } from 'class-validator';

export const MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS = 300;

const allowedRuntimeEnvironments = ['development', 'test', 'production'] as const;
const allowedLlmProviders = ['openai'] as const;

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(allowedRuntimeEnvironments)
  NODE_ENV: (typeof allowedRuntimeEnvironments)[number] = 'development';

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  PORT = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_USER!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_PASSWORD!: string;

  @IsString()
  @IsNotEmpty()
  POSTGRES_DB!: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @IsIn(allowedLlmProviders)
  LLM_PROVIDER: (typeof allowedLlmProviders)[number] = 'openai';

  @IsString()
  @IsNotEmpty()
  LLM_MODEL!: string;

  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_IDENTITY_JWT_ISSUER!: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_IDENTITY_JWT_AUDIENCE!: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  INTERNAL_IDENTITY_JWKS_URI!: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS)
  INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS = 0;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_RUNTIME_DEBUG = false;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_REDIS = false;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_SWAGGER_DOCS = false;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/)
  SWAGGER_PATH = 'docs';
}

export function validateEnvironment(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    whitelist: true
  });

  if (errors.length > 0) {
    const fields = errors.map((error) => error.property).join(', ');
    throw new Error(`Invalid environment configuration. Check required fields: ${fields}`);
  }

  return validatedConfig;
}

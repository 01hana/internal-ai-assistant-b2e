import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, validateSync } from 'class-validator';

const allowedRuntimeEnvironments = ['development', 'test', 'production'] as const;

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
  LLM_MODEL!: string;

  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY!: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_RUNTIME_DEBUG = false;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  ENABLE_REDIS = false;
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

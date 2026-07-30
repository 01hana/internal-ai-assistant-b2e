import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { EnvironmentVariables } from "./common/config/env.validation";
import { setupSwagger } from "./common/docs/swagger.setup";
import { GlobalExceptionFilter } from "./common/errors/global-exception.filter";
import { RequestIdInterceptor } from "./common/request-id/request-id.interceptor";
import { ResponseEnvelopeInterceptor } from "./common/response/response-envelope.interceptor";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  const corsAllowedOrigins = configService
    .get<string>('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsAllowedOrigins,
    allowedHeaders: ['authorization', 'content-type', 'x-request-id']
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new ResponseEnvelopeInterceptor(),
  );

  const enableSwaggerDocs = configService.get<boolean>(
    "ENABLE_SWAGGER_DOCS",
    false,
  );
  const swaggerPath = configService.get<string>("SWAGGER_PATH", "docs");

  if (enableSwaggerDocs) {
    setupSwagger(app, { path: swaggerPath });
  }

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();

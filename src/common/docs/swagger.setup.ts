import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export type SwaggerSetupOptions = {
  path: string;
};

export function setupSwagger(app: INestApplication, options: SwaggerSetupOptions) {
  const documentConfig = new DocumentBuilder()
    .setTitle('Internal Backend AI Assistant Core')
    .setDescription('API documentation for the internal assistant backend. Assistant APIs require a Gateway-signed internal identity JWT; external customer access tokens must be validated and exchanged by Gateway before reaching this service.')
    .setVersion('0.1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Gateway-signed internal identity JWT (RS256), not the customer-system access token.'
    })
    .addGlobalParameters({
      name: 'x-request-id',
      in: 'header',
      required: false,
      description: 'Optional request id for tracing.'
    })
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  SwaggerModule.setup(options.path, app, document, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true
    }
  });
}

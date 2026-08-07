import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export type SwaggerSetupOptions = {
  path: string;
};

export function setupSwagger(app: INestApplication, options: SwaggerSetupOptions) {
  const documentConfig = new DocumentBuilder()
    .setTitle('Internal Backend AI Assistant Core')
    .setDescription('API documentation for the internal assistant backend.')
    .setVersion('0.1.0')
    .addBearerAuth()
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

import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export type SwaggerSetupOptions = {
  path: string;
  title?: string;
  description?: string;
  /** Authentication schemes of the API; Core uses a bearer token. */
  configure?: (builder: DocumentBuilder) => DocumentBuilder;
};

export function setupSwagger(app: INestApplication, options: SwaggerSetupOptions) {
  const builder = new DocumentBuilder()
    .setTitle(options.title ?? 'Internal Backend AI Assistant Core')
    .setDescription(options.description ?? 'API documentation for the internal assistant backend.')
    .setVersion('0.1.0')
    .addGlobalParameters({
      name: 'x-request-id',
      in: 'header',
      required: false,
      description: 'Optional request id for tracing.'
    });
  const documentConfig = (options.configure ?? ((value: DocumentBuilder) => value.addBearerAuth()))(builder).build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  SwaggerModule.setup(options.path, app, document, {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true
    }
  });
}

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { createShinmoneRuntimeIntegration } from './shinmone-runtime.registration';
import { createCustomerConnectorRuntimeApplication } from '../../src/main';

export async function createShinmoneRuntimeApplication(
  environment: Record<string, unknown> = process.env
): Promise<INestApplication> {
  if (environment.SHINMONE_RUNTIME_TOOL_MODE !== 'kpistats-demo') {
    throw new Error('Shinmone Runtime tool mode must be kpistats-demo.');
  }
  const integration = createShinmoneRuntimeIntegration({ toolMode: 'kpistats-demo' });
  if (!matchesConfiguration(environment.CONNECTOR_MANIFEST_FILES, integration.manifestFiles) ||
      !matchesConfiguration(environment.CONNECTOR_CREDENTIAL_PROFILES_JSON, integration.credentialProfiles)) {
    throw new Error('Shinmone Runtime manifest or credential profile configuration does not match the selected tool mode.');
  }
  return createCustomerConnectorRuntimeApplication(environment, integration.bootstrapProviders, {
    credentialProviders: integration.credentialProviders,
    credentialStrategies: integration.credentialStrategies
  });
}

export async function bootstrapShinmoneRuntime(): Promise<INestApplication> {
  const app = await createShinmoneRuntimeApplication();
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3100);
  return app;
}

function matchesConfiguration(value: unknown, expected: readonly unknown[]): boolean {
  if (typeof value !== 'string') return false;
  try { return JSON.stringify(JSON.parse(value)) === JSON.stringify(expected); }
  catch { return false; }
}

if (require.main === module) void bootstrapShinmoneRuntime();

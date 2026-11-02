import 'reflect-metadata';
import process from 'node:process';
import { basename } from 'node:path';
import runtimeModule from '../../apps/customer-connector-runtime/dist/src/main.js';
import shinmoneModule from '../../apps/customer-connector-runtime/dist/integrations/shinmone/index.js';

const { createCustomerConnectorRuntimeApplication } = runtimeModule;
const { createShinmoneRuntimeIntegration } = shinmoneModule;

const toolMode = process.env.SHINMONE_LOCAL_TOOL_MODE;
if (toolMode !== 'c01' && toolMode !== 'kpistats-demo') {
  throw new Error('Shinmone local tool mode is not configured.');
}
const integration = createShinmoneRuntimeIntegration({ toolMode });
const configuredManifests = JSON.parse(process.env.CONNECTOR_MANIFEST_FILES ?? '[]');
if (!Array.isArray(configuredManifests) ||
    JSON.stringify(configuredManifests.map((path) => typeof path === 'string' ? basename(path) : null)) !==
    JSON.stringify(integration.manifestFiles.map((path) => basename(path)))) {
  throw new Error('Shinmone local Connector manifests do not match the selected tool mode.');
}
const app = await createCustomerConnectorRuntimeApplication(
  process.env,
  integration.bootstrapProviders,
  {
    credentialProviders: integration.credentialProviders,
    credentialStrategies: integration.credentialStrategies
  }
);
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3100);

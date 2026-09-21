import 'reflect-metadata';
import process from 'node:process';
import runtimeModule from '../../apps/customer-connector-runtime/dist/src/main.js';
import shinmoneModule from '../../apps/customer-connector-runtime/dist/integrations/shinmone/index.js';

const { createCustomerConnectorRuntimeApplication } = runtimeModule;
const { createShinmoneRuntimeIntegration } = shinmoneModule;

const integration = createShinmoneRuntimeIntegration();
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

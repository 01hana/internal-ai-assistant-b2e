import { Module } from '@nestjs/common';
import {
  DATA_ADAPTER_REGISTRATIONS,
  DataAdapterRegistrations
} from './data-adapter-registration';
import { DataAdapterRegistry } from './data-adapter-registry.service';
import { AdapterResultProjectorService } from './adapter-result-projector.service';
import { PermissionsModule } from '../permissions/permissions.module';
import {
  MOCK_DATA_ADAPTER_REGISTRATIONS,
  MockConnectorModule
} from './mock/mock-connector.module';
import { ToolsModule } from '../tools/tools.module';
import { ToolRegistryService } from '../tools/tool-registry.service';
import {
  createProductizedAdapterRegistrations,
  PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS
} from './productized-business/productized-adapter-binding.registry';
import {
  ProductizedBusinessConnectorModule,
  ProductizedBusinessConnectorTransportService
} from './productized-business/productized-business-connector.module';

export const EMPTY_DATA_ADAPTER_REGISTRATIONS: DataAdapterRegistrations = Object.freeze([]);

@Module({
  imports: [
    PermissionsModule,
    MockConnectorModule,
    ToolsModule,
    ProductizedBusinessConnectorModule.register()
  ],
  providers: [
    {
      provide: PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS,
      useFactory: (
        toolRegistry: ToolRegistryService,
        transport: ProductizedBusinessConnectorTransportService
      ) => createProductizedAdapterRegistrations(process.env, toolRegistry, transport),
      inject: [ToolRegistryService, ProductizedBusinessConnectorTransportService]
    },
    {
      provide: DATA_ADAPTER_REGISTRATIONS,
      useFactory: (productized: DataAdapterRegistrations): DataAdapterRegistrations => Object.freeze([
        ...MOCK_DATA_ADAPTER_REGISTRATIONS,
        ...productized
      ]),
      inject: [PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS]
    },
    DataAdapterRegistry,
    AdapterResultProjectorService
  ],
  exports: [DATA_ADAPTER_REGISTRATIONS, DataAdapterRegistry, AdapterResultProjectorService]
})
export class ConnectorsModule {}

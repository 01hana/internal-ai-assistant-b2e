import { Module } from '@nestjs/common';
import { MockConnectorAdapter } from './mock-connector.adapter';

@Module({
  providers: [MockConnectorAdapter],
  exports: [MockConnectorAdapter]
})
export class MockConnectorModule {}

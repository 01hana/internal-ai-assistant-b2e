import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ToolPermissionPrecheckService } from './tool-permission-precheck.service';

@Module({
  imports: [AuditModule],
  providers: [ToolPermissionPrecheckService],
  exports: [ToolPermissionPrecheckService]
})
export class PermissionsModule {}

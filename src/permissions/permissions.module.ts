import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LlmInputSanitizerService } from './llm-input-sanitizer.service';
import { ToolPermissionPrecheckService } from './tool-permission-precheck.service';

@Module({
  imports: [AuditModule],
  providers: [LlmInputSanitizerService, ToolPermissionPrecheckService],
  exports: [LlmInputSanitizerService, ToolPermissionPrecheckService]
})
export class PermissionsModule {}

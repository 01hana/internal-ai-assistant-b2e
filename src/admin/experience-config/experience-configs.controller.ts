import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { ExperienceConfigActivateDto, ExperienceConfigInputDto, ExperienceVersionTableQueryDto } from './experience-configs.dto';
import { ExperienceConfigsService } from './experience-configs.service';

/** Feature 016: greeting, Quick Replies and follow-ups per integration. Saving takes effect at once. */
@Controller('experienceConfigs')
export class ExperienceConfigsController {
  constructor(private readonly configs: ExperienceConfigsService) {}

  @Get('getIntegrations')
  @RequirePermission('read', 'ExperienceConfig')
  integrations() {
    return this.configs.integrations();
  }

  /** The active configuration's editable fields; `config` is null before the first save. */
  @Get(':integrationId')
  @RequirePermission('read', 'ExperienceConfig')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('integrationId') integrationId: string) {
    return this.configs.get(admin, integrationId);
  }

  /** Capabilities and parameters Quick Replies and follow-ups may reference. */
  @Get(':integrationId/catalog')
  @RequirePermission('read', 'ExperienceConfig')
  catalog(@Param('integrationId') integrationId: string) {
    return this.configs.catalog(integrationId);
  }

  /** Checks without saving: `{ valid, errors: [{ path, code }] }`. */
  @Post(':integrationId/validate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('update', 'ExperienceConfig')
  validate(@Param('integrationId') integrationId: string, @Body() body: ExperienceConfigInputDto) {
    return this.configs.validate(integrationId, body);
  }

  @Post(':integrationId/versions/getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'ExperienceConfig')
  versions(@CurrentAdmin() admin: AdminPrincipal, @Param('integrationId') integrationId: string, @Body() query: ExperienceVersionTableQueryDto) {
    return this.configs.versions(admin, integrationId, query);
  }

  /** `valid: false` (with errors, without content) for an old version that no longer parses. */
  @Get(':integrationId/versions/:configVersion')
  @RequirePermission('read', 'ExperienceConfig')
  version(@CurrentAdmin() admin: AdminPrincipal, @Param('integrationId') integrationId: string, @Param('configVersion') configVersion: string) {
    return this.configs.version(admin, integrationId, configVersion);
  }

  /** Makes an earlier version active again (no new version number). */
  @Post(':integrationId/versions/:configVersion/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('update', 'ExperienceConfig')
  activate(@CurrentAdmin() admin: AdminPrincipal, @Param('integrationId') integrationId: string, @Param('configVersion') configVersion: string,
    @Body() body: ExperienceConfigActivateDto, @Req() request: AdminRequest) {
    return this.configs.activate(admin, integrationId, configVersion, body, requestMeta(request));
  }

  /** Saves a new version and makes it active. 409 when `baseConfigVersion` is no longer the active one. */
  @Post(':integrationId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('update', 'ExperienceConfig')
  save(@CurrentAdmin() admin: AdminPrincipal, @Param('integrationId') integrationId: string, @Body() body: ExperienceConfigInputDto,
    @Req() request: AdminRequest) {
    return this.configs.save(admin, integrationId, body, requestMeta(request));
  }
}

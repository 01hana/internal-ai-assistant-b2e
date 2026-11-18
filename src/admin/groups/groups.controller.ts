import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { RequireAnyPermission, RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { IdsDto } from '../common/ids.dto';
import { CreateGroupDto, GroupTableQueryDto, UpdateGroupDto } from './groups.dto';
import { GroupsService } from './groups.service';

/** Feature 014 US3. Paths follow the admin template (`groups/getTable`, `getOptions`, `DELETE groups` with `ids`). */
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'UserGroup')
  table(@CurrentAdmin() admin: AdminPrincipal, @Body() query: GroupTableQueryDto) {
    return this.groups.table(admin, query);
  }

  /** Group choices when creating or editing a user. */
  @Get('getOptions')
  @RequireAnyPermission(['read', 'UserGroup'], ['read', 'User'])
  options(@CurrentAdmin() admin: AdminPrincipal) {
    return this.groups.options(admin);
  }

  /** Rows (subjects) and columns (actions) of the group permission matrix. */
  @Get('getPermissions')
  @RequirePermission('read', 'UserGroup')
  permissions() {
    return this.groups.permissions();
  }

  @Get(':id')
  @RequirePermission('read', 'UserGroup')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    return this.groups.get(admin, id);
  }

  @Post()
  @RequirePermission('create', 'UserGroup')
  create(@CurrentAdmin() admin: AdminPrincipal, @Body() body: CreateGroupDto, @Req() request: AdminRequest) {
    return this.groups.create(admin, body, requestMeta(request));
  }

  @Patch(':id')
  @RequirePermission('update', 'UserGroup')
  update(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body() body: UpdateGroupDto, @Req() request: AdminRequest) {
    return this.groups.update(admin, id, body, requestMeta(request));
  }

  @Delete()
  @RequirePermission('delete', 'UserGroup')
  remove(@CurrentAdmin() admin: AdminPrincipal, @Body() body: IdsDto, @Req() request: AdminRequest) {
    return this.groups.remove(admin, body, requestMeta(request));
  }
}

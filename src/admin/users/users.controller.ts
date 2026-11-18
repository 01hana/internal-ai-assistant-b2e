import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { IdsDto } from '../common/ids.dto';
import { BatchStatusDto, CreateUserDto, UpdateUserDto, UserTableQueryDto } from './users.dto';
import { UsersService } from './users.service';

/** Feature 014 US4. Paths follow the admin template (`users/getTable`, `getFilters`, `batch`, `DELETE users` with `ids`). */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'User')
  table(@CurrentAdmin() admin: AdminPrincipal, @Body() query: UserTableQueryDto) {
    return this.users.table(admin, query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'User')
  filters(@CurrentAdmin() admin: AdminPrincipal) {
    return this.users.filters(admin);
  }

  /** Enable (`status: true`) or disable several users. */
  @Patch('batch')
  @RequirePermission('update', 'User')
  setStatus(@CurrentAdmin() admin: AdminPrincipal, @Body() body: BatchStatusDto, @Req() request: AdminRequest) {
    return this.users.setStatus(admin, body, requestMeta(request));
  }

  @Get(':id')
  @RequirePermission('read', 'User')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    return this.users.get(admin, id);
  }

  /** Creates the user and mails the first-login link; `inviteSent: false` when the mail could not be sent. */
  @Post()
  @RequirePermission('create', 'User')
  create(@CurrentAdmin() admin: AdminPrincipal, @Body() body: CreateUserDto, @Req() request: AdminRequest) {
    return this.users.create(admin, body, requestMeta(request));
  }

  @Put(':id')
  @RequirePermission('update', 'User')
  update(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Body() body: UpdateUserDto, @Req() request: AdminRequest) {
    return this.users.update(admin, id, body, requestMeta(request));
  }

  @Post(':id/resendInvite')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('update', 'User')
  resendInvite(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Req() request: AdminRequest) {
    return this.users.resendInvite(admin, id, requestMeta(request));
  }

  @Delete()
  @RequirePermission('delete', 'User')
  remove(@CurrentAdmin() admin: AdminPrincipal, @Body() body: IdsDto, @Req() request: AdminRequest) {
    return this.users.remove(admin, body, requestMeta(request));
  }
}

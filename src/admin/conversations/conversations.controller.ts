import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { ConversationTableQueryDto } from './conversations.dto';
import { ConversationsService } from './conversations.service';

/** Feature 015 US1. Titles and messages are conversation content: every route needs `Conversation:read`. */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'Conversation')
  table(@Body() query: ConversationTableQueryDto) {
    return this.conversations.table(query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'Conversation')
  filters() {
    return this.conversations.filters();
  }

  /** Writes `admin_conversation_viewed` on every read. */
  @Get(':id')
  @RequirePermission('read', 'Conversation')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Req() request: AdminRequest) {
    return this.conversations.get(admin, id, requestMeta(request));
  }
}

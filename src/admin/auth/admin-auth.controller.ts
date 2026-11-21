import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { UserTokenPurpose } from '../../generated/prisma/client';
import { PublicRoute, SignedInRoute } from '../authorization/route-access.decorator';
import { type AdminRequest, requestMeta } from '../common/admin-request';
import { ADMIN_CSRF_COOKIE, ADMIN_SESSION_ABSOLUTE_MS, ADMIN_SESSION_COOKIE, AdminSettings } from '../config/admin-settings';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, SetPasswordDto, TokenDto } from './auth.dto';
import { AdminAuthService, type ProfileView } from './admin-auth.service';
import { AdminThrottlerGuard, LINK_ENDPOINT_LIMITS, SKIP_ACCOUNT_LIMIT } from './admin-throttler.guard';

/** Feature 014 US2. Paths follow the admin template (`auth/login`, `auth/profile`, `auth/firstLogin`, …). */
@Controller('auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService, private readonly settings: AdminSettings) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  @UseGuards(AdminThrottlerGuard)
  async login(@Body() body: LoginDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response): Promise<ProfileView> {
    const { sessionToken, csrfToken, ...profile } = await this.auth.login(body.account, body.password, requestMeta(request));
    response.cookie(ADMIN_SESSION_COOKIE, sessionToken, this.cookieOptions(true));
    response.cookie(ADMIN_CSRF_COOKIE, csrfToken, this.cookieOptions(false));
    return profile;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @SignedInRoute()
  async logout(@Req() request: AdminRequest, @Res({ passthrough: true }) response: Response): Promise<null> {
    await this.auth.logout(request.adminPrincipal!, requestMeta(request));
    const { maxAge: _sessionMaxAge, ...sessionCookie } = this.cookieOptions(true);
    const { maxAge: _csrfMaxAge, ...csrfCookie } = this.cookieOptions(false);
    response.clearCookie(ADMIN_SESSION_COOKIE, sessionCookie);
    response.clearCookie(ADMIN_CSRF_COOKIE, csrfCookie);
    return null;
  }

  @Get('profile')
  @SignedInRoute()
  profile(@Req() request: AdminRequest): ProfileView {
    return this.auth.profile(request.adminPrincipal!.user);
  }

  /** Changes the signed-in user's password (limited per IP like the mail-link endpoints). */
  @Put('profile')
  @SignedInRoute()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(LINK_ENDPOINT_LIMITS)
  @SkipThrottle(SKIP_ACCOUNT_LIMIT)
  async changePassword(@Body() body: ChangePasswordDto, @Req() request: AdminRequest): Promise<null> {
    await this.auth.changePassword(request.adminPrincipal!, body.currentPassword, body.newPassword, requestMeta(request));
    return null;
  }

  @Post('verifyToken')
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(LINK_ENDPOINT_LIMITS)
  @SkipThrottle(SKIP_ACCOUNT_LIMIT)
  verifyToken(@Body() body: TokenDto, @Req() request: AdminRequest) {
    return this.auth.verifyToken(body.token, requestMeta(request));
  }

  @Post('firstLogin')
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(LINK_ENDPOINT_LIMITS)
  @SkipThrottle(SKIP_ACCOUNT_LIMIT)
  async firstLogin(@Body() body: SetPasswordDto, @Req() request: AdminRequest): Promise<null> {
    await this.auth.setPassword(UserTokenPurpose.first_login, body.token, body.password, requestMeta(request));
    return null;
  }

  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(LINK_ENDPOINT_LIMITS)
  @SkipThrottle(SKIP_ACCOUNT_LIMIT)
  async forgot(@Body() body: ForgotPasswordDto, @Req() request: AdminRequest): Promise<{ accepted: true }> {
    await this.auth.forgotPassword(body.email, requestMeta(request));
    return { accepted: true };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @PublicRoute()
  @UseGuards(AdminThrottlerGuard)
  @Throttle(LINK_ENDPOINT_LIMITS)
  @SkipThrottle(SKIP_ACCOUNT_LIMIT)
  async reset(@Body() body: SetPasswordDto, @Req() request: AdminRequest): Promise<null> {
    await this.auth.setPassword(UserTokenPurpose.reset_password, body.token, body.password, requestMeta(request));
    return null;
  }

  /** Session cookie: httpOnly, scoped to the API. CSRF cookie: readable by the admin website. */
  private cookieOptions(httpOnly: boolean): CookieOptions {
    return {
      httpOnly,
      secure: this.settings.cookieSecure,
      sameSite: 'strict',
      path: httpOnly ? '/api/v1/admin' : '/',
      maxAge: ADMIN_SESSION_ABSOLUTE_MS
    };
  }
}

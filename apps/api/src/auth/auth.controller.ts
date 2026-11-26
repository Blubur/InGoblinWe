import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '@goblins/core';
import { parse } from '../common/parse';
import { APP_CONFIG } from '../infra/tokens';
import type { Tenant } from '../tenant/tenant';
import type { AuthContext, AuthRequest } from './auth';
import { AuthService, type SessionResult } from './auth.service';
import { loginSchema, registerSchema } from './schemas';
import { readCookie, sessionCookieName, sessionCookieOptions } from './session-cookie';

function publicAuth(auth: AuthContext) {
  return {
    user: {
      id: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
      role: auth.role,
      canCreateCommunities: auth.canCreateCommunities,
    },
    csrfToken: auth.csrfToken,
  };
}

@Controller('auth')
export class AuthController {
  private readonly production: boolean;
  private readonly cookieName: string;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.production = config.NODE_ENV === 'production';
    this.cookieName = sessionCookieName(this.production);
  }

  @Post('register')
  async register(@Req() req: AuthRequest, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(this.tenantOf(req), parse(registerSchema, body));
    return this.startSession(res, result, 201);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() req: AuthRequest, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    // Una sesión anterior de este navegador se cierra: cada login estrena token.
    const previous = readCookie(req.headers.cookie, this.cookieName);
    if (previous) await this.auth.logout(previous);
    const result = await this.auth.login(this.tenantOf(req), parse(loginSchema, body));
    return this.startSession(res, result, 200);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readCookie(req.headers.cookie, this.cookieName);
    if (token) await this.auth.logout(token);
    res.clearCookie(this.cookieName, sessionCookieOptions(this.production, 0));
  }

  @Get('me')
  me(@Req() req: AuthRequest) {
    if (!req.auth) throw new UnauthorizedException('No has iniciado sesión');
    return publicAuth(req.auth);
  }

  private tenantOf(req: AuthRequest): Tenant {
    if (!req.tenant) throw new InternalServerErrorException('Contexto de comunidad no resuelto');
    return req.tenant;
  }

  private startSession(res: Response, result: SessionResult, status: number) {
    res.status(status);
    res.cookie(this.cookieName, result.token, sessionCookieOptions(this.production, this.config.SESSION_TTL_HOURS * 3600));
    return publicAuth(result.auth);
  }
}

import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { IUserMeVo } from '@teable/openapi';
import { Response } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { AuthService } from './auth.service';
import { TokenAccess } from './decorators/token.decorator';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signout')
  @HttpCode(200)
  async signout(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Get('/user/me')
  async me(@Req() request: Express.Request) {
    return request.user;
  }

  @Get('/user')
  @TokenAccess()
  async user(@Req() request: Express.Request) {
    return this.authService.getUserInfo(request.user as IUserMeVo);
  }
}

import { Body, Controller, Get, HttpCode, Post, Request, Res, UseGuards } from '@nestjs/common';
import { ISignup, signupSchema } from '@teable-group/openapi';
import { Response } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { AuthGuard } from './guard/auth.guard';
import { LocalAuthGuard } from './guard/local-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('signin')
  async signin(@Request() req: Express.Request) {
    return req.user;
  }

  @Post('signout')
  @HttpCode(200)
  async signout(@Request() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Public()
  @Post('signup')
  async signup(@Body(new ZodValidationPipe(signupSchema)) body: ISignup) {
    return await this.authService.signup(body.email, body.password);
  }

  @UseGuards(AuthGuard)
  @Get('/user/me')
  async me(@Request() request: Express.Request) {
    return request.user;
  }
}

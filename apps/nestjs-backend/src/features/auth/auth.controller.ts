import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { IUserMeVo } from '@teable/openapi';
import {
  IAddPasswordRo,
  IChangePasswordRo,
  IResetPasswordRo,
  ISendResetPasswordEmailRo,
  ISignup,
  addPasswordRoSchema,
  changePasswordRoSchema,
  resetPasswordRoSchema,
  sendResetPasswordEmailRoSchema,
  signupSchema,
} from '@teable/openapi';
import { Response, Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { TokenAccess } from './decorators/token.decorator';
import { LocalAuthGuard } from './guard/local-auth.guard';
import { pickUserMe } from './utils';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('signin')
  async signin(@Req() req: Express.Request) {
    return req.user;
  }

  @Post('signout')
  @HttpCode(200)
  async signout(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: ISignup,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Express.Request
  ) {
    const user = pickUserMe(
      await this.authService.signup(body.email, body.password, body.defaultSpaceName)
    );
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
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

  @Patch('/change-password')
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRoSchema)) changePasswordRo: IChangePasswordRo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.changePassword(changePasswordRo);
    await this.authService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Post('/send-reset-password-email')
  @Public()
  async sendResetPasswordEmail(
    @Body(new ZodValidationPipe(sendResetPasswordEmailRoSchema)) body: ISendResetPasswordEmailRo
  ) {
    return this.authService.sendResetPasswordEmail(body.email);
  }

  @Post('/reset-password')
  @Public()
  async resetPassword(
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(resetPasswordRoSchema)) body: IResetPasswordRo
  ) {
    await this.authService.resetPassword(body.code, body.password);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Post('/add-password')
  async addPassword(
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(addPasswordRoSchema)) body: IAddPasswordRo
  ) {
    await this.authService.addPassword(body.password);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }
}

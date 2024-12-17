import { Body, Controller, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
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
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Public } from '../decorators/public.decorator';
import { LocalAuthGuard } from '../guard/local-auth.guard';
import { SessionService } from '../session/session.service';
import { pickUserMe } from '../utils';
import { LocalAuthService } from './local-auth.service';

@Controller('api/auth')
export class LocalAuthController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly authService: LocalAuthService
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('signin')
  async signin(@Req() req: Express.Request): Promise<IUserMeVo> {
    return req.user as IUserMeVo;
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: ISignup,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Express.Request
  ): Promise<IUserMeVo> {
    const user = pickUserMe(
      await this.authService.signup(body.email, body.password, body.defaultSpaceName, body.refMeta)
    );
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
  }

  @Patch('/change-password')
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRoSchema)) changePasswordRo: IChangePasswordRo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    await this.authService.changePassword(changePasswordRo);
    await this.sessionService.signout(req);
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

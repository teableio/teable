import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type {
  IUserMeVo,
  IWaitlistInviteCodeVo,
  IJoinWaitlistVo,
  IGetWaitlistVo,
  IInviteWaitlistVo,
} from '@teable/openapi';
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
  sendSignupVerificationCodeRoSchema,
  signupSchema,
  ISendSignupVerificationCodeRo,
  changeEmailRoSchema,
  IChangeEmailRo,
  sendChangeEmailCodeRoSchema,
  ISendChangeEmailCodeRo,
  joinWaitlistSchemaRo,
  IJoinWaitlistRo,
  IWaitlistInviteCodeRo,
  waitlistInviteCodeRoSchema,
  inviteWaitlistRoSchema,
  IInviteWaitlistRo,
} from '@teable/openapi';
import { Response, Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Permissions } from '../decorators/permissions.decorator';
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
  async signin(@Req() req: Request): Promise<IUserMeVo> {
    return req.user as IUserMeVo;
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: ISignup,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ): Promise<IUserMeVo> {
    const remoteIp =
      req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);
    const user = pickUserMe(await this.authService.signup(body, remoteIp));
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
  }

  @Public()
  @Post('join-waitlist')
  async joinWaitlist(
    @Body(new ZodValidationPipe(joinWaitlistSchemaRo)) ro: IJoinWaitlistRo
  ): Promise<IJoinWaitlistVo> {
    await this.authService.joinWaitlist(ro.email);
    return ro;
  }

  @Post('invite-waitlist')
  @Permissions('instance|update')
  async inviteWaitlist(
    @Body(new ZodValidationPipe(inviteWaitlistRoSchema)) ro: IInviteWaitlistRo
  ): Promise<IInviteWaitlistVo> {
    return await this.authService.inviteWaitlist(ro.list);
  }

  @Get('waitlist')
  @Permissions('instance|read')
  async getWaitlist(): Promise<IGetWaitlistVo> {
    return await this.authService.getWaitlist();
  }

  @Post('waitlist-invite-code')
  @Permissions('instance|update')
  async genWaitlistInviteCode(
    @Body(new ZodValidationPipe(waitlistInviteCodeRoSchema)) ro: IWaitlistInviteCodeRo
  ): Promise<IWaitlistInviteCodeVo> {
    const list: IWaitlistInviteCodeVo = [];
    const times = Math.max(ro.times ?? 1, 1);
    for (let i = 0; i < ro.count; i++) {
      const code = await this.authService.genWaitlistInviteCode(times);
      list.push({
        code,
        times,
      });
    }
    return list;
  }

  @Public()
  @Post('send-signup-verification-code')
  @HttpCode(200)
  async sendSignupVerificationCode(
    @Body(new ZodValidationPipe(sendSignupVerificationCodeRoSchema))
    body: ISendSignupVerificationCodeRo,
    @Req() req: Request
  ) {
    const remoteIp =
      req.ip || req.connection.remoteAddress || (req.headers['x-forwarded-for'] as string);

    return this.authService.sendSignupVerificationCodeWithTurnstile(
      body.email,
      body.turnstileToken,
      remoteIp
    );
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
    @Req() req: Request,
    @Body(new ZodValidationPipe(resetPasswordRoSchema)) body: IResetPasswordRo
  ) {
    await this.authService.resetPassword(body.code, body.password);
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Post('/add-password')
  async addPassword(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @Body(new ZodValidationPipe(addPasswordRoSchema)) body: IAddPasswordRo
  ) {
    await this.authService.addPassword(body.password);
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Patch('/change-email')
  async changeEmail(
    @Body(new ZodValidationPipe(changeEmailRoSchema)) body: IChangeEmailRo,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    await this.authService.changeEmail(body.email, body.token, body.code);
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @Post('/send-change-email-code')
  @HttpCode(200)
  async sendChangeEmailCode(
    @Body(new ZodValidationPipe(sendChangeEmailCodeRoSchema)) body: ISendChangeEmailCodeRo
  ) {
    return this.authService.sendChangeEmailCode(body.email, body.password);
  }
}

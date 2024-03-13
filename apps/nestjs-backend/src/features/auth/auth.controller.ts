import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IChangePasswordRo, ISignup, changePasswordRoSchema, signupSchema } from '@teable/openapi';
import { Response, Request } from 'express';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
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
if (process.env.DISABLE_SIGNUP === 'true') {
    throw new ForbiddenException('Sign-up is disabled.');
  }  
    const user = pickUserMe(await this.authService.signup(body.email, body.password));
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    return user;
  }

  @Get('/user/me')
  async me(@Req() request: Express.Request) {
    return { ...request.user!, _session_ticket: request.sessionID };
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
}

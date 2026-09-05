import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type {
  ICreateMobileAuthCodeRo,
  ICreateMobileAuthCodeVo,
  ICreateMobileWebSessionCodeVo,
  IExchangeMobileAuthCodeRo,
  IMobileWebSessionQuery,
  IUserMeVo,
} from '@teable/openapi';
import {
  createMobileAuthCodeRoSchema,
  exchangeMobileAuthCodeRoSchema,
  mobileWebSessionQuerySchema,
} from '@teable/openapi';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { ISessionData } from '../../../types/session';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { Public } from '../decorators/public.decorator';
import { describeSessionClient, isValidRedirectPath } from '../utils';
import { CookieSessionGuard } from './cookie-session.guard';
import { MobileAuthService } from './mobile-auth.service';

/** passport session login; express-session then sets the `auth_session` cookie. */
const login = (req: Request, user: IUserMeVo) =>
  new Promise<void>((resolve, reject) => {
    req.login(user, (err) => (err ? reject(err) : resolve()));
  });

@Controller('api/auth/mobile')
export class MobileAuthController {
  constructor(
    private readonly mobileAuthService: MobileAuthService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /** Called by the `/auth/mobile` consent page when the user confirms the sign-in. */
  @Post('code')
  @UseGuards(CookieSessionGuard)
  async createCode(
    @Body(new ZodValidationPipe(createMobileAuthCodeRoSchema)) ro: ICreateMobileAuthCodeRo
  ): Promise<ICreateMobileAuthCodeVo> {
    return this.mobileAuthService.createCode(this.cls.get('user.id'), ro);
  }

  /** Called by the app with the code from its callback URL; signs the request in. */
  @Public()
  @HttpCode(200)
  @Post('exchange')
  async exchange(
    @Body(new ZodValidationPipe(exchangeMobileAuthCodeRoSchema)) ro: IExchangeMobileAuthCodeRo,
    @Req() req: Request
  ): Promise<IUserMeVo> {
    const user = await this.mobileAuthService.exchange(ro);
    await login(req, user);
    (req.session as Partial<ISessionData>).client = describeSessionClient(req);
    return user;
  }

  /** Called by the signed-in app before it points a WebView at `web-session`. */
  @Post('web-session-code')
  @UseGuards(CookieSessionGuard)
  async createWebSessionCode(@Req() req: Request): Promise<ICreateMobileWebSessionCodeVo> {
    return this.mobileAuthService.createWebSessionCode(this.cls.get('user.id'), req.sessionID);
  }

  /**
   * Loaded by an app WebView: signs that browser context in as the same user and lands on
   * `redirect`. Guarded against being used as a link: the request must carry the app's
   * `X-Teable-Client` header (a pasted URL in a normal browser cannot), a browser already
   * signed in as somebody else is refused, and the code only works while the native session
   * that minted it is alive. The new session is tied to that native session.
   */
  @Public()
  @Get('web-session')
  async webSession(
    @Query(new ZodValidationPipe(mobileWebSessionQuerySchema)) query: IMobileWebSessionQuery,
    @Headers('x-teable-client') client: string | undefined,
    @Req() req: Request & { session?: Partial<ISessionData> },
    @Res() res: Response
  ) {
    if (!client) {
      throw new BadRequestException('This link can only be opened by the Teable app');
    }
    const { user, parentSessionId } = await this.mobileAuthService.consumeWebSessionCode(
      query.code
    );
    const current = req.session?.passport?.user?.id;
    if (current && current !== user.id) {
      throw new ForbiddenException('This browser is signed in as a different user');
    }
    await login(req, user);
    (req.session as Partial<ISessionData>).client = describeSessionClient(req);
    await this.mobileAuthService.registerChildSession(parentSessionId, req.sessionID);
    const target =
      query.redirect && isValidRedirectPath(query.redirect) ? query.redirect : '/space';
    res.redirect(target);
  }
}

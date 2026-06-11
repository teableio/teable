import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpErrorCode, isAnonymous } from '@teable/core';
import {
  deleteUserSchemaRo,
  IDeleteUserSchema,
  type IGetTempTokenVo,
  type IUserMeVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { ExternalOAuth2Service } from '../external-oauth2/external-oauth2.service';
import { DeleteUserService } from '../user/delete-user/delete-user.service';
import { AuthService } from './auth.service';
import { AllowAnonymous, AllowAnonymousType } from './decorators/allow-anonymous.decorator';
import { TokenAccess } from './decorators/token.decorator';
import { SessionService } from './session/session.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly cls: ClsService<IClsStore>,
    private readonly deleteUserService: DeleteUserService,
    private readonly externalOAuth2Service: ExternalOAuth2Service
  ) {}

  private async ensureExternalOAuth2TokenValid(
    request: Express.Request,
    res: Response
  ): Promise<boolean> {
    const user = request.user as Partial<IUserMeVo> | undefined;
    const userId = typeof user?.id === 'string' ? user.id : '';
    const authenticated = Boolean(userId) && !isAnonymous(userId);
    if (!authenticated) return false;

    const valid = await this.externalOAuth2Service.validateUserAccessToken(userId);
    if (!valid) {
      await this.externalOAuth2Service.clearUserAccessToken(userId);
      await this.sessionService.signout(request);
      res.clearCookie(AUTH_SESSION_COOKIE_NAME);
      return false;
    }
    return true;
  }

  @Post('signout')
  @HttpCode(200)
  async signout(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as Partial<IUserMeVo> | undefined;
    if (user?.id && !isAnonymous(user.id as string)) {
      await this.externalOAuth2Service.clearUserAccessToken(user.id as string);
    }
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @AllowAnonymous(AllowAnonymousType.USER)
  @Get('/user/me')
  async me(@Req() request: Express.Request, @Res({ passthrough: true }) res: Response) {
    const valid = await this.ensureExternalOAuth2TokenValid(request, res);
    if (!valid) {
      throw new UnauthorizedException('unauthorized');
    }
    return {
      ...request.user,
      organization: this.cls.get('organization'),
    };
  }

  /**
   * GET /api/auth/me
   * Frontend-friendly login status endpoint.
   */
  @AllowAnonymous(AllowAnonymousType.USER)
  @Get('/me')
  async authMe(@Req() request: Express.Request, @Res({ passthrough: true }) res: Response) {
    const user = request.user as Partial<IUserMeVo> | undefined;
    const authenticated = await this.ensureExternalOAuth2TokenValid(request, res);
    return {
      authenticated,
      user: authenticated ? user : undefined,
    };
  }

  @Get('/user')
  @TokenAccess()
  async user(@Req() request: Express.Request) {
    return this.authService.getUserInfo(request.user as IUserMeVo);
  }

  @Get('temp-token')
  async tempToken(): Promise<IGetTempTokenVo> {
    return this.authService.getTempToken();
  }

  @Delete('user')
  async deleteUser(
    @Req() req: Express.Request,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(deleteUserSchemaRo)) query: IDeleteUserSchema
  ) {
    if (query.confirm !== 'DELETE') {
      throw new CustomHttpException('Invalid confirm', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.auth.invalidConfirm',
        },
      });
    }
    await this.deleteUserService.deleteUser();
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }
}

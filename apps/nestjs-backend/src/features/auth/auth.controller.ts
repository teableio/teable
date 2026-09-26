import { Controller, Delete, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import {
  deleteUserSchemaRo,
  IDeleteUserSchema,
  type IDeleteUserSpacesVo,
  type IGetTempTokenVo,
  type IUserMeVo,
} from '@teable/openapi';
import { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AUTH_SESSION_COOKIE_NAME } from '../../const';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { AuditScope } from '../audit/audit-scope';
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
    private readonly audit: AuditScope
  ) {}

  @AllowAnonymous(AllowAnonymousType.USER)
  @Post('signout')
  @HttpCode(200)
  async signout(@Req() req: Express.Request, @Res({ passthrough: true }) res: Response) {
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  @AllowAnonymous(AllowAnonymousType.USER)
  @Get('/user/me')
  async me(@Req() request: Express.Request) {
    return {
      ...request.user,
      organization: this.cls.get('organization'),
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
    const userId = this.cls.get('user.id');
    // The service is replaced per edition (EE also clears enterprise data), so the self-service
    // deletion is recorded here, once, after it committed and while the session still names the
    // actor. The admin console deletes users through its own path.
    const { trashedSpaceIds } = await this.deleteUserService.deleteUser(query.spaceIds);
    await this.audit.emitAtomic({
      action: 'user.delete',
      resourceId: userId,
      userId,
      params: { trashedSpaceCount: trashedSpaceIds.length, trashedSpaceIds },
    });
    await this.sessionService.signout(req);
    res.clearCookie(AUTH_SESSION_COOKIE_NAME);
  }

  /**
   * What leaves with the account, before anything is pressed: the spaces this user alone
   * owns. The deletion page lists them first and asks for the word, so the press that
   * follows is the last one, not the one that discovers them.
   */
  @Get('user/sole-owner-spaces')
  async getSoleOwnerSpaces(): Promise<IDeleteUserSpacesVo> {
    return { spaces: await this.deleteUserService.listSoleOwnerSpaces() };
  }
}

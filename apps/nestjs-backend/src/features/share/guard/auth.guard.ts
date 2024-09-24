import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ANONYMOUS_USER_ID, HttpErrorCode, IdPrefix } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { ShareAuthService } from '../share-auth.service';
import { SHARE_JWT_STRATEGY } from './constant';

@Injectable()
export class AuthGuard extends PassportAuthGuard(['session', SHARE_JWT_STRATEGY]) {
  constructor(
    private readonly shareAuthService: ShareAuthService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super();
  }

  async validate(context: ExecutionContext, shareId: string) {
    const req = context.switchToHttp().getRequest();
    const isLinkView = shareId.startsWith(IdPrefix.Field);

    if (isLinkView) {
      const activate = (await super.canActivate(context)) as boolean;
      const shareInfo = await this.shareAuthService.getLinkViewInfo(shareId);
      req.shareInfo = shareInfo;
      return activate;
    }

    try {
      const shareInfo = await this.shareAuthService.getShareViewInfo(shareId);
      req.shareInfo = shareInfo;

      this.cls.set('user', {
        id: ANONYMOUS_USER_ID,
        name: ANONYMOUS_USER_ID,
        email: '',
      });

      if (shareInfo.view?.shareMeta?.password) {
        return (await super.canActivate(context)) as boolean;
      }
      return true;
    } catch (err) {
      throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
    }
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    return this.validate(context, shareId);
  }
}

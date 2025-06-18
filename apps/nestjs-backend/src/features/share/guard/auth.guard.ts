import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ANONYMOUS_USER_ID, HttpErrorCode, IdPrefix } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { AuthGuard } from '../../auth/guard/auth.guard';
import { ShareAuthService } from '../share-auth.service';
import { SHARE_JWT_STRATEGY } from './constant';
import { IS_SHARE_LINK_VIEW } from './link-view.decorator';
import { IS_SHARE_SUBMIT_KEY } from './submit.decorator';

@Injectable()
export class ShareAuthGuard extends PassportAuthGuard([SHARE_JWT_STRATEGY]) {
  constructor(
    private readonly shareAuthService: ShareAuthService,
    private readonly cls: ClsService<IClsStore>,
    private readonly authGuard: AuthGuard,
    private readonly reflector: Reflector
  ) {
    super();
  }

  async validate(context: ExecutionContext, shareId: string) {
    const req = context.switchToHttp().getRequest();
    // share link view route
    const isShareLinkView = this.reflector.getAllAndOverride<boolean>(IS_SHARE_LINK_VIEW, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isShareLinkView && shareId.startsWith(IdPrefix.Field)) {
      const activate = (await this.authGuard.validate(context)) as boolean;
      const shareInfo = await this.shareAuthService.getLinkViewInfo(shareId);
      req.shareInfo = shareInfo;
      return activate;
    }

    const shareInfo = await this.shareAuthService.getShareViewInfo(shareId);

    try {
      req.shareInfo = shareInfo;
      // submit route
      const isShareSubmit = this.reflector.getAllAndOverride<boolean>(IS_SHARE_SUBMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      const submit = shareInfo.shareMeta?.submit;
      if (isShareSubmit && submit?.allow && submit?.requireLogin) {
        return this.authGuard.validate(context);
      }

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

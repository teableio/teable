import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { CustomHttpException } from '../../../custom.exception';
import { ShareAuthService } from '../share-auth.service';

@Injectable()
export class ShareAuthLocalGuard implements CanActivate {
  constructor(private readonly shareAuthService: ShareAuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    const password = req.body?.password;
    const authShareId = await this.shareAuthService.authShareView(
      shareId,
      password,
      req.useV2 === true,
      // A public route: the session user, when there is one, is only on the raw session.
      req.session?.passport?.user?.id
    );
    req.shareId = authShareId;
    req.password = password;
    if (!authShareId) {
      throw new CustomHttpException('Incorrect password.', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.share.incorrectPassword',
        },
      });
    }
    return true;
  }
}

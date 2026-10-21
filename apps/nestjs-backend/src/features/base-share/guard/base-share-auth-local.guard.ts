import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { CustomHttpException } from '../../../custom.exception';
import { BaseShareAuthService } from '../base-share-auth.service';

@Injectable()
export class BaseShareAuthLocalGuard implements CanActivate {
  constructor(private readonly baseShareAuthService: BaseShareAuthService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    const password = req.body.password;
    // A public route: the session user, when there is one, is only on the raw session.
    const authShareId = await this.baseShareAuthService.authBaseShare(
      shareId,
      password,
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

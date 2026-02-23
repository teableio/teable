import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ANONYMOUS_USER_ID, HttpErrorCode } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../../custom.exception';
import type { IClsStore } from '../../../types/cls';
import { BaseShareAuthService } from '../base-share-auth.service';
import { BASE_SHARE_JWT_STRATEGY } from './constant';

@Injectable()
export class BaseShareAuthGuard extends PassportAuthGuard([BASE_SHARE_JWT_STRATEGY]) {
  constructor(
    private readonly baseShareAuthService: BaseShareAuthService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super();
  }

  async validate(context: ExecutionContext, shareId: string) {
    const req = context.switchToHttp().getRequest();

    try {
      const shareInfo = await this.baseShareAuthService.getBaseShareInfo(shareId);
      req.baseShareInfo = shareInfo;

      // Only set anonymous user if no user is already authenticated
      // This allows copy operations to preserve the logged-in user's identity
      const currentUserId = this.cls.get('user.id');
      if (!currentUserId) {
        this.cls.set('user', {
          id: ANONYMOUS_USER_ID,
          name: ANONYMOUS_USER_ID,
          email: '',
        });
      }

      // Check if password is required
      const hasPassword = await this.baseShareAuthService.hasPassword(shareId);
      if (hasPassword) {
        return (await super.canActivate(context)) as boolean;
      }
      return true;
    } catch (err) {
      // Re-throw NOT_FOUND errors (share doesn't exist or is disabled)
      if (err instanceof CustomHttpException && err.code === HttpErrorCode.NOT_FOUND) {
        throw err;
      }
      // Other errors are treated as unauthorized (e.g., password required)
      throw new CustomHttpException('Unauthorized', HttpErrorCode.UNAUTHORIZED_SHARE);
    }
  }

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    return this.validate(context, shareId);
  }
}

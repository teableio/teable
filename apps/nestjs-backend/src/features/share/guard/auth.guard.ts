import type { ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { ShareService } from '../share.service';
import { SHARE_JWT_STRATEGY } from './constant';

@Injectable()
export class AuthGuard extends PassportAuthGuard([SHARE_JWT_STRATEGY]) {
  constructor(private readonly shareService: ShareService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const shareId = req.params.shareId;
    try {
      const shareInfo = await this.shareService.getShareViewInfo(shareId);
      req.shareInfo = shareInfo;
      if (shareInfo.view.shareMeta?.password) {
        return (await super.canActivate(context)) as boolean;
      }
      return true;
    } catch (err) {
      throw new UnauthorizedException();
    }
  }
}

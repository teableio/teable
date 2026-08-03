import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { AuthGuard } from '../../auth/guard/auth.guard';
import { ShareAuthGuard } from '../../share/guard/auth.guard';

@Injectable()
export class DynamicAuthGuardFactory implements CanActivate {
  constructor(
    private readonly shareAuthGuard: ShareAuthGuard,
    private readonly authGuard: AuthGuard,
    private readonly cls: ClsService<IClsStore>
  ) {}
  canActivate(context: ExecutionContext) {
    const shareId = context.switchToHttp().getRequest().headers['tea-share-id'];
    if (shareId) {
      this.cls.set('shareViewId', shareId);
      return this.shareAuthGuard.validate(context, shareId);
    }
    return this.authGuard.validate(context);
  }
}

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '../../auth/guard/auth.guard';
import { AuthGuard as ShareAuthGuard } from '../../share/guard/auth.guard';

@Injectable()
export class DynamicAuthGuardFactory implements CanActivate {
  constructor(
    private readonly shareAuthGuard: ShareAuthGuard,
    private readonly authGuard: AuthGuard
  ) {}
  canActivate(context: ExecutionContext) {
    const shareId = context.switchToHttp().getRequest().headers['tea-share-id'];
    if (shareId) {
      return this.shareAuthGuard.validate(context, shareId);
    }
    return this.authGuard.validate(context);
  }
}

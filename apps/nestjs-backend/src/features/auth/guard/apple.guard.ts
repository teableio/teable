import type { ExecutionContext } from '@nestjs/common';
import { Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';
import { AppleAuthException } from '../social/apple/apple-auth.exception';

@Injectable()
export class AppleGuard extends AuthGuard('apple') {
  // Nest 12 no longer inherits the AuthGuard mixin's @Optional() constructor marker.
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: number
  ): TUser {
    const message = info && typeof info === 'object' && 'message' in info ? info.message : info;
    if (!err && !user && message === 'Invalid authorization request state') {
      throw new AppleAuthException('invalid_state');
    }
    return super.handleRequest(err, user, info, context, status);
  }
}

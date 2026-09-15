import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppleAuthException } from '../social/apple/apple-auth.exception';

@Injectable()
export class AppleGuard extends AuthGuard('apple') {
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

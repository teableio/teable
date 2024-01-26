import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ACCESS_TOKEN_STRATEGY_NAME } from '../strategies/constant';
@Injectable()
export class AuthGuard extends PassportAuthGuard(['session', ACCESS_TOKEN_STRATEGY_NAME]) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async validate(context: ExecutionContext) {
    return super.canActivate(context) as Promise<boolean>;
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }
    return this.validate(context);
  }
}

import type { ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { isAnonymous } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { IS_ALLOW_ANONYMOUS } from '../decorators/allow-anonymous.decorator';
import { ENSURE_LOGIN } from '../decorators/ensure-login.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  ACCESS_TOKEN_STRATEGY_NAME,
  ANONYMOUS_STRATEGY_NAME,
  JWT_TOKEN_STRATEGY_NAME,
} from '../strategies/constant';

@Injectable()
export class AuthGuard extends PassportAuthGuard([
  'session',
  ACCESS_TOKEN_STRATEGY_NAME,
  JWT_TOKEN_STRATEGY_NAME,
  ANONYMOUS_STRATEGY_NAME,
]) {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>
  ) {
    super();
  }

  async validate(context: ExecutionContext) {
    const result = (await super.canActivate(context)) as boolean;
    const isAllowAnonymous = this.reflector.getAllAndOverride<boolean>(IS_ALLOW_ANONYMOUS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isAllowAnonymous && isAnonymous(this.cls.get('user.id'))) {
      throw new UnauthorizedException();
    }
    return result;
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    try {
      return await this.validate(context);
    } catch (error) {
      const ensureLogin = this.reflector.getAllAndOverride<boolean>(ENSURE_LOGIN, [
        context.getHandler(),
        context.getClass(),
      ]);
      const res = context.switchToHttp().getResponse();
      const req = context.switchToHttp().getRequest();
      if (ensureLogin) {
        return res.redirect(`/auth/login?redirect=${encodeURIComponent(req.url)}`);
      }
      throw error;
    }
  }
}

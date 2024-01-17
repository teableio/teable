import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
@Injectable()
export class AuthGuard extends PassportAuthGuard(['session']) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async validate(context: ExecutionContext) {
    const activate = await super.canActivate(context);
    const req = context.switchToHttp().getRequest();
    return activate && req.session?.passport?.user;
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

import type { ExecutionContext } from '@nestjs/common';
import { Injectable, Optional } from '@nestjs/common';
import { AuthGuard, AuthModuleOptions } from '@nestjs/passport';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  // Nest 12 no longer inherits the AuthGuard mixin's @Optional() constructor marker.
  constructor(@Optional() options?: AuthModuleOptions) {
    super(options);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const result = (await super.canActivate(context)) as boolean;
    await super.logIn(context.switchToHttp().getRequest());
    return result;
  }
}

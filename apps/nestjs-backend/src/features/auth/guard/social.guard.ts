import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SocialGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    if (req?.query?.error === 'access_denied') {
      res.redirect('/auth/login');
      return false;
    }
    return true;
  }
}

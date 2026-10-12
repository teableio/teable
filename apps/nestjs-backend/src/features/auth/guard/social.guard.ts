import type { ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

// The OAuth 2.0 code and Apple's `form_post` spelling for "the user backed out".
// eslint-disable-next-line @typescript-eslint/naming-convention
const CANCELLED_ERRORS = new Set(['access_denied', 'user_cancelled_authorize']);

@Injectable()
export class SocialGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    // Apple answers with a form POST, so its error lives in the body, not the query.
    const error = req?.query?.error ?? req?.body?.error;
    if (typeof error === 'string' && CANCELLED_ERRORS.has(error)) {
      res.redirect('/auth/login');
      return false;
    }
    return true;
  }
}

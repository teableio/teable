import { Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IOauth2State } from '../../../cache/types';
import type { ISessionLoginMethod } from '../../../types/session';
import { SessionService } from '../session/session.service';
import { isValidRedirectPath } from '../utils';

export class ControllerAdapter {
  // Property injection keeps subclasses free to declare their own constructors.
  @Inject(SessionService) private readonly sessionService!: SessionService;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async authenticate() {}

  async callback(
    req: Express.Request,
    res: Response,
    loginMethod: ISessionLoginMethod,
    defaultRedirectUri?: string
  ) {
    const user = req.user!;
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    await this.sessionService.recordSignin(req as Request, loginMethod);
    const redirectUri = (req.authInfo as { state: IOauth2State })?.state?.redirectUri;
    if (redirectUri && isValidRedirectPath(redirectUri)) {
      return res.redirect(redirectUri);
    }
    return res.redirect(defaultRedirectUri || '/');
  }
}

import type { Response } from 'express';
import type { IOauth2State } from '../../../cache/types';

export class ControllerAdapter {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async authenticate() {}

  async callback(req: Express.Request, res: Response) {
    const user = req.user!;
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    const redirectUri = (req.authInfo as { state: IOauth2State })?.state?.redirectUri;
    return res.redirect(redirectUri || '/');
  }
}

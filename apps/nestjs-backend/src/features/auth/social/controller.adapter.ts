import type { Response } from 'express';
import type { IOauth2State } from '../../../cache/types';

function isValidRedirectPath(path: string): boolean {
  try {
    const base = 'http://placeholder.local';
    const url = new URL(path, base);
    return url.origin === base && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

export class ControllerAdapter {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  async authenticate() {}

  async callback(req: Express.Request, res: Response, defaultRedirectUri?: string) {
    const user = req.user!;
    // set cookie, passport login
    await new Promise<void>((resolve, reject) => {
      req.login(user, (err) => (err ? reject(err) : resolve()));
    });
    const redirectUri = (req.authInfo as { state: IOauth2State })?.state?.redirectUri;
    if (redirectUri && isValidRedirectPath(redirectUri)) {
      return res.redirect(redirectUri);
    }
    return res.redirect(defaultRedirectUri || '/');
  }
}

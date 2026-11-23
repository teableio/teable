import { Injectable } from '@nestjs/common';
import cookie from 'cookie';
import cookieParser from 'cookie-parser';
import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import ms from 'ms';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { SessionStoreService } from './session-store.service';

/** Whether the session cookie is signed, but not with `secret`: by the old one, or forged. */
const signedWithAnotherSecret = (header: string | undefined, secret: string): boolean => {
  const value: string | undefined = header
    ? cookie.parse(header)[AUTH_SESSION_COOKIE_NAME]
    : undefined;
  return (
    value !== undefined &&
    value.startsWith('s:') &&
    cookieParser.signedCookie(value, secret) === false
  );
};

@Injectable()
export class SessionHandleService {
  sessionMiddleware: RequestHandler;
  constructor(
    private readonly sessionStoreService: SessionStoreService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {
    const { secret, oldSecret } = this.authConfig.session;
    const options: session.SessionOptions = {
      name: AUTH_SESSION_COOKIE_NAME,
      // Array form: the first secret signs new cookies, every secret validates
      // existing ones — so rotating BACKEND_SESSION_SECRET keeps live sessions.
      secret: oldSecret ? [secret, oldSecret] : secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: ms('1y'),
        httpOnly: true,
        sameSite: 'lax',
        secure: this.authConfig.session.cookie.secure,
      },
      store: this.sessionStoreService,
    };
    const middleware = session(options);
    if (!oldSecret) {
      this.sessionMiddleware = middleware;
      return;
    }
    // The cookie lives a year and is otherwise only set at sign-in, while the store's TTL
    // slides on every request: an active user's cookie would keep the old signature, and
    // removing the old secret would log them out. So a cookie not signed with the current
    // secret is sent back re-signed (rolling), once: the next request carries the new
    // signature. Other responses stay free of Set-Cookie, as some are publicly cacheable.
    const resigning = session({ ...options, rolling: true });
    this.sessionMiddleware = (req, res, next) =>
      (signedWithAnotherSecret(req.headers.cookie, secret) ? resigning : middleware)(
        req,
        res,
        next
      );
  }

  async getSessionIdFromRequest(request: Request) {
    return new Promise<string>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.sessionMiddleware(request, {} as any, (err) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        resolve(request.sessionID);
      });
    });
  }

  async getUserId(sessionId: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      this.sessionStoreService.get(sessionId, (err, session) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        if (!session) {
          return resolve(undefined);
        }
        resolve(session.passport.user.id);
      });
    });
  }
}

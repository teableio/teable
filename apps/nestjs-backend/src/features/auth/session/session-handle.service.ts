import { Injectable } from '@nestjs/common';
import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import ms from 'ms';
import { AuthConfig, IAuthConfig } from '../../../configs/auth.config';
import { AUTH_SESSION_COOKIE_NAME } from '../../../const';
import { SessionStoreService } from './session-store.service';

@Injectable()
export class SessionHandleService {
  sessionMiddleware: RequestHandler;
  constructor(
    private readonly sessionStoreService: SessionStoreService,
    @AuthConfig() private readonly authConfig: IAuthConfig
  ) {
    this.sessionMiddleware = session({
      name: AUTH_SESSION_COOKIE_NAME,
      secret: this.authConfig.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: ms('1y'),
        secure: this.authConfig.session.cookie.secure,
      },
      store: this.sessionStoreService,
    });
  }

  async getSessionIdFromRequest(request: Request) {
    return new Promise<string>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.sessionMiddleware(request, {} as any, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(request.sessionID);
      });
    });
  }

  async getUserId(sessionId: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      this.sessionStoreService.get(sessionId, (err, session) => {
        if (err) {
          return reject(err);
        }
        if (!session) {
          return resolve(undefined);
        }
        resolve(session.passport.user.id);
      });
    });
  }
}

import type { SessionData } from 'express-session';

/** How a session was created; absent for regular browser sign-ins. */
export interface ISessionClient {
  /** `X-Teable-Client` name, e.g. `mobile`. */
  name: string;
  version: string;
  userAgent?: string;
  createdAt: string;
}

export interface ISessionData extends SessionData {
  passport: {
    user: {
      id: string;
    };
  };
  client?: ISessionClient;
}

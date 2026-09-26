import type { SessionData } from 'express-session';

/** How a session was created; absent for regular browser sign-ins. */
export interface ISessionClient {
  /** `X-Teable-Client` name, e.g. `mobile`. */
  name: string;
  version: string;
  userAgent?: string;
  createdAt: string;
}

/** The sign-in flow that created a session. */
export type ISessionLoginMethod =
  | 'password'
  | 'email_code'
  | 'signup'
  | 'github'
  | 'google'
  | 'oidc'
  | 'apple'
  | 'sso'
  | 'mobile'
  | 'mobile_webview';

/**
 * Device facts stamped when a session is created, shown on the device session list.
 * Absent on sessions created before this was recorded.
 */
export interface ISessionMeta {
  loginMethod: ISessionLoginMethod;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  /** Refreshed on every request the session serves (store `touch`). */
  lastActiveAt: string;
}

export interface ISessionData extends SessionData {
  passport: {
    user: {
      id: string;
    };
  };
  client?: ISessionClient;
  meta?: ISessionMeta;
}

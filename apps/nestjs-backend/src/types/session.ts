import type { SessionData } from 'express-session';

export interface ISessionData extends SessionData {
  passport: {
    user: {
      id: string;
    };
  };
}

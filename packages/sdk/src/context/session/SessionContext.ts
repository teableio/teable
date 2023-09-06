import type { AuthSchema } from '@teable-group/openapi';
import React from 'react';

export type IUser = AuthSchema.UserMeVo;

export type ISession = {
  user?: IUser;
};

export type ISessionContext = ISession & {
  refresh?: () => void;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SessionContext = React.createContext<ISessionContext>({});

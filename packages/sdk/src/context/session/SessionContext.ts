import type { IUserMeVo } from '@teable/openapi';
import React from 'react';

export type IUser = IUserMeVo;

export type ISession = {
  user?: IUser;
};

export type ISessionContext = ISession & {
  refresh: () => void;
  refreshAvatar: () => void;
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SessionContext = React.createContext<ISessionContext>(null!);

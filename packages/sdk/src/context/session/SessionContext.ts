import type { AuthSchema } from '@teable-group/openapi';
import React from 'react';

export type IUser = AuthSchema.UserMeVo;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const SessionContext = React.createContext<{
  user?: IUser;
  refresh?: () => void;
}>({});

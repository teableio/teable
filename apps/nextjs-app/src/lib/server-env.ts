import React from 'react';

export interface IServerEnv {
  driver?: string;
  templateSiteLink?: string;
  microsoftClarityId?: string;
  umamiWebSiteId?: string;
  umamiUrl?: string;
  sentryDsn?: string;
  socialAuthProviders?: string[];
  storagePrefix?: string;
  edition?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

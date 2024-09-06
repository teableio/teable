import React from 'react';

export interface IServerEnv {
  driver?: string;
  templateSiteLink?: string;
  sentryDsn?: string;
  socialAuthProviders?: string[];
  storagePrefix?: string;
  edition?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

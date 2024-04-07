import React from 'react';

export interface IServerEnv {
  templateSiteLink?: string;
  microsoftClarityId?: string;
  sentryDsn?: string;
  socialAuthProviders?: string[];
  storagePrefix?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

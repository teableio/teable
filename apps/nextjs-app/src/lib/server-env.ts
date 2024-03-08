import React from 'react';

export interface IServerEnv {
  templateSiteLink?: string;
  microsoftClarityId?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

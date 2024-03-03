import React from 'react';

export interface IServerEnv {
  helpSiteLink?: string;
  templateSiteLink?: string;
  microsoftClarityId?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

import React from 'react';

export interface IServerEnv {
  driver?: string;
  brandName?: string;
  brandLogo?: string;
  templateSiteLink?: string;
  microsoftClarityId?: string;
  umamiWebSiteId?: string;
  gaId?: string;
  umamiUrl?: string;
  sentryDsn?: string;
  socialAuthProviders?: string[];
  storage?: {
    provider?: 'local' | 'minio' | 's3';
    prefix?: string;
    publicBucket?: string;
    publicUrl?: string;
  };
  edition?: string;
  passwordLoginDisabled?: boolean;
  // global settings
  globalSettings?: {
    disallowSignUp?: boolean;
    disallowSpaceCreation?: boolean;
    disallowSpaceInvitation?: boolean;
    aiConfig?: {
      enable: boolean;
    };
  };
  enableDomainEmail?: boolean;
  maxSearchFieldCount?: number;
  chatContextAttachmentSize?: number;
  publicOrigin?: string;
  publicDatabaseProxy?: string;
}

export const EnvContext = React.createContext<IServerEnv>({});

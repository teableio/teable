import React from 'react';

export interface IServerEnv {
  buildVersion?: string;
  gitCommitSha?: string;
  previewTag?: string;
  driver?: string;
  brandName?: string;
  brandLogo?: string;
  templateSiteLink?: string;
  microsoftClarityId?: string;
  umamiWebSiteId?: string;
  gaId?: string;
  marketingGaId?: string;
  posthogKey?: string;
  posthogHost?: string;
  posthogWebHost?: string;
  posthogUiHost?: string;
  metaPixelId?: string;
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
  changeEmailSendMailCodeRate?: number;
  resetPasswordSendMailCodeRate?: number;
  signupVerificationSendMailCodeRate?: number;
  enableCanaryFeature?: boolean;
  /**
   * Set only when ENABLE_RTL_UI=false takes RTL interface mirroring back out.
   * Phrased as the exception rather than the rule so the normal case stays
   * `undefined` and never reaches the client payload at all.
   */
  rtlUiDisabled?: boolean;
  forceV2All?: boolean;
  allowCrossSpaceReference?: boolean;
  task?: {
    maxTaskRows?: number;
  };
  trash?: {
    retentionDays?: number;
  };
}

export const EnvContext = React.createContext<IServerEnv>({});

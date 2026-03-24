/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const externalOAuth2Config = registerAs('externalOAuth2', () => ({
  clientId: process.env.OAUTH2_CLIENT_ID || '',
  clientSecret: process.env.OAUTH2_CLIENT_SECRET || '',
  authUrl: process.env.OAUTH2_AUTH_URL || '',
  tokenUrl: process.env.OAUTH2_TOKEN_URL || '',
  testUrl: process.env.OAUTH2_TEST_URL || process.env.OAUTH2_USERINFO_URL || '', // prefer explicit TEST_URL
  scope: process.env.OAUTH2_SCOPE || '',
  redirectUri: process.env.OAUTH2_REDIRECT_URI || '',
}));

export const ExternalOAuth2Config = () => Inject(externalOAuth2Config.KEY);

export type IExternalOAuth2Config = ConfigType<typeof externalOAuth2Config>;

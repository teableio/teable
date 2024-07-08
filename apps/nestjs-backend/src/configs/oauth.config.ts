import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const oauthConfig = registerAs('oauth', () => ({
  accessTokenExpireIn: process.env.BACKEND_OAUTH_ACCESS_TOKEN_EXPIRE_IN || '10m',
  refreshTokenExpireIn: process.env.BACKEND_OAUTH_REFRESH_TOKEN_EXPIRE_IN || '30d',
  transactionExpireIn: process.env.BACKEND_OAUTH_TRANSACTION_EXPIRE_IN || '5m',
  codeExpireIn: process.env.BACKEND_OAUTH_CODE_EXPIRE_IN || '5m',
  authorizedExpireIn: process.env.BACKEND_OAUTH_AUTHORIZED_EXPIRE_IN || '7d',
}));

// eslint-disable-next-line @typescript-eslint/naming-convention
export const OAuthConfig = () => Inject(oauthConfig.KEY);

export type IOAuthConfig = ConfigType<typeof oauthConfig>;

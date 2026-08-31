import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const oauthConfig = registerAs('oauth', () => ({
  accessTokenExpireIn: process.env.BACKEND_OAUTH_ACCESS_TOKEN_EXPIRE_IN || '10m',
  refreshTokenExpireIn: process.env.BACKEND_OAUTH_REFRESH_TOKEN_EXPIRE_IN || '30d',
  // 10m matches the OAuth state/relay TTLs of the app popup flow: the consent
  // page must stay submittable for as long as the sign-in window is open.
  transactionExpireIn: process.env.BACKEND_OAUTH_TRANSACTION_EXPIRE_IN || '10m',
  codeExpireIn: process.env.BACKEND_OAUTH_CODE_EXPIRE_IN || '5m',
  // Longer than an authorization code: the user has to read a code off one
  // screen and type it on another, possibly on a different device.
  deviceCodeExpireIn: process.env.BACKEND_OAUTH_DEVICE_CODE_EXPIRE_IN || '15m',
  // Seconds the client must wait between polls (RFC 8628 `interval`).
  deviceCodeInterval: Number(process.env.BACKEND_OAUTH_DEVICE_CODE_INTERVAL || 5),
  // Device code requests are anonymous, so this one is per IP (over
  // tokenRateWindow); the other rate limits key on an authenticated client.
  deviceCodeRateLimit: Number(process.env.BACKEND_OAUTH_DEVICE_CODE_RATE_LIMIT || 30),
  authorizedExpireIn: process.env.BACKEND_OAUTH_AUTHORIZED_EXPIRE_IN || '7d',
  tokenRateLimit: Number(process.env.BACKEND_OAUTH_TOKEN_RATE_LIMIT || 30),
  tokenRateWindow: process.env.BACKEND_OAUTH_TOKEN_RATE_WINDOW || '15m',
}));

// eslint-disable-next-line @typescript-eslint/naming-convention
export const OAuthConfig = () => Inject(oauthConfig.KEY);

export type IOAuthConfig = ConfigType<typeof oauthConfig>;

/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';
import { resolveCipherEntries } from './secrets/resolve-cipher-entries';
import { resolveSecret } from './secrets/resolve-secret';
import { SECRET_SPECS } from './secrets/secret-specs';

const getCookieSecure = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  if (value === 'auto') {
    return 'auto' as const;
  }
  return value === 'true';
};

// Secret resolution and policy live in ./secrets (secret-specs.ts is the
// single source of truth; secrets-policy.ts enforces production policy).
export const authConfig = registerAs('auth', () => ({
  jwt: {
    secret: resolveSecret(SECRET_SPECS.jwtSecret),
    // Verify-only fallback for PLANNED rotations of BACKEND_JWT_SECRET:
    // TeableJwtService signs with `secret` and verifies against both. A leaked
    // secret must be hard-cut (never listed here) — see features/auth/jwt.
    oldSecret: process.env.BACKEND_JWT_SECRET_OLD,
    expiresIn: process.env.BACKEND_JWT_EXPIRES_IN ?? '20d',
  },
  session: {
    secret: resolveSecret(SECRET_SPECS.sessionSecret),
    // Verify-only fallback accepted while rotating BACKEND_SESSION_SECRET.
    // express-session validates a signed cookie against every secret in the
    // array (first entry signs new cookies), so existing sessions survive.
    oldSecret: process.env.BACKEND_SESSION_SECRET_OLD,
    expiresIn: process.env.BACKEND_SESSION_EXPIRES_IN ?? '7d',
    cookie: {
      secure: getCookieSecure(process.env.BACKEND_SESSION_COOKIE_SECURE),
    },
  },
  accessToken: {
    prefix: 'teable',
    encryption: {
      // Tokens are in users' hands and can never be re-encrypted: after a
      // rotation the previous pair stays pinned in *_OLD until every token
      // issued under it is expired or revoked.
      entries: resolveCipherEntries({
        algorithm: process.env.BACKEND_ACCESS_TOKEN_ENCRYPTION_ALGORITHM ?? 'aes-128-cbc',
        keySpec: SECRET_SPECS.accessTokenEncryptionKey,
        ivSpec: SECRET_SPECS.accessTokenEncryptionIv,
      }),
    },
  },
  resetPasswordEmailExpiresIn:
    process.env.BACKEND_EMAIL_CODE_EXPIRES_IN ??
    process.env.BACKEND_RESET_PASSWORD_EMAIL_EXPIRES_IN ??
    '30m',
  signupVerificationExpiresIn:
    process.env.BACKEND_EMAIL_CODE_EXPIRES_IN ??
    process.env.BACKEND_SIGNUP_VERIFICATION_EXPIRES_IN ??
    '30m',
  socialAuthProviders: process.env.SOCIAL_AUTH_PROVIDERS?.split(',') ?? [],
  // Same switch that gates LocalAuthModule registration in auth.module.ts
  passwordLoginDisabled: process.env.PASSWORD_LOGIN_DISABLED === 'true',
  github: {
    clientID: process.env.BACKEND_GITHUB_CLIENT_ID,
    clientSecret: process.env.BACKEND_GITHUB_CLIENT_SECRET,
    callbackURL: process.env.BACKEND_GITHUB_CALLBACK_URL,
  },
  google: {
    clientID: process.env.BACKEND_GOOGLE_CLIENT_ID,
    clientSecret: process.env.BACKEND_GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.BACKEND_GOOGLE_CALLBACK_URL,
  },
  oidc: {
    issuer: process.env.BACKEND_OIDC_ISSUER,
    authorizationURL: process.env.BACKEND_OIDC_AUTHORIZATION_URL,
    tokenURL: process.env.BACKEND_OIDC_TOKEN_URL,
    userInfoURL: process.env.BACKEND_OIDC_USER_INFO_URL,
    clientID: process.env.BACKEND_OIDC_CLIENT_ID,
    clientSecret: process.env.BACKEND_OIDC_CLIENT_SECRET,
    callbackURL: process.env.BACKEND_OIDC_CALLBACK_URL,
    other: process.env.BACKEND_OIDC_OTHER ? JSON.parse(process.env.BACKEND_OIDC_OTHER) : {},
  },
  mobileAuth: {
    // URL schemes the mobile sign-in may hand a code to (`teable://auth/callback`). The
    // official app registers `teable`; a fork with its own scheme lists it here.
    redirectSchemes: (process.env.MOBILE_AUTH_REDIRECT_SCHEMES ?? 'teable')
      .split(',')
      .map((scheme) => scheme.trim().toLowerCase())
      .filter(Boolean),
    codeExpiresInSeconds: 5 * 60,
    webSessionCodeExpiresInSeconds: 2 * 60,
  },
  signin: {
    maxLoginAttempts: process.env.SIGNIN_MAX_LOGIN_ATTEMPTS
      ? Number(process.env.SIGNIN_MAX_LOGIN_ATTEMPTS)
      : undefined,
    accountLockoutMinutes: process.env.SIGNIN_ACCOUNT_LOCKOUT_MINUTES
      ? Number(process.env.SIGNIN_ACCOUNT_LOCKOUT_MINUTES)
      : undefined,
  },
}));

export const AuthConfig = () => Inject(authConfig.KEY);

export type IAuthConfig = ConfigType<typeof authConfig>;

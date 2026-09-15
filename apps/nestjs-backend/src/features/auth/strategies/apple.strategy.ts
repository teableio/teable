import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import type { AppleAuthorizationParams } from 'passport-apple';
import { Strategy } from 'passport-apple';
import { AuthConfig } from '../../../configs/auth.config';
import type { authConfig } from '../../../configs/auth.config';
import { BaseConfig, IBaseConfig } from '../../../configs/base.config';
import { UserService } from '../../user/user.service';
import { OauthStoreService } from '../oauth/oauth.store';
import { AppleAuthException } from '../social/apple/apple-auth.exception';
import { pickUserMe } from '../utils';

export const APPLE_ID_TOKEN_ISSUER = 'https://appleid.apple.com';

export const APPLE_CALLBACK_PATH = '/api/auth/apple/callback';

/** The Return URL registered with Apple for the Services ID: the public origin plus the callback path. */
export const appleCallbackUrl = (publicOrigin: string | undefined) =>
  `${(publicOrigin ?? '').replace(/\/+$/, '')}${APPLE_CALLBACK_PATH}`;

/** Claims Sign in with Apple puts in the `id_token` its token endpoint returns. */
export interface IAppleIdTokenClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  email?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  email_verified?: boolean | 'true' | 'false';
  // eslint-disable-next-line @typescript-eslint/naming-convention
  is_private_email?: boolean | 'true' | 'false';
  exp?: number;
}

/** The `user` form field Apple posts next to the code — on the FIRST authorization only. */
export interface IAppleUserField {
  name?: { firstName?: string; lastName?: string };
  email?: string;
}

/**
 * Payload of the id_token, without signature verification: the token comes straight
 * from Apple's token endpoint over TLS in exchange for the code, so the transport
 * already vouches for it (OpenID Connect Core 3.1.3.7). Issuer and audience are still
 * pinned by the caller.
 */
export const decodeAppleIdToken = (idToken: string): IAppleIdTokenClaims => {
  const payload = typeof idToken === 'string' ? idToken.split('.')[1] : undefined;
  if (!payload) {
    throw new UnauthorizedException('Malformed id_token from Apple');
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      throw new Error('Invalid claims');
    }
    return claims;
  } catch {
    throw new UnauthorizedException('Malformed id_token from Apple');
  }
};

export const parseAppleUserField = (raw: unknown): IAppleUserField | undefined => {
  if (typeof raw !== 'string' || !raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as IAppleUserField)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Apple sends the name once; later logins fall back to the same rule local signup uses. */
export const appleDisplayName = (user: IAppleUserField | undefined, email: string) => {
  const name = [user?.name?.firstName, user?.name?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : undefined))
    .filter(Boolean)
    .join(' ');
  return name || email.split('@')[0];
};

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple', true) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    @BaseConfig() baseConfig: IBaseConfig,
    private userService: UserService,
    oauthStoreService: OauthStoreService
  ) {
    const { clientID, teamID, keyID, privateKey } = config.apple;
    super({
      clientID,
      teamID,
      keyID,
      privateKeyString: privateKey,
      callbackURL: appleCallbackUrl(baseConfig.publicOrigin),
      state: true,
      store: oauthStoreService,
      scope: ['name', 'email'],
      passReqToCallback: true,
    });
  }

  /**
   * passport-apple's own version also stuffs a random `state` into the per-request
   * options, which makes passport-oauth2 skip OauthStoreService on the way out while
   * still asking it to verify on the way back — every login would fail on state.
   * Only Apple's mandatory `form_post` (required whenever the name/email scopes are
   * requested) is added here; scope, response_type and state come from passport-oauth2.
   */
  authorizationParams(): AppleAuthorizationParams {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return { response_mode: 'form_post' } as AppleAuthorizationParams;
  }

  private readProfile(req: Request, idToken: string) {
    const claims = decodeAppleIdToken(idToken);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== APPLE_ID_TOKEN_ISSUER || !audiences.includes(this.config.apple.clientID)) {
      throw new UnauthorizedException('id_token was not issued by Apple for this app');
    }
    if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
      throw new UnauthorizedException('No subject provided from Apple');
    }
    // The `user` profile is first-authorization-only. The id_token normally retains
    // email on later logins, but accounts without one can still use an existing sub binding.
    const userField = parseAppleUserField(req.body?.user);
    const email =
      typeof claims.email === 'string' && claims.email.trim()
        ? claims.email
        : typeof userField?.email === 'string' && userField.email.trim()
          ? userField.email
          : undefined;
    return { email, userField, sub: claims.sub };
  }

  // The arity matters: with five parameters passport-oauth2 passes the token response
  // (which passport-apple replaces with the raw id_token) as the fourth argument.
  async validate(
    req: Request,
    _accessToken: string,
    _refreshToken: string,
    idToken: string,
    _profile: unknown
  ) {
    const { email, userField, sub } = this.readProfile(req, idToken);
    const user = email
      ? await this.userService.findOrCreateUser({
          name: appleDisplayName(userField, email),
          email,
          provider: 'apple',
          providerId: sub,
          type: 'oauth',
        })
      : await this.userService.getUserByAccount('apple', sub);
    if (!user) {
      if (!email) throw new AppleAuthException('missing_email_unlinked');
      throw new UnauthorizedException('Failed to create user from Apple profile');
    }
    if (user.deactivatedTime) {
      throw new AppleAuthException('deactivated');
    }
    await this.userService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }
}

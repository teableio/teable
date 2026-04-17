import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import cookie from 'cookie';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import type { IJwtBaseShareInfo } from '../base-share-auth.service';
import { BaseShareAuthService } from '../base-share-auth.service';
import { BASE_SHARE_JWT_STRATEGY } from '../guard/constant';

@Injectable()
export class BaseShareJwtStrategy extends PassportStrategy(Strategy, BASE_SHARE_JWT_STRATEGY) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly baseShareAuthService: BaseShareAuthService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([BaseShareJwtStrategy.fromAuthCookieAsToken]),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = req.params.shareId || (req.headers['tea-share-id'] as string);
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(payload: IJwtBaseShareInfo) {
    const { shareId, password } = payload;

    // Legacy JWT tokens (pre-bcrypt migration) contain a plaintext `password`.
    // Re-validate them against the DB so they work during transition.
    if (password) {
      const authShareId = await this.baseShareAuthService.authBaseShare(shareId, password);
      if (!authShareId) {
        throw new UnauthorizedException();
      }
      return authShareId;
    }

    // New JWT tokens contain only shareId + nonce. The JWT signature already
    // proves the token was issued by this server after a successful password
    // check. We only need to verify the share still exists and is enabled.
    const hasPassword = await this.baseShareAuthService.hasPassword(shareId);
    if (!hasPassword) {
      // Share no longer requires a password -- token is no longer valid
      throw new UnauthorizedException();
    }
    return shareId;
  }
}

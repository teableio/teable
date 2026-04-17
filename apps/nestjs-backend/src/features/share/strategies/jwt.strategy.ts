import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import cookie from 'cookie';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import { SHARE_JWT_STRATEGY } from '../guard/constant';
import { ShareAuthService } from '../share-auth.service';
import type { IJwtShareInfo } from '../share-auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, SHARE_JWT_STRATEGY) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly shareAuthService: ShareAuthService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([JwtStrategy.fromAuthCookieAsToken]),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = req.params.shareId || (req.headers['tea-share-id'] as string);
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(payload: IJwtShareInfo) {
    const { shareId, password } = payload;

    // Legacy JWT tokens (pre-bcrypt migration) contain a plaintext `password`.
    // Re-validate them against the DB so they work during transition.
    if (password) {
      const authShareId = await this.shareAuthService.authShareView(shareId, password);
      if (!authShareId) {
        throw new UnauthorizedException();
      }
      return authShareId;
    }

    // New JWT tokens contain only shareId + nonce. The JWT signature proves
    // the token was issued after a successful password check.
    // We just verify the share still exists and has a password.
    const viewInfo = await this.shareAuthService.getShareViewInfo(shareId).catch(() => null);
    if (!viewInfo?.shareMeta?.password) {
      throw new UnauthorizedException();
    }
    return shareId;
  }
}

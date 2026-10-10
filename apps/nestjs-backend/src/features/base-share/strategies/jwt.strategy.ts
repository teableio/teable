import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import cookie from 'cookie';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TeableJwtService } from '../../auth/jwt/teable-jwt.service';
import type { IJwtBaseShareInfo } from '../base-share-auth.service';
import { BaseShareAuthService } from '../base-share-auth.service';
import { BASE_SHARE_JWT_STRATEGY } from '../guard/constant';

@Injectable()
export class BaseShareJwtStrategy extends PassportStrategy(Strategy, BASE_SHARE_JWT_STRATEGY) {
  constructor(
    teableJwtService: TeableJwtService,
    private readonly baseShareAuthService: BaseShareAuthService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([BaseShareJwtStrategy.fromAuthCookieAsToken]),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKeyProvider: teableJwtService.passportSecretProvider(),
    });
  }

  // The share the request is for: the cookie is looked up under this id, and the
  // token payload must name the very same share.
  public static requestedShareId(req: Request): string | undefined {
    return (
      (req.params.shareId as string | undefined) ||
      (req.headers['tea-share-id'] as string | undefined)
    );
  }

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = BaseShareJwtStrategy.requestedShareId(req);
    if (!shareId) {
      return null;
    }
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(req: Request, payload: IJwtBaseShareInfo) {
    const { shareId, pwHash } = payload;
    // A token is minted for one share (GHSA-w677-p6hx-85vw): reject a token that
    // was issued for a different share than the one the cookie was read for.
    if (!shareId || shareId !== BaseShareJwtStrategy.requestedShareId(req)) {
      throw new UnauthorizedException();
    }
    const authShareId = await this.baseShareAuthService.authBaseShareByHash(shareId, pwHash);
    if (!authShareId) {
      throw new UnauthorizedException();
    }
    return authShareId;
  }
}

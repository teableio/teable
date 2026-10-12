import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import cookie from 'cookie';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { TeableJwtService } from '../../auth/jwt/teable-jwt.service';
import { SHARE_JWT_STRATEGY } from '../guard/constant';
import { ShareAuthService } from '../share-auth.service';
import type { IJwtShareInfo } from '../share.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, SHARE_JWT_STRATEGY) {
  constructor(
    teableJwtService: TeableJwtService,
    private readonly shareAuthService: ShareAuthService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([JwtStrategy.fromAuthCookieAsToken]),
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
    const shareId = JwtStrategy.requestedShareId(req);
    if (!shareId) {
      return null;
    }
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(req: Request & { useV2?: boolean }, payload: IJwtShareInfo) {
    const { shareId, pwHash } = payload;
    // A token is minted for one share (GHSA-w677-p6hx-85vw). Without this check a
    // visitor who knows the password of their own share could present that token
    // under another share's cookie name and the hash would be verified against
    // the share named in the payload instead of the one being requested.
    if (!shareId || shareId !== JwtStrategy.requestedShareId(req)) {
      throw new UnauthorizedException();
    }
    const authShareId = await this.shareAuthService.authShareViewByHash(
      shareId,
      pwHash,
      req.useV2 === true
    );
    if (!authShareId) {
      throw new UnauthorizedException();
    }
    return authShareId;
  }
}

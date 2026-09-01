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

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = req.params.shareId || (req.headers['tea-share-id'] as string);
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(req: Request & { useV2?: boolean }, payload: IJwtShareInfo) {
    const { shareId, password } = payload;
    const authShareId = await this.shareAuthService.authShareView(
      shareId,
      password,
      req.useV2 === true
    );
    if (!authShareId) {
      throw new UnauthorizedException();
    }
    return authShareId;
  }
}

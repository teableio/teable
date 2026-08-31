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
      secretOrKeyProvider: teableJwtService.passportSecretProvider(),
    });
  }

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = req.params.shareId || (req.headers['tea-share-id'] as string);
    const cookieObj = cookie.parse(req.headers.cookie ?? '');
    return cookieObj?.[shareId] ?? null;
  }

  async validate(payload: IJwtBaseShareInfo) {
    const { shareId, password } = payload;
    const authShareId = await this.baseShareAuthService.authBaseShare(shareId, password);
    if (!authShareId) {
      throw new UnauthorizedException();
    }
    return authShareId;
  }
}

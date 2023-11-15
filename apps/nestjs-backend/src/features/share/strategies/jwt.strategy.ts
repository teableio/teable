import { Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import type { IClsStore } from '../../../types/cls';
import { SHARE_JWT_STRATEGY } from '../guard/constant';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, SHARE_JWT_STRATEGY) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly cls: ClsService<IClsStore>
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([JwtStrategy.fromAuthCookieAsToken]),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  public static fromAuthCookieAsToken(req: Request): string | null {
    const shareId = req.params.shareId;
    return req.cookies?.[shareId] ?? null;
  }

  async validate(payload: { shareId: string }) {
    const { shareId } = payload;
    this.cls.set('shareViewId', shareId);
    return shareId;
  }
}

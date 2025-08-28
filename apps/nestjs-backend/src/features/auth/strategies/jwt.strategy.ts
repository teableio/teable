import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { AUTOMATION_ROBOT_USER, APP_ROBOT_USER } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import type { IClsStore } from '../../../types/cls';
import { UserService } from '../../user/user.service';
import { pickUserMe } from '../utils';
import { JWT_TOKEN_STRATEGY_NAME } from './constant';
import type { IJwtAuthInternalInfo, IJwtAuthInfo } from './types';
import { JwtAuthInternalType } from './types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_TOKEN_STRATEGY_NAME) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwt.secret,
    });
  }

  async validate(payload: IJwtAuthInfo | IJwtAuthInternalInfo) {
    if ('baseId' in payload) {
      const user =
        payload.type === JwtAuthInternalType.App ? APP_ROBOT_USER : AUTOMATION_ROBOT_USER;
      this.cls.set('user', user);
      this.cls.set('tempAuthBaseId', payload.baseId);
      return user;
    }

    const user = await this.userService.getUserById(payload.userId);
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.deactivatedTime) {
      throw new UnauthorizedException('Your account has been deactivated by the administrator');
    }

    if (user.isSystem) {
      throw new UnauthorizedException('User is system user');
    }

    this.cls.set('user.id', user.id);
    this.cls.set('user.name', user.name);
    this.cls.set('user.email', user.email);
    this.cls.set('user.isAdmin', user.isAdmin);
    return pickUserMe(user);
  }
}

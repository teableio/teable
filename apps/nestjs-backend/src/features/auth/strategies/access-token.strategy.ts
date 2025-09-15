import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import type { IClsStore } from '../../../types/cls';
import { AccessTokenService } from '../../access-token/access-token.service';
import { UserService } from '../../user/user.service';
import { pickUserMe } from '../utils';
import { PassportAccessTokenStrategy } from './access-token.passport';
import type { IFromExtractor } from './types';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(PassportAccessTokenStrategy) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>,
    private readonly accessTokenService: AccessTokenService
  ) {
    super({
      accessTokenFromRequest: fromExtractors([fromAuthHeaderAsBearerToken]),
    });
  }

  async validate(payload: { accessTokenId: string; sign: string }) {
    const { userId, accessTokenId } = await this.accessTokenService.validate(payload);
    const user = await this.userService.getUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.deactivatedTime) {
      throw new UnauthorizedException('Your account has been deactivated by the administrator');
    }

    this.cls.set('user.id', user.id);
    this.cls.set('user.name', user.name);
    this.cls.set('user.email', user.email);
    this.cls.set('user.isAdmin', user.isAdmin);
    this.cls.set('accessTokenId', accessTokenId);
    return pickUserMe(user);
  }
}

const fromExtractors = (extractors: IFromExtractor[]) => {
  if (!Array.isArray(extractors)) {
    throw new TypeError('extractors.fromExtractors expects an array');
  }

  return function (request: Request) {
    let token = null;
    let index = 0;
    while (!token && index < extractors.length) {
      token = extractors[index](request);
      index++;
    }
    return token;
  };
};

const fromAuthHeaderAsBearerToken = (req: Request) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const [bearer, token] = authHeader.split(' ');
    if (bearer === 'Bearer' && token) {
      return token;
    }
  }
  return null;
};

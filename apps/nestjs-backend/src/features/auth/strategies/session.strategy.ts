import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ClsService } from 'nestjs-cls';
import type { authConfig } from '../../../configs/auth.config';
import { AuthConfig } from '../../../configs/auth.config';
import type { IClsStore } from '../../../types/cls';
import { UserService } from '../../user/user.service';
import { pickUserMe } from '../utils';
import { PassportSessionStrategy } from './session.passport';
import type { IPayloadUser } from './types';

@Injectable()
export class SessionStrategy extends PassportStrategy(PassportSessionStrategy) {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private readonly userService: UserService,
    private readonly cls: ClsService<IClsStore>
  ) {
    super();
  }

  async validate(payload: IPayloadUser) {
    const user = await this.userService.getUserById(payload.id);
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

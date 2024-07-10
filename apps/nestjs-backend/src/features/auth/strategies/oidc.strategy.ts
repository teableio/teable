import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Profile } from 'passport-openidconnect';
import { Strategy } from 'passport-openidconnect';
import { AuthConfig } from '../../../configs/auth.config';
import type { authConfig } from '../../../configs/auth.config';
import { UserService } from '../../user/user.service';
import { OauthStoreService } from '../oauth/oauth.store';
import { pickUserMe } from '../utils';

@Injectable()
export class OIDCStrategy extends PassportStrategy(Strategy, 'openidconnect') {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private usersService: UserService,
    oauthStoreService: OauthStoreService
  ) {
    const { other, ...rest } = config.oidc;
    super({
      ...rest,
      state: true,
      store: oauthStoreService,
      ...other,
    });
  }

  async validate(_issuer: string, profile: Profile) {
    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0].value;
    if (!email) {
      throw new UnauthorizedException('No email provided from OIDC');
    }
    const user = await this.usersService.findOrCreateUser({
      name: displayName,
      email,
      provider: 'oidc',
      providerId: id,
      type: 'oauth',
      avatarUrl: photos?.[0].value,
    });

    if (!user) {
      throw new UnauthorizedException('Failed to create user from OIDC profile');
    }

    if (user.deactivatedTime) {
      throw new BadRequestException('Your account has been deactivated by the administrator');
    }
    await this.usersService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }
}

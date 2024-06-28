import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Profile } from 'passport-google-oauth20';
import { Strategy } from 'passport-google-oauth20';
import { AuthConfig } from '../../../configs/auth.config';
import type { authConfig } from '../../../configs/auth.config';
import { UserService } from '../../user/user.service';
import { OauthStoreService } from '../oauth/oauth.store';
import { pickUserMe } from '../utils';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    @AuthConfig() readonly config: ConfigType<typeof authConfig>,
    private userService: UserService,
    oauthStoreService: OauthStoreService
  ) {
    const { clientID, clientSecret, callbackURL } = config.google;
    super({
      clientID,
      clientSecret,
      state: true,
      store: oauthStoreService,
      scope: ['profile', 'email'],
      callbackURL,
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    const { id, emails, displayName, photos } = profile;
    const email = emails?.[0].value;
    if (!email) {
      throw new UnauthorizedException('No email provided from Google');
    }
    const user = await this.userService.findOrCreateUser({
      name: displayName,
      email,
      provider: 'google',
      providerId: id,
      type: 'oauth',
      avatarUrl: photos?.[0].value,
    });
    if (!user) {
      throw new UnauthorizedException('Failed to create user from Google profile');
    }
    if (user.deactivatedTime) {
      throw new BadRequestException('Your account has been deactivated by the administrator');
    }
    await this.userService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }
}

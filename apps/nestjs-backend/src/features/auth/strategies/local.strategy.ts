import { BadRequestException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { UserService } from '../../user/user.service';
import { LocalAuthService } from '../local-auth/local-auth.service';
import { pickUserMe } from '../utils';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly authService: LocalAuthService
  ) {
    super({
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  async validate(email: string, password: string) {
    const user = await this.authService.validateUserByEmail(email, password);
    if (!user) {
      throw new BadRequestException('Incorrect password.');
    }
    if (user.deactivatedTime) {
      throw new BadRequestException('Your account has been deactivated by the administrator');
    }
    await this.userService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }
}

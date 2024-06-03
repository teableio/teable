import { BadRequestException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { UserService } from '../../user/user.service';
import { AuthService } from '../auth.service';
import { pickUserMe } from '../utils';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService
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
    await this.userService.refreshLastSignTime(user.id);
    return pickUserMe(user);
  }
}

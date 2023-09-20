import { Injectable, UnauthorizedException } from '@nestjs/common';
import cookie from 'cookie';
import { AUTH_COOKIE } from '../const';
import { AuthService } from '../features/auth/auth.service';
import { UserService } from '../features/user/user.service';

@Injectable()
export class WsAuthService {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService
  ) {}

  async auth(cookie: string) {
    const token = WsAuthService.extractTokenFromHeader(cookie);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const payload = await this.authService.validateJwtToken(token);
      const user = await this.userService.getUserById(payload.id);
      if (!user) {
        throw new UnauthorizedException();
      }
      return { id: user.id };
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractTokenFromHeader(cookieStr: string): string | undefined {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[AUTH_COOKIE];
  }
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import cookie from 'cookie';
import { AUTH_COOKIE } from '../const';
import { AuthService } from '../features/auth/auth.service';

@Injectable()
export class WsAuthService {
  constructor(private readonly authService: AuthService) {}

  async auth(cookie: string) {
    const token = WsAuthService.extractTokenFromHeader(cookie);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      return await this.authService.validateJwtToken(token);
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractTokenFromHeader(cookieStr: string): string | undefined {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[AUTH_COOKIE];
  }
}

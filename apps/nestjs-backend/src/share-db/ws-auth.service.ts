import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpErrorCode } from '@teable-group/core';
import cookie from 'cookie';
import { AUTH_COOKIE } from '../const';
import { AuthService } from '../features/auth/auth.service';
import { ShareService } from '../features/share/share.service';
import { UserService } from '../features/user/user.service';

// eslint-disable-next-line @typescript-eslint/naming-convention
const UnauthorizedError = { message: 'Unauthorized', code: HttpErrorCode.UNAUTHORIZED };

@Injectable()
export class WsAuthService {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly shareService: ShareService
  ) {}

  async checkCookie(cookie: string | undefined) {
    if (cookie) {
      try {
        return await this.auth(cookie);
      } catch {
        throw UnauthorizedError;
      }
    } else {
      throw UnauthorizedError;
    }
  }

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
      return { id: user.id, email: user.email, name: user.name };
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractTokenFromHeader(cookieStr: string): string | undefined {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[AUTH_COOKIE];
  }

  async checkShareCookie(shareId: string, cookie?: string) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const UnauthorizedError = { message: 'Unauthorized', code: HttpErrorCode.UNAUTHORIZED_SHARE };
    try {
      return await this.authShare(shareId, cookie);
    } catch {
      throw UnauthorizedError;
    }
  }

  async authShare(shareId: string, cookie?: string) {
    const { view } = await this.shareService.getShareViewInfo(shareId);
    const hasPassword = view.shareMeta?.password;
    if (!hasPassword) {
      return;
    }
    if (!cookie) {
      throw new UnauthorizedException();
    }
    const token = WsAuthService.extractShareTokenFromHeader(cookie, shareId);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      return await this.shareService.validateJwtToken(token);
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractShareTokenFromHeader(cookieStr: string, shareId: string): string | null {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[shareId];
  }
}

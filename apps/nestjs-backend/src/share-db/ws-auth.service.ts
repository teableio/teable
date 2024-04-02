import { Injectable, UnauthorizedException } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import cookie from 'cookie';
import { AUTH_SESSION_COOKIE_NAME } from '../const';
import { SessionHandleService } from '../features/auth/session/session-handle.service';
import { ShareAuthService } from '../features/share/share-auth.service';
import { UserService } from '../features/user/user.service';

// eslint-disable-next-line @typescript-eslint/naming-convention
const UnauthorizedError = { message: 'Unauthorized', code: HttpErrorCode.UNAUTHORIZED };

@Injectable()
export class WsAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly shareAuthService: ShareAuthService,
    private readonly sessionHandleService: SessionHandleService
  ) {}

  async checkSession(sessionId: string | undefined) {
    if (sessionId) {
      try {
        return await this.auth(sessionId);
      } catch {
        throw UnauthorizedError;
      }
    } else {
      throw UnauthorizedError;
    }
  }

  async auth(sessionId: string) {
    const userId = await this.sessionHandleService.getUserId(sessionId);
    if (!userId) {
      throw new UnauthorizedException();
    }
    try {
      const user = await this.userService.getUserById(userId);
      if (!user) {
        throw new UnauthorizedException();
      }
      return { id: user.id, email: user.email, name: user.name };
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractSessionFromHeader(cookieStr: string): string | undefined {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[AUTH_SESSION_COOKIE_NAME];
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
    const { view } = await this.shareAuthService.getShareViewInfo(shareId);
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
      const jwtShare = await this.shareAuthService.validateJwtToken(token);
      const shareAuthId = await this.shareAuthService.authShareView(
        jwtShare.shareId,
        jwtShare.password
      );
      if (!shareAuthId || shareAuthId !== shareId) {
        throw new UnauthorizedException();
      }
      return { shareId };
    } catch (error) {
      throw new UnauthorizedException();
    }
  }

  static extractShareTokenFromHeader(cookieStr: string, shareId: string): string | null {
    const cookieObj = cookie.parse(cookieStr);
    return cookieObj[shareId];
  }
}

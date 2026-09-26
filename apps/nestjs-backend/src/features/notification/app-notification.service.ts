import { Injectable } from '@nestjs/common';
import { HttpErrorCode, IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICreateAppNotificationRo, ICreateAppNotificationVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { UserService } from '../user/user.service';
import { NotificationService } from './notification.service';

// Fixed one-minute windows: per app and user, and per app across all its users.
export const APP_NOTIFY_LIMIT_PER_USER = 30;
export const APP_NOTIFY_LIMIT_PER_APP = 600;
const APP_NOTIFY_WINDOW_SECONDS = 60;

/** A 429 that knows when the window reopens, for the `Retry-After` header. */
export class AppNotifyRateLimitedException extends CustomHttpException {
  constructor(readonly retryAfter: number) {
    super(`Too many notifications; retry after ${retryAfter}s`, HttpErrorCode.TOO_MANY_REQUESTS, {
      retryAfter,
    });
  }
}

type ISendingApp = {
  clientId: string;
  name: string;
  logo: string | null;
  homepage: string;
  redirectUris: string | null;
};

/**
 * Third-party OAuth apps notifying the user who authorized them. The recipient is always
 * the owner of the access token: an app reaches no one else. What the app writes is plain text
 * shown under its name and logo, a link may only lead to the app's own site, and the user can
 * turn an app's notifications off without revoking it.
 */
@Injectable()
export class AppNotificationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly cls: ClsService<IClsStore>
  ) {}

  async send(ro: ICreateAppNotificationRo): Promise<ICreateAppNotificationVo> {
    const { app, userId } = await this.getSender();
    const url = ro.url ? this.checkUrl(ro.url, app) : undefined;
    await this.takeRateLimit(app.clientId, userId);

    const { mutedApps } = await this.userService.getNotifyMeta(userId);
    if (mutedApps?.includes(app.clientId)) {
      return { status: 'muted' };
    }

    const status = await this.notificationService.sendAppNotify({
      app,
      toUserId: userId,
      externalId: ro.externalId,
      text: ro.text,
      url,
    });
    return { status };
  }

  /** The app behind the request's access token, and the user the token belongs to. */
  private async getSender(): Promise<{ app: ISendingApp; userId: string }> {
    const accessTokenId = this.cls.get('accessTokenId');
    const token = accessTokenId
      ? await this.prismaService.accessToken.findUnique({
          where: { id: accessTokenId },
          select: { clientId: true, userId: true },
        })
      : null;
    // Personal access tokens, and plugins' tokens, speak for no app the user can recognize,
    // mute or revoke.
    const app = token?.clientId?.startsWith(IdPrefix.OAuthClient)
      ? await this.prismaService.oAuthApp.findUnique({
          where: { clientId: token.clientId },
          select: { clientId: true, name: true, logo: true, homepage: true, redirectUris: true },
        })
      : null;
    if (!token || !app) {
      throw new CustomHttpException(
        "Only an OAuth app can send notifications: sign the request with the app's access token",
        HttpErrorCode.RESTRICTED_RESOURCE
      );
    }
    return { app, userId: token.userId };
  }

  /**
   * A notification links only to the app's own site: https, on the host of its homepage or of
   * one of its redirect URIs, so an app cannot send users somewhere it does not answer for.
   */
  private checkUrl(url: string, app: ISendingApp): string {
    const hosts = new Set<string>();
    const registered = [app.homepage, ...(JSON.parse(app.redirectUris ?? '[]') as string[])];
    for (const value of registered) {
      const host = URL.canParse(value) ? new URL(value).hostname.toLowerCase() : undefined;
      if (host) hosts.add(host);
    }
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !hosts.has(target.hostname.toLowerCase())
    ) {
      throw new CustomHttpException(
        `The url must be https on the app's own host (${[...hosts].join(', ') || 'none registered'})`,
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    return target.toString();
  }

  private async takeRateLimit(clientId: string, userId: string) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSeconds / APP_NOTIFY_WINDOW_SECONDS);
    const [perUser, perApp] = await Promise.all([
      this.cacheService.incr(
        `notification:app-rate:${clientId}:${userId}:${window}`,
        APP_NOTIFY_WINDOW_SECONDS
      ),
      this.cacheService.incr(
        `notification:app-rate:${clientId}:${window}`,
        APP_NOTIFY_WINDOW_SECONDS
      ),
    ]);
    if (perUser > APP_NOTIFY_LIMIT_PER_USER || perApp > APP_NOTIFY_LIMIT_PER_APP) {
      throw new AppNotifyRateLimitedException(
        Math.max(1, (window + 1) * APP_NOTIFY_WINDOW_SECONDS - nowSeconds)
      );
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { ISessionLoginMethod } from '../../../types/session';
import type { ISessionData } from '../../../types/session';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { describeSessionClient } from '../utils';
import { SessionStoreService, toSessionPublicId } from './session-store.service';

const signedInUserId = (req: Request) => (req.session as Partial<ISessionData>).passport!.user.id;

@Injectable()
export class SessionService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope,
    private readonly cacheService: CacheService,
    private readonly sessionStore: SessionStoreService
  ) {}

  // Anonymous signouts have no `user.id` in CLS — `action` returns undefined so the
  // declarative resolver short-circuits emitsAtomic and skips the audit row entirely.
  @Audit({
    action: (_req: Express.Request, ctx) =>
      ctx.cls.get('user.id') ? Events.USER_SIGNOUT : undefined,
    resourceId: (_req: Express.Request, ctx) => ctx.cls.get('user.id') as string,
    userId: (_req: Express.Request, ctx) => ctx.cls.get('user.id'),
    emit: true,
  })
  async signout(req: Express.Request) {
    // WebView sessions the mobile app opened through a web-session code die with this one.
    await this.destroyChildSessions(req.sessionID);
    await new Promise<void>((resolve, reject) => {
      req.session.destroy(function (err) {
        // cannot access session here
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  /**
   * Call right after `req.login`: stamps the new session with the device it was created on
   * and writes the `user.signin` audit row, keyed by the session so a login log entry can be
   * matched to the session it opened.
   */
  @Audit({
    action: Events.USER_SIGNIN,
    resourceId: (req: Request) => signedInUserId(req),
    userId: (req: Request) => signedInUserId(req),
    emit: (_result: void, req: Request, loginMethod: ISessionLoginMethod) => ({
      sessionId: toSessionPublicId(req.sessionID),
      loginMethod,
    }),
  })
  async recordSignin(req: Request, loginMethod: ISessionLoginMethod) {
    const session = req.session as Partial<ISessionData>;
    const origin = this.cls.get('origin');
    const now = new Date().toISOString();
    session.meta = {
      loginMethod,
      ...(origin?.ip ? { ip: origin.ip } : {}),
      ...(origin?.userAgent ? { userAgent: origin.userAgent.slice(0, 300) } : {}),
      createdAt: now,
      lastActiveAt: now,
    };
    const client = describeSessionClient(req);
    if (client) {
      session.client = client;
    }
  }

  private async destroyChildSessions(parentSessionId: string | undefined) {
    if (!parentSessionId) return;
    const key = `auth:mobile-children:${parentSessionId}` as const;
    const children = await this.cacheService.get(key);
    if (!children?.length) return;
    await Promise.all(
      children.map(
        (sid) => new Promise<void>((resolve) => this.sessionStore.destroy(sid, () => resolve()))
      )
    );
    await this.cacheService.del(key);
  }
}

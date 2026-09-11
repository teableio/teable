import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { SessionStoreService } from './session-store.service';

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

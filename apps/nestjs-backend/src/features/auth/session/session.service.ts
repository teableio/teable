import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { Audit } from '../../audit/audit.decorator';
import { AuditScope } from '../../audit/audit-scope';

@Injectable()
export class SessionService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly audit: AuditScope
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
}

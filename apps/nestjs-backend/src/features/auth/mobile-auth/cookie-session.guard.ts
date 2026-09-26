import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import type { ISessionData } from '../../../types/session';

/**
 * Only a browser (cookie) session may mint mobile sign-in codes or manage signed-in devices.
 * The global AuthGuard also accepts access tokens and short-lived JWTs (e.g. the 5-minute
 * base-scoped token handed to chat scripts); letting those mint a code would upgrade them into
 * a durable account session, and letting them sign devices out would let a leaked token lock
 * the owner out.
 */
@Injectable()
export class CookieSessionGuard implements CanActivate {
  constructor(private readonly cls: ClsService<IClsStore>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { session?: Partial<ISessionData> }>();
    const viaCredential =
      Boolean(req.headers.authorization) ||
      Boolean(this.cls.get('accessTokenId')) ||
      Boolean(this.cls.get('tempAuthBaseId'));
    const sessionUserId = req.session?.passport?.user?.id;
    if (viaCredential || !sessionUserId || sessionUserId !== this.cls.get('user.id')) {
      throw new ForbiddenException('This action is only available to a browser (cookie) session');
    }
    return true;
  }
}

import { isIP } from 'node:net';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { AFFILIATE_COOKIE_NAME, AFFILIATE_VIA_MAX_LENGTH } from '@teable/core';
import { X_CANARY_HEADER } from '@teable/openapi';
import cookie from 'cookie';
import type { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../types/cls';

const automationRobotUserId = 'automationRobot';

// Trusted proxies may append the client PORT to X-Forwarded-For entries (e.g. AWS ALB
// with client-port preservation emits `12.34.56.78:8080` / `[2001:db8::1]:8080`, and
// Express returns the first untrusted token verbatim). Reduce those two forms to their
// host part so the isIP guard below accepts them; anything else — including bare IPv6,
// which contains colons but never brackets — passes through unchanged.
const stripPort = (value: string): string => {
  const bracketedV6 = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketedV6) return bracketedV6[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  return v4WithPort ? v4WithPort[1] : value;
};
// Longest endpoint path we keep. Real routes are far shorter; the cap only guards against a
// caller stuffing a huge URL into an audit row.
const maxOriginPathLength = 512;

const requestPath = (req: Request): string =>
  (req.originalUrl ?? req.url ?? '').split('?')[0].slice(0, maxOriginPathLength);

const fallbackScheduleV2BackgroundTask: NonNullable<IClsStore['scheduleV2BackgroundTask']> = (
  task
) => {
  const handle = setTimeout(() => void task(), 0);
  handle.unref?.();
};

const createAfterResponseScheduler = (
  cls: ClsService<IClsStore>,
  res: Response
): NonNullable<IClsStore['scheduleV2BackgroundTask']> => {
  const pendingTasks: Array<() => Promise<void> | void> = [];
  let responseFinished = res.writableEnded || res.destroyed;
  let flushScheduled = false;

  const scheduleFlush = () => {
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    const handle = setTimeout(() => {
      flushScheduled = false;
      const tasks = pendingTasks.splice(0);
      for (const task of tasks) {
        void task();
      }
    }, 0);
    handle.unref?.();
  };

  const markResponseFinished = () => {
    responseFinished = true;
    scheduleFlush();
  };

  res.once('finish', markResponseFinished);
  res.once('close', markResponseFinished);

  return (task) => {
    const store = cls.get();
    pendingTasks.push(() => {
      if (store) {
        return cls.runWith(store, task);
      }
      return task();
    });
    if (responseFinished) {
      scheduleFlush();
    }
  };
};

@Injectable()
export class RequestInfoMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestInfoMiddleware.name);

  constructor(private readonly cls: ClsService<IClsStore>) {}

  use(req: Request, res: Response, next: NextFunction) {
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';
    const authHeader = req.headers.authorization || '';
    const byApi = authHeader.toLowerCase().startsWith('bearer ');

    // Provenance: AI sandbox tools and automation workers stamp internal HTTP calls
    // with these headers so downstream code (audit_log queries / analytics) can tell
    // "user manually did X" from "AI did X on behalf of user" / "automation robot did X".
    // Orthogonal to byApi — AI uses cookie auth, automation uses PAT, but both are
    // distinct from a vanilla UI or external-script request.
    const via: IClsStore['origin']['via'] =
      req.headers['x-automation-internal'] === 'true'
        ? 'automation'
        : req.headers['x-ai-internal'] === 'true'
          ? 'ai'
          : undefined;

    // With `trust proxy`, req.ip is the first untrusted X-Forwarded-For entry returned
    // verbatim — a caller reaching us through a trusted (private) peer can make it an
    // arbitrary string. Persist only IP-shaped values (after trimming a proxy-appended
    // client port); anything else falls back to the unforgeable socket address.
    const forwardedIp = stripPort(req.ip || '');
    const ip = isIP(forwardedIp) ? forwardedIp : req.socket.remoteAddress || '';

    this.cls.set('origin', {
      ip,
      byApi,
      userAgent,
      referer,
      method: req.method,
      // Path only — the query string can carry filters, search terms and share signatures,
      // none of which belong in an audit row. Read from originalUrl, not req.path: this
      // middleware is mounted on a wildcard route, which makes Express rewrite req.path.
      // The middleware also runs before routing, so the route template
      // (/table/:tableId/...) isn't available — the concrete path is more useful anyway.
      path: requestPath(req),
      ...(via ? { via } : {}),
    });

    // Automation runs under a dedicated robot identity (no real user is "logged in").
    // AI is a tool the real user invokes — keep their identity intact.
    if (via === 'automation') {
      this.cls.set('user.id', automationRobotUserId);
    }

    // Affiliate attribution (?via= cookie) — see IClsStore.affiliateVia.
    const affiliateVia = cookie.parse(req.headers.cookie ?? '')[AFFILIATE_COOKIE_NAME];
    if (affiliateVia) {
      this.cls.set('affiliateVia', affiliateVia.slice(0, AFFILIATE_VIA_MAX_LENGTH));
    }

    // Canary header for canary release override
    const canaryHeader = req.headers[X_CANARY_HEADER];
    if (typeof canaryHeader === 'string') {
      this.cls.set('canaryHeader', canaryHeader);
    }

    this.cls.set(
      'scheduleV2BackgroundTask',
      res ? createAfterResponseScheduler(this.cls, res) : fallbackScheduleV2BackgroundTask
    );

    next();
  }
}

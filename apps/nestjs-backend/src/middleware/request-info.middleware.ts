import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { X_CANARY_HEADER } from '@teable/openapi';
import type { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../types/cls';

const automationRobotUserId = 'automationRobot';

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

    this.cls.set('origin', {
      ip: req.ip || req.socket.remoteAddress || '',
      byApi,
      userAgent,
      referer,
      ...(via ? { via } : {}),
    });

    // Automation runs under a dedicated robot identity (no real user is "logged in").
    // AI is a tool the real user invokes — keep their identity intact.
    if (via === 'automation') {
      this.cls.set('user.id', automationRobotUserId);
    }

    // Canary header for canary release override
    const canaryHeader = req.headers[X_CANARY_HEADER];
    if (typeof canaryHeader === 'string') {
      this.cls.set('canaryHeader', canaryHeader);
    }

    next();
  }
}

import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { X_CANARY_HEADER } from '@teable/openapi';
import type { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../types/cls';

@Injectable()
export class RequestInfoMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestInfoMiddleware.name);

  constructor(private readonly cls: ClsService<IClsStore>) {}

  use(req: Request, res: Response, next: NextFunction) {
    const userAgent = req.headers['user-agent'] || '';
    const referer = req.headers.referer || '';
    const authHeader = req.headers.authorization || '';
    const byApi = authHeader.toLowerCase().startsWith('bearer ');
    const origin: IClsStore['origin'] = {
      ip: req.ip || req.socket.remoteAddress || '',
      byApi,
      userAgent,
      referer,
    };

    this.cls.set('origin', origin);

    // Check if this is an internal automation call
    // Store in CLS to pass through to batch service
    const isAutomationInternal = req.headers['x-automation-internal'] === 'true';
    const isAiInternal = req.headers['x-ai-internal'] === 'true';

    // for inner axios call, skip record audit log
    if (isAutomationInternal || isAiInternal) {
      this.cls.set('skipRecordAuditLog', true);
    }

    if (isAiInternal) {
      this.cls.set('user.id', 'aiRobot');
    }

    // Canary header for canary release override
    const canaryHeader = req.headers[X_CANARY_HEADER];
    if (typeof canaryHeader === 'string') {
      this.cls.set('canaryHeader', canaryHeader);
    }

    next();
  }
}

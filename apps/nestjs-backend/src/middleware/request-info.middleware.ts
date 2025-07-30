import type { NestMiddleware } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
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

    next();
  }
}

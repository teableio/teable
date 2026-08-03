import { ForbiddenException, Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { BaseConfig, type IBaseConfig } from '../configs/base.config';
import type { ISecurityWebConfig } from '../configs/bootstrap.config';
import { AUTH_SESSION_COOKIE_NAME } from '../const';

// eslint-disable-next-line @typescript-eslint/naming-convention
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class SessionCsrfMiddleware implements NestMiddleware {
  constructor(
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly configService: ConfigService
  ) {}

  use(req: Request, _res: Response, next: NextFunction) {
    if (!this.shouldValidate(req)) {
      return next();
    }

    if (this.isCrossSiteFetch(req)) {
      return next(new ForbiddenException('Cross-site session request is not allowed'));
    }

    const sourceOrigin = this.getRequestSourceOrigin(req);
    if (sourceOrigin && !this.getAllowedOrigins(req).has(sourceOrigin)) {
      return next(new ForbiddenException('Cross-site session request is not allowed'));
    }

    next();
  }

  private shouldValidate(req: Request) {
    if (!this.configService.get<ISecurityWebConfig>('security.web')?.sessionOriginCheck.enabled) {
      return false;
    }
    if (!UNSAFE_METHODS.has(req.method.toUpperCase())) {
      return false;
    }
    if (!req.originalUrl.startsWith('/api/')) {
      return false;
    }
    if (!this.hasSessionCookie(req)) {
      return false;
    }
    return !this.hasBearerAuth(req);
  }

  private hasSessionCookie(req: Request) {
    const cookie = this.headerValue(req.headers.cookie);
    if (!cookie) {
      return false;
    }
    return cookie.split(';').some((part) => part.trim().startsWith(`${AUTH_SESSION_COOKIE_NAME}=`));
  }

  private hasBearerAuth(req: Request) {
    return this.headerValue(req.headers.authorization)?.toLowerCase().startsWith('bearer ');
  }

  private isCrossSiteFetch(req: Request) {
    return this.headerValue(req.headers['sec-fetch-site']) === 'cross-site';
  }

  private getRequestSourceOrigin(req: Request) {
    const origin = this.normalizedOrigin(this.headerValue(req.headers.origin));
    if (origin) {
      return origin;
    }
    return this.normalizedOrigin(this.headerValue(req.headers.referer));
  }

  private getAllowedOrigins(req: Request) {
    const origins = new Set<string>();
    const publicOrigin = this.normalizedOrigin(this.baseConfig.publicOrigin);
    if (publicOrigin) {
      origins.add(publicOrigin);
    }

    const host =
      this.headerValue(req.headers['x-forwarded-host']) ?? this.headerValue(req.headers.host);
    if (host) {
      const protocol =
        this.headerValue(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() ?? req.protocol;
      const requestOrigin = this.normalizedOrigin(`${protocol}://${host}`);
      if (requestOrigin) {
        origins.add(requestOrigin);
      }
    }
    return origins;
  }

  private normalizedOrigin(value: string | undefined) {
    if (!value) {
      return;
    }
    try {
      return new URL(value).origin;
    } catch {
      return;
    }
  }

  private headerValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
  }
}

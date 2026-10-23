import { ForbiddenException, Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { BaseConfig, type IBaseConfig } from '../configs/base.config';
import type { ISecurityWebConfig } from '../configs/bootstrap.config';
import { AUTH_SESSION_COOKIE_NAME } from '../const';

// eslint-disable-next-line @typescript-eslint/naming-convention
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Identity providers that answer with a cross-site form POST instead of a redirect
// (Sign in with Apple's `response_mode=form_post`). The OAuth `state` round-trip
// through OauthStoreService is what binds those callbacks to the request that
// started them, so the origin check must not turn them away.
// eslint-disable-next-line @typescript-eslint/naming-convention
const CROSS_SITE_FORM_POST_CALLBACKS = new Set(['/api/auth/apple/callback']);

// Endpoints that sign an anonymous browser in. A cross-site form POST to one of them is
// login CSRF: the victim's browser ends up in the attacker's account, and whatever the
// victim enters next lands there. They run before any session cookie exists, so the
// session origin check never sees them. The browser's own `Sec-Fetch-Site` is checked
// for them on every deployment: it does not depend on PUBLIC_ORIGIN or proxy headers
// being right, and no legitimate sign-in arrives cross-site (the session cookie is
// SameSite=Lax, so a cross-site fetch could not use the session anyway).
//
// `/api/auth/mobile/exchange` belongs here too: it is @Public(), and completing the
// mobile PKCE flow calls `req.login` + sets the `auth_session` cookie, so from a browser
// it is just another anonymous sign-in. The attacker mints both the one-time code and the
// PKCE verifier on their own account, so PKCE is no defence against login CSRF here. The
// native app completes the exchange from its own HTTP client, which sends no
// `Sec-Fetch-Site` header, so it is never treated as cross-site and stays unaffected.
// eslint-disable-next-line @typescript-eslint/naming-convention
const SESSION_CREATING_ROUTES = new Set([
  '/api/auth/signin',
  '/api/auth/signin-with-code',
  '/api/auth/signup',
  '/api/auth/mobile/exchange',
]);

@Injectable()
export class SessionCsrfMiddleware implements NestMiddleware {
  constructor(
    @BaseConfig() private readonly baseConfig: IBaseConfig,
    private readonly configService: ConfigService
  ) {}

  use(req: Request, _res: Response, next: NextFunction) {
    if (this.isSessionCreatingRequest(req) && this.isCrossSiteFetch(req)) {
      return next(new ForbiddenException('Cross-site sign-in request is not allowed'));
    }

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
    const path = this.routePath(req);
    if (!path.startsWith('/api/')) {
      return false;
    }
    if (CROSS_SITE_FORM_POST_CALLBACKS.has(path)) {
      return false;
    }
    if (!this.hasSessionCookie(req) && !this.isSessionCreatingRequest(req)) {
      return false;
    }
    return !this.hasBearerAuth(req);
  }

  private isSessionCreatingRequest(req: Request) {
    return (
      UNSAFE_METHODS.has(req.method.toUpperCase()) &&
      SESSION_CREATING_ROUTES.has(this.routePath(req))
    );
  }

  // Express routes case-insensitively and ignores a trailing slash (`/API/Auth/SignIn/`
  // reaches the `/api/auth/signin` handler), so paths are compared the same way.
  private routePath(req: Request) {
    return req.originalUrl.split('?')[0].replace(/\/+$/, '').toLowerCase();
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

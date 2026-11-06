import { createHash, randomUUID } from 'node:crypto';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HttpErrorCode } from '@teable/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { finalize, type Observable } from 'rxjs';
import { CacheService } from '../cache/cache.service';
import { CustomHttpException } from '../custom.exception';
import type { IClsStore } from '../types/cls';

export const PREVENT_DUPLICATE_REQUEST_KEY = 'preventDuplicateRequest';

export interface IPreventDuplicateRequestOptions {
  /**
   * Upper bound on how long a request holds its slot. The slot is released as soon as the
   * request finishes; this only frees one that a crashed process never released.
   */
  ttlSeconds: number;
}

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

/**
 * One key per user, handler and request content (params, query and body, key order ignored),
 * so only a repeat of the very same request collides.
 */
export const getDuplicateRequestKey = (userId: string, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        sortKeys([
          userId,
          context.getClass().name,
          context.getHandler().name,
          request.params,
          request.query,
          request.body,
        ])
      )
    )
    .digest('hex');
  return `lock:request:${digest}` as const;
};

/**
 * Rejects a request while an identical one from the same user is still being processed, the
 * way a double click on a slow submit button sends it twice. Applied through
 * `@PreventDuplicateRequest()`.
 */
@Injectable()
export class DuplicateRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DuplicateRequestInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const userId = this.cls.get('user.id');
    const options = this.reflector.get<IPreventDuplicateRequestOptions | undefined>(
      PREVENT_DUPLICATE_REQUEST_KEY,
      context.getHandler()
    );
    if (!userId || !options) return next.handle();

    const key = getDuplicateRequestKey(userId, context);
    const token = randomUUID();
    let acquired: boolean;
    try {
      acquired = await this.cacheService.setnx(key, token, options.ttlSeconds);
    } catch (error) {
      // A cache outage must not block writes; the request just goes unchecked.
      this.logger.warn('Failed to check for a duplicate request, letting it through', error);
      return next.handle();
    }
    if (!acquired) {
      throw new CustomHttpException(
        'The same request is already being processed',
        HttpErrorCode.TOO_MANY_REQUESTS,
        {
          localization: {
            i18nKey: 'httpErrors.tooManyRequests',
          },
        }
      );
    }

    return next.handle().pipe(
      finalize(() => {
        this.cacheService.releaseLock(key, token).catch((error) => {
          this.logger.warn('Failed to release a duplicate-request slot', error);
        });
      })
    );
  }
}

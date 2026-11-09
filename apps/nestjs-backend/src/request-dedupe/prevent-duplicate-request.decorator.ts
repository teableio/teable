import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { IPreventDuplicateRequestOptions } from './duplicate-request.interceptor';
import {
  DuplicateRequestInterceptor,
  PREVENT_DUPLICATE_REQUEST_KEY,
} from './duplicate-request.interceptor';

/**
 * Answers 429 (`httpErrors.tooManyRequests`) to a request while an identical one from the
 * same user, with the same params, query and body, is still being processed. Once the first
 * finishes, successfully or not, the same request goes through again.
 *
 * Backed by the cache store: shared across instances on Redis, per process otherwise.
 *
 * @example
 * ```typescript
 * @Post()
 * @PreventDuplicateRequest()
 * async createDepartment(...) {}
 * ```
 */
export const PreventDuplicateRequest = (options: Partial<IPreventDuplicateRequestOptions> = {}) =>
  applyDecorators(
    SetMetadata(PREVENT_DUPLICATE_REQUEST_KEY, {
      ttlSeconds: options.ttlSeconds ?? 30,
    } satisfies IPreventDuplicateRequestOptions),
    UseInterceptors(DuplicateRequestInterceptor)
  );

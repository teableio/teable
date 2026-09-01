import type { IDomainErrorLocalization } from '@teable/v2-core';
import { CustomHttpException, getDefaultCodeByStatus } from '../../custom.exception';

export interface IV2DomainErrorLike {
  code: string;
  message: string;
  tags?: ReadonlyArray<string>;
  details?: Readonly<Record<string, unknown>>;
  localization?: IDomainErrorLocalization;
  /** Non-enumerable creation-site stack from DomainError; optional on plain DTOs. */
  stack?: string;
  cause?: unknown;
}

/**
 * The single bridge from a v2 domain error to an HTTP error. `localization` is
 * attached where the error is created and passed through untouched here;
 * `message` stays English and is only the fallback for errors that carry none.
 *
 * Declared as a function statement so TypeScript's control-flow analysis
 * treats calls as unreachable-after (`never` on a const arrow is not enough).
 *
 * When the source DomainError carries a creation-site stack, reattach it on the
 * thrown HttpException so Sentry/global filters group by the real failure site
 * instead of this adapter frame.
 */
export function throwV2Error(error: IV2DomainErrorLike, status: number): never {
  const exception = new CustomHttpException(error.message, getDefaultCodeByStatus(status), {
    domainCode: error.code,
    domainTags: error.tags,
    details: error.details,
    localization: error.localization,
  });
  if (error.stack) {
    exception.stack = error.stack;
  }
  if (error.cause !== undefined) {
    Object.defineProperty(exception, 'cause', {
      value: error.cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  throw exception;
}

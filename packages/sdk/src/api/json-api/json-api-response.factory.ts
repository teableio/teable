import { isPlainObject } from '@teable-group/ts-utils';
import type {
  JsonApiError,
  JsonApiErrorResponse,
  JsonApiSuccessResponse,
} from './json-api-response.types';

export class JsonApiResponseFactory {
  static fromError = (
    errors: string | JsonApiError | JsonApiError[],
    /** fallback http status if not present in JsonApiError */
    httpStatus?: number
  ): JsonApiErrorResponse => {
    let errs: JsonApiError[];
    if (typeof errors === 'string') {
      errs = [{ title: errors, ...(httpStatus ? { status: httpStatus } : {}) }];
    } else if (isPlainObject(errors)) {
      errs = [errors];
    } else {
      errs = errors;
    }
    return {
      success: false,
      errors: errs,
    };
  };
  static fromSuccess = <T>(
    data: T,
    metadata?: JsonApiSuccessResponse<T>['meta']
  ): JsonApiSuccessResponse<T> => {
    return {
      success: true,
      data: data,
      ...(isPlainObject(metadata) ? { meta: metadata } : {}),
    };
  };
}

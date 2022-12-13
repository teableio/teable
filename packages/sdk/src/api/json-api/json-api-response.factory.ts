import { isPlainObject } from '@teable-group/core';
import type {
  IJsonApiError,
  IJsonApiErrorResponse,
  IJsonApiSuccessResponse,
} from './json-api-response.types';

export class JsonApiResponseFactory {
  static fromError = (
    errors: string | IJsonApiError | IJsonApiError[],
    /** fallback http status if not present in JsonApiError */
    httpStatus?: number
  ): IJsonApiErrorResponse => {
    let errs: IJsonApiError[];
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
    metadata?: IJsonApiSuccessResponse<T>['meta']
  ): IJsonApiSuccessResponse<T> => {
    return {
      success: true,
      data: data,
      ...(isPlainObject(metadata) ? { meta: metadata } : {}),
    };
  };
}

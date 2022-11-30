import type { HttpException } from '@belgattitude/http-exception';
import { isHttpException } from '@belgattitude/http-exception';
import type { JsonApiError } from './json-api-response.types';

export class JsonApiErrorFactory {
  static fromCatchVariable = (
    error: unknown,
    defaultHttpStatus = 500
  ): JsonApiError => {
    const e =
      typeof error === 'string' || error instanceof Error
        ? error
        : `Unknown error (type of catched variable: ${typeof error}`;
    return JsonApiErrorFactory.fromHttpException(e, defaultHttpStatus);
  };

  static fromHttpException = (
    exception: HttpException | Error | string,
    /** fallback http status if it can't be inferred from exception */
    defaultHttpStatus = 500
  ): JsonApiError => {
    if (typeof exception === 'string') {
      return {
        title: exception,
        status: defaultHttpStatus,
      };
    }
    if (isHttpException(exception)) {
      return {
        title: exception.message,
        status: exception.statusCode,
      };
    }
    const { message, status, statusCode } = {
      ...{ status: null, statusCode: null },
      ...exception,
    };
    return {
      title: message,
      status: status ?? statusCode ?? defaultHttpStatus,
    };
  };
}

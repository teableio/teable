import { ErrorCodeToStatusMap, HttpError, HttpErrorCode } from '@teable/core';
import type { ILocaleFunction } from './i18n';
import { errorRequestHandler } from './queryClient';

const ignoreErrorCodes = [HttpErrorCode.VIEW_NOT_FOUND];
const httpErrorCodes = new Set<string>(Object.values(HttpErrorCode));

const isHttpErrorCode = (code: unknown): code is HttpErrorCode =>
  typeof code === 'string' && httpErrorCodes.has(code);

export const toShareDbHttpError = (error: unknown): HttpError => {
  if (error instanceof HttpError) {
    return error;
  }

  if (error && typeof error === 'object') {
    const raw = error as {
      message?: string;
      code?: unknown;
      data?: Record<string, unknown>;
      status?: number;
    };
    const code = isHttpErrorCode(raw.code) ? raw.code : HttpErrorCode.INTERNAL_SERVER_ERROR;
    const status = typeof raw.status === 'number' ? raw.status : ErrorCodeToStatusMap[code];
    return new HttpError(
      {
        message: raw.message ?? 'Error',
        code,
        data: raw.data,
      },
      status
    );
  }

  return new HttpError(String(error ?? 'Error'), 500);
};

export const handleShareDbError = (error: unknown, t?: ILocaleFunction) => {
  const httpError = toShareDbHttpError(error);

  if (httpError.code === HttpErrorCode.UNAUTHORIZED_SHARE) {
    window.location.reload();
    return;
  }

  if (ignoreErrorCodes.includes(httpError.code)) {
    return;
  }

  errorRequestHandler(httpError, t);
};

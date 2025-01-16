import type { IHttpError } from './http-response.types';
import { HttpErrorCode } from './http-response.types';

export class HttpError extends Error implements IHttpError {
  status: number;
  code: HttpErrorCode;
  data?: unknown;

  constructor(
    error: string | { message?: string; code?: HttpErrorCode; data?: Record<string, unknown> },
    status: number,
    data?: Record<string, unknown>
  ) {
    const { message = 'Error', code = HttpErrorCode.INTERNAL_SERVER_ERROR } =
      typeof error === 'string' ? { message: error } : error;
    super(message);
    this.status = status;
    this.code = code;
    this.data = typeof error === 'object' ? error.data : data;
  }
}

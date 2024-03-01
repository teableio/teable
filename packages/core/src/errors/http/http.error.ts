import type { IHttpError } from './http-response.types';
import { HttpErrorCode } from './http-response.types';

export class HttpError extends Error implements IHttpError {
  status: number;
  code: HttpErrorCode;

  constructor(error: string | { message?: string; code?: HttpErrorCode }, status: number) {
    const { message = 'Error', code = HttpErrorCode.INTERNAL_SERVER_ERROR } =
      typeof error === 'string' ? { message: error } : error;
    super(message);
    this.status = status;
    this.code = code;
  }
}

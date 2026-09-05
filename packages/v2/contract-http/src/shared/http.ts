import type { DomainError, IDomainErrorLocalization } from '@teable/v2-core';
import {
  COMPUTE_PAUSED_WRITE_BLOCKED_CODE,
  domainErrorTagValues,
  isConflictError,
  isForbiddenError,
  isInvariantError,
  isNotFoundError,
  isNotImplementedError,
  isUnauthorizedError,
  isValidationError,
} from '@teable/v2-core';
import { z } from 'zod';

export interface IHttpErrorDto {
  code: string;
  message: string;
  tags: ReadonlyArray<(typeof domainErrorTagValues)[number]>;
  details?: Readonly<Record<string, unknown>>;
  localization?: IDomainErrorLocalization;
  /** Diagnostic only — non-enumerable, never serialized into HTTP bodies. */
  stack?: string;
  cause?: unknown;
}

export interface IApiErrorResponseDto {
  ok: false;
  error: IHttpErrorDto;
}

export interface IApiOkResponseDto<T> {
  ok: true;
  data: T;
}

export type IApiResponseDto<T> = IApiOkResponseDto<T> | IApiErrorResponseDto;

export interface IEndpointResult<TBody, TStatus extends number = number> {
  status: TStatus;
  body: TBody;
}

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 501;

export const apiErrorResponseDtoSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    tags: z.array(z.enum(domainErrorTagValues)),
    details: z.record(z.string(), z.unknown()).optional(),
    localization: z
      .object({
        i18nKey: z.string(),
        context: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  }),
});

export const mapDomainErrorToHttpError = (error: DomainError): IHttpErrorDto => {
  const dto: IHttpErrorDto = {
    code: error.code,
    message: error.message,
    tags: error.tags,
    details: error.details,
    localization: error.localization,
  };
  // Keep creation-site diagnostics available for throwV2Error/Sentry without
  // leaking them into JSON response bodies (non-enumerable).
  if (error.stack) {
    Object.defineProperty(dto, 'stack', {
      value: error.stack,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  if (error.cause !== undefined) {
    Object.defineProperty(dto, 'cause', {
      value: error.cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return dto;
};

export const mapDomainErrorToHttpStatus = (error: DomainError): HttpErrorStatus => {
  if (isNotFoundError(error)) return 404;
  if (isUnauthorizedError(error)) return 401;
  if (isForbiddenError(error)) return 403;
  if (isNotImplementedError(error)) return 501;
  if (error.code === COMPUTE_PAUSED_WRITE_BLOCKED_CODE) return 409;
  if (isValidationError(error) || isConflictError(error) || isInvariantError(error)) return 400;
  return 500;
};

export const apiOkResponseDtoSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema,
  });

export const apiResponseDtoSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([apiOkResponseDtoSchema(dataSchema), apiErrorResponseDtoSchema]);

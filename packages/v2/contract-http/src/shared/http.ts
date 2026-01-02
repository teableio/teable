import type { DomainError } from '@teable/v2-core';
import {
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

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 500 | 501;

export const apiErrorResponseDtoSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    tags: z.array(z.enum(domainErrorTagValues)),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const mapDomainErrorToHttpError = (error: DomainError): IHttpErrorDto => ({
  code: error.code,
  message: error.message,
  tags: error.tags,
  details: error.details,
});

export const mapDomainErrorToHttpStatus = (error: DomainError): HttpErrorStatus => {
  if (isNotFoundError(error)) return 404;
  if (isUnauthorizedError(error)) return 401;
  if (isForbiddenError(error)) return 403;
  if (isNotImplementedError(error)) return 501;
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

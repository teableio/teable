import type { DomainError, IDomainErrorLocalization } from '@teable/v2-core';
import {
  COMPUTE_PAUSED_WRITE_BLOCKED_CODE,
  domainErrorTagValues,
  isConflictError,
  isForbiddenError,
  isInvariantError,
  isNotFoundError,
  isTableProvisionPendingError,
  isNotImplementedError,
  isUnauthorizedError,
  isValidationError,
} from '@teable/v2-core';
import { VCS_WRITE_BUSY_CODE } from '@teable/v2-vcs';
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

export type HttpErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 500 | 501 | 503 | 504;

/** Admission rejected the request before its write callback started. Safe to retry. */
export const PUBLIC_ROW_ADMISSION_BUSY_CODE = 'usage.public_row_admission_busy';

/**
 * SQLSTATE 57014 as surfaced by the PostgreSQL record-query adapter
 * (`buildUnexpectedQueryError`). The statement outran its configured budget, so
 * the database did not answer in time: that is a dependency timeout a client can
 * retry, not the internal failure (500) an unclassified error gets. The domain
 * code and `details.pgCode` travel with the response either way.
 */
const DB_STATEMENT_TIMEOUT_CODE = 'db.statement_timeout';

/**
 * An import source is a dependency stream (HTTP storage, proxy, or a caller
 * stream). When it ends before the last row, the import transaction rolled back
 * and the caller can retry, so these are gateway timeouts rather than internal
 * failures. Literals, not core constants: this package may resolve a built core.
 */
const IMPORT_SOURCE_INTERRUPTED_CODES = new Set([
  'import.source_interrupted',
  'csv.source_interrupted',
  'record.insert_many_stream.source_interrupted',
]);

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

const VCS_CONFLICT_CODES = new Set([
  'vcs.cas_conflict',
  'vcs.non_fast_forward',
  'vcs.not_enabled',
  'vcs.enable_quiesce_timeout',
  'vcs.stale_rollback_preview',
  'vcs.origin_push_id_used',
]);

export const mapDomainErrorToHttpStatus = (error: DomainError): HttpErrorStatus => {
  if (isTableProvisionPendingError(error)) return 503;
  if (error.code === VCS_WRITE_BUSY_CODE) return 503;
  if (error.code === 'usage.max_rows_exceeded') return 402;
  if (isNotFoundError(error)) return 404;
  if (isUnauthorizedError(error)) return 401;
  if (isForbiddenError(error)) return 403;
  if (isNotImplementedError(error)) return 501;
  if (error.code === COMPUTE_PAUSED_WRITE_BLOCKED_CODE) return 409;
  if (error.code === 'schema_coordination.busy') return 409;
  if (VCS_CONFLICT_CODES.has(error.code)) return 409;
  if (error.code === DB_STATEMENT_TIMEOUT_CODE) return 504;
  if (IMPORT_SOURCE_INTERRUPTED_CODES.has(error.code)) return 504;
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

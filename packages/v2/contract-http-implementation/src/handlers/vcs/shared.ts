import type { HttpErrorStatus, IApiErrorResponseDto } from '@teable/v2-contract-http';
import { mapDomainErrorToHttpError, mapDomainErrorToHttpStatus } from '@teable/v2-contract-http';
import type { DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';

export interface IVcsEndpointErrorResult {
  readonly status: HttpErrorStatus;
  readonly body: IApiErrorResponseDto;
}

export const toVcsEndpointError = (error: DomainError): IVcsEndpointErrorResult => ({
  status: mapDomainErrorToHttpStatus(error),
  body: { ok: false, error: mapDomainErrorToHttpError(error) },
});

export const toVcsEndpointResult = <T>(
  result: Result<T, DomainError>
): { status: 200; body: T } | IVcsEndpointErrorResult =>
  result.isErr() ? toVcsEndpointError(result.error) : { status: 200, body: result.value };

export const parseVcsTableIdsQuery = (
  tables?: string | string[],
  tableIds?: string | string[]
): string[] | undefined => {
  const rawValues: string[] = [];
  for (const input of [tables, tableIds]) {
    if (Array.isArray(input)) {
      rawValues.push(...input);
    } else if (typeof input === 'string') {
      rawValues.push(input);
    }
  }
  const ids = rawValues
    .flatMap((value) => value.split(','))
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (ids.length === 0) {
    return undefined;
  }
  return Array.from(new Set(ids));
};

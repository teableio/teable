import type { DomainError, ImportRecordsResult } from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';
import { z } from 'zod';

import type { IDomainEventDto } from '../shared/domainEvent';
import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
} from '../shared/http';

export interface IImportRecordsResponseDataDto {
  totalImported: number;
  events: Array<IDomainEventDto>;
}

export type IImportRecordsOkResponseDto = IApiOkResponseDto<IImportRecordsResponseDataDto>;
export type IImportRecordsErrorResponseDto = IApiErrorResponseDto;

export const importRecordsResponseDataSchema = z.object({
  totalImported: z.number(),
  events: z.array(domainEventDtoSchema),
});

export const importRecordsOkResponseSchema = apiOkResponseDtoSchema(
  importRecordsResponseDataSchema
);
export const importRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export type IImportRecordsEndpointResult =
  | { status: 200; body: IImportRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IImportRecordsErrorResponseDto };

export const mapImportRecordsResultToDto = (
  result: ImportRecordsResult
): Result<IImportRecordsResponseDataDto, DomainError> => {
  return ok({
    totalImported: result.totalImported,
    events: result.events.map(mapDomainEventToDto),
  });
};

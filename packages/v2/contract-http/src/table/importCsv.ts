import type { DomainError, ImportCsvResult } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';
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
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export interface IImportCsvResponseDataDto {
  table: ITableDto;
  totalImported: number;
  events: Array<IDomainEventDto>;
}

export type IImportCsvOkResponseDto = IApiOkResponseDto<IImportCsvResponseDataDto>;
export type IImportCsvErrorResponseDto = IApiErrorResponseDto;

export const importCsvResponseDataSchema = z.object({
  table: tableDtoSchema,
  totalImported: z.number(),
  events: z.array(domainEventDtoSchema),
});

export const importCsvOkResponseSchema = apiOkResponseDtoSchema(importCsvResponseDataSchema);
export const importCsvErrorResponseSchema = apiErrorResponseDtoSchema;

export type IImportCsvEndpointResult =
  | { status: 201; body: IImportCsvOkResponseDto }
  | { status: HttpErrorStatus; body: IImportCsvErrorResponseDto };

export const mapImportCsvResultToDto = (
  result: ImportCsvResult
): Result<IImportCsvResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    totalImported: result.totalImported,
    events: result.events.map(mapDomainEventToDto),
  }));
};

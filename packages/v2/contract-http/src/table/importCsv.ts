import type { DomainError, IImportDiagnostics, ImportCsvResult } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { IDomainEventDto } from '../shared/domainEvent';
import { domainEventDtoSchema } from '../shared/domainEvent';
import {
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
} from '../shared/http';
import { importDiagnosticsDtoSchema } from '../shared/importDiagnostics';
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export interface IImportCsvResponseDataDto {
  table: ITableDto;
  totalImported: number;
  events: Array<IDomainEventDto>;
  diagnostics?: IImportDiagnostics;
}

export type IImportCsvOkResponseDto = IApiOkResponseDto<IImportCsvResponseDataDto>;
export type IImportCsvErrorResponseDto = IApiErrorResponseDto;

export const importCsvResponseDataSchema = z.object({
  table: tableDtoSchema,
  totalImported: z.number(),
  events: z.array(domainEventDtoSchema),
  diagnostics: importDiagnosticsDtoSchema.optional(),
});

export const importCsvOkResponseSchema = apiOkResponseDtoSchema(importCsvResponseDataSchema);
export { apiErrorResponseDtoSchema as importCsvErrorResponseSchema } from '../shared/http';

export type IImportCsvEndpointResult =
  | { status: 201; body: IImportCsvOkResponseDto }
  | { status: HttpErrorStatus; body: IImportCsvErrorResponseDto };

export const mapImportCsvResultToDto = (
  result: ImportCsvResult
): Result<IImportCsvResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    totalImported: result.totalImported,
    events: [...result.events],
    diagnostics: result.diagnostics,
  }));
};

import type { DomainError, IImportDiagnostics, ImportRecordsResult } from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';
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

export interface IImportRecordsResponseDataDto {
  totalImported: number;
  events: Array<IDomainEventDto>;
  diagnostics?: IImportDiagnostics;
}

export type IImportRecordsOkResponseDto = IApiOkResponseDto<IImportRecordsResponseDataDto>;
export type IImportRecordsErrorResponseDto = IApiErrorResponseDto;

export const importRecordsResponseDataSchema = z.object({
  totalImported: z.number(),
  events: z.array(domainEventDtoSchema),
  diagnostics: importDiagnosticsDtoSchema.optional(),
});

export const importRecordsOkResponseSchema = apiOkResponseDtoSchema(
  importRecordsResponseDataSchema
);
export { apiErrorResponseDtoSchema as importRecordsErrorResponseSchema } from '../shared/http';

export type IImportRecordsEndpointResult =
  | { status: 200; body: IImportRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IImportRecordsErrorResponseDto };

export const mapImportRecordsResultToDto = (
  result: ImportRecordsResult
): Result<IImportRecordsResponseDataDto, DomainError> => {
  return ok({
    totalImported: result.totalImported,
    events: [...result.events],
    diagnostics: result.diagnostics,
  });
};

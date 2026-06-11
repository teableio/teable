import type {
  DomainError,
  DuplicateTableResult,
  IDuplicateTableCommandInput,
} from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { IDomainEventDto } from '../shared/domainEvent';
import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type IDuplicateTableRequestDto = IDuplicateTableCommandInput;

export interface IDuplicateTableResponseDataDto {
  table: ITableDto;
  fieldIdMap: Record<string, string>;
  viewIdMap: Record<string, string>;
  events: Array<IDomainEventDto>;
}

export type IDuplicateTableResponseDto = IApiResponseDto<IDuplicateTableResponseDataDto>;
export type IDuplicateTableOkResponseDto = IApiOkResponseDto<IDuplicateTableResponseDataDto>;
export type IDuplicateTableErrorResponseDto = IApiErrorResponseDto;

export type IDuplicateTableEndpointResult =
  | { status: 201; body: IDuplicateTableOkResponseDto }
  | { status: HttpErrorStatus; body: IDuplicateTableErrorResponseDto };

export const duplicateTableResponseDataSchema = z.object({
  table: tableDtoSchema,
  fieldIdMap: z.record(z.string(), z.string()),
  viewIdMap: z.record(z.string(), z.string()),
  events: z.array(domainEventDtoSchema),
});

export const duplicateTableOkResponseSchema = apiOkResponseDtoSchema(
  duplicateTableResponseDataSchema
);

export const duplicateTableErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDuplicateTableResultToDto = (
  result: DuplicateTableResult
): Result<IDuplicateTableResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    fieldIdMap: Object.fromEntries(result.fieldIdMap),
    viewIdMap: Object.fromEntries(result.viewIdMap),
    events: result.events.map(mapDomainEventToDto),
  }));
};

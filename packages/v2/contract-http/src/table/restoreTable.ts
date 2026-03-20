import type { DomainError, IRestoreTableCommandInput, RestoreTableResult } from '@teable/v2-core';
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

export type IRestoreTableRequestDto = IRestoreTableCommandInput;

export interface IRestoreTableResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type IRestoreTableResponseDto = IApiResponseDto<IRestoreTableResponseDataDto>;
export type IRestoreTableOkResponseDto = IApiOkResponseDto<IRestoreTableResponseDataDto>;
export type IRestoreTableErrorResponseDto = IApiErrorResponseDto;

export type IRestoreTableEndpointResult =
  | { status: 200; body: IRestoreTableOkResponseDto }
  | { status: HttpErrorStatus; body: IRestoreTableErrorResponseDto };

export const restoreTableResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const restoreTableOkResponseSchema = apiOkResponseDtoSchema(restoreTableResponseDataSchema);
export const restoreTableErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapRestoreTableResultToDto = (
  result: RestoreTableResult
): Result<IRestoreTableResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

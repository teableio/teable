import type { DeleteTableResult, IDeleteTableCommandInput, DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import type { IDomainEventDto } from '../shared/domainEvent';
import { domainEventDtoSchema, mapDomainEventToDto } from '../shared/domainEvent';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
  type HttpErrorStatus,
} from '../shared/http';
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type IDeleteTableRequestDto = IDeleteTableCommandInput;

export interface IDeleteTableResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type IDeleteTableResponseDto = IApiResponseDto<IDeleteTableResponseDataDto>;

export type IDeleteTableOkResponseDto = IApiOkResponseDto<IDeleteTableResponseDataDto>;
export type IDeleteTableErrorResponseDto = IApiErrorResponseDto;

export type IDeleteTableEndpointResult =
  | { status: 200; body: IDeleteTableOkResponseDto }
  | { status: HttpErrorStatus; body: IDeleteTableErrorResponseDto };

export const deleteTableResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const deleteTableOkResponseSchema = apiOkResponseDtoSchema(deleteTableResponseDataSchema);

export const deleteTableErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDeleteTableResultToDto = (
  result: DeleteTableResult
): Result<IDeleteTableResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

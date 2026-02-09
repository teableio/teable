import type { CreateTableResult, ICreateTableCommandInput, DomainError } from '@teable/v2-core';
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

export type ICreateTableRequestDto = ICreateTableCommandInput;

export interface ICreateTableResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type ICreateTableResponseDto = IApiResponseDto<ICreateTableResponseDataDto>;

export type ICreateTableOkResponseDto = IApiOkResponseDto<ICreateTableResponseDataDto>;
export type ICreateTableErrorResponseDto = IApiErrorResponseDto;

export type ICreateTableEndpointResult =
  | { status: 201; body: ICreateTableOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateTableErrorResponseDto };

export const createTableResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const createTableOkResponseSchema = apiOkResponseDtoSchema(createTableResponseDataSchema);

export const createTableErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateTableResultToDto = (
  result: CreateTableResult
): Result<ICreateTableResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

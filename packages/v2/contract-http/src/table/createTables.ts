import type { CreateTablesResult, DomainError, ICreateTablesCommandInput } from '@teable/v2-core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
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

export type ICreateTablesRequestDto = ICreateTablesCommandInput;

export interface ICreateTablesResponseDataDto {
  tables: Array<ITableDto>;
  events: Array<IDomainEventDto>;
}

export type ICreateTablesResponseDto = IApiResponseDto<ICreateTablesResponseDataDto>;

export type ICreateTablesOkResponseDto = IApiOkResponseDto<ICreateTablesResponseDataDto>;
export type ICreateTablesErrorResponseDto = IApiErrorResponseDto;

export type ICreateTablesEndpointResult =
  | { status: 201; body: ICreateTablesOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateTablesErrorResponseDto };

export const createTablesResponseDataSchema = z.object({
  tables: z.array(tableDtoSchema),
  events: z.array(domainEventDtoSchema),
});

export const createTablesOkResponseSchema = apiOkResponseDtoSchema(createTablesResponseDataSchema);

export const createTablesErrorResponseSchema = apiErrorResponseDtoSchema;

const sequence = <T>(
  values: ReadonlyArray<Result<T, DomainError>>
): Result<Array<T>, DomainError> =>
  values.reduce<Result<Array<T>, DomainError>>(
    (acc, next) => acc.andThen((arr) => next.map((value) => [...arr, value])),
    ok([])
  );

export const mapCreateTablesResultToDto = (
  result: CreateTablesResult
): Result<ICreateTablesResponseDataDto, DomainError> => {
  return sequence(result.tables.map((table) => mapTableToDto(table))).map((tables) => ({
    tables,
    events: result.events.map(mapDomainEventToDto),
  }));
};

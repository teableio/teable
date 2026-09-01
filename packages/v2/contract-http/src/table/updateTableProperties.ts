import type {
  DomainError,
  IUpdateTablePropertiesCommandInput,
  UpdateTablePropertiesResult,
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

export type IUpdateTablePropertiesRequestDto = IUpdateTablePropertiesCommandInput;

export interface IUpdateTablePropertiesResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type IUpdateTablePropertiesResponseDto =
  IApiResponseDto<IUpdateTablePropertiesResponseDataDto>;
export type IUpdateTablePropertiesOkResponseDto =
  IApiOkResponseDto<IUpdateTablePropertiesResponseDataDto>;
export type IUpdateTablePropertiesErrorResponseDto = IApiErrorResponseDto;

export type IUpdateTablePropertiesEndpointResult =
  | { status: 200; body: IUpdateTablePropertiesOkResponseDto }
  | { status: HttpErrorStatus; body: IUpdateTablePropertiesErrorResponseDto };

export const updateTablePropertiesResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const updateTablePropertiesOkResponseSchema = apiOkResponseDtoSchema(
  updateTablePropertiesResponseDataSchema
);
export const updateTablePropertiesErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapUpdateTablePropertiesResultToDto = (
  result: UpdateTablePropertiesResult
): Result<IUpdateTablePropertiesResponseDataDto, DomainError> =>
  mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));

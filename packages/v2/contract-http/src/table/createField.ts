import type { CreateFieldResult, ICreateFieldCommandInput } from '@teable/v2-core';
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
} from '../shared/http';
import type { ITableDto } from './dto';
import { mapTableToDto, tableDtoSchema } from './dto';

export type ICreateFieldRequestDto = ICreateFieldCommandInput;

export interface ICreateFieldResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type ICreateFieldResponseDto = IApiResponseDto<ICreateFieldResponseDataDto>;

export type ICreateFieldOkResponseDto = IApiOkResponseDto<ICreateFieldResponseDataDto>;
export type ICreateFieldErrorResponseDto = IApiErrorResponseDto;

export type ICreateFieldEndpointResult =
  | { status: 200; body: ICreateFieldOkResponseDto }
  | { status: 400; body: ICreateFieldErrorResponseDto }
  | { status: 404; body: ICreateFieldErrorResponseDto }
  | { status: 500; body: ICreateFieldErrorResponseDto };

export const createFieldResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const createFieldOkResponseSchema = apiOkResponseDtoSchema(createFieldResponseDataSchema);

export const createFieldErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateFieldResultToDto = (
  result: CreateFieldResult
): Result<ICreateFieldResponseDataDto, string> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

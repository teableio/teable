import type { DeleteFieldResult, IDeleteFieldCommandInput, DomainError } from '@teable/v2-core';
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

export type IDeleteFieldRequestDto = IDeleteFieldCommandInput;

export interface IDeleteFieldResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type IDeleteFieldResponseDto = IApiResponseDto<IDeleteFieldResponseDataDto>;

export type IDeleteFieldOkResponseDto = IApiOkResponseDto<IDeleteFieldResponseDataDto>;
export type IDeleteFieldErrorResponseDto = IApiErrorResponseDto;

export type IDeleteFieldEndpointResult =
  | { status: 200; body: IDeleteFieldOkResponseDto }
  | { status: HttpErrorStatus; body: IDeleteFieldErrorResponseDto };

export const deleteFieldResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const deleteFieldOkResponseSchema = apiOkResponseDtoSchema(deleteFieldResponseDataSchema);

export const deleteFieldErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDeleteFieldResultToDto = (
  result: DeleteFieldResult
): Result<IDeleteFieldResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

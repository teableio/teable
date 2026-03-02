import type {
  DomainError,
  DuplicateFieldResult,
  IDuplicateFieldCommandInput,
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

export type IDuplicateFieldRequestDto = IDuplicateFieldCommandInput;

export interface IDuplicateFieldResponseDataDto {
  table: ITableDto;
  newFieldId: string;
  events: Array<IDomainEventDto>;
}

export type IDuplicateFieldResponseDto = IApiResponseDto<IDuplicateFieldResponseDataDto>;

export type IDuplicateFieldOkResponseDto = IApiOkResponseDto<IDuplicateFieldResponseDataDto>;
export type IDuplicateFieldErrorResponseDto = IApiErrorResponseDto;

export type IDuplicateFieldEndpointResult =
  | { status: 200; body: IDuplicateFieldOkResponseDto }
  | { status: HttpErrorStatus; body: IDuplicateFieldErrorResponseDto };

export const duplicateFieldResponseDataSchema = z.object({
  table: tableDtoSchema,
  newFieldId: z.string(),
  events: z.array(domainEventDtoSchema),
});

export const duplicateFieldOkResponseSchema = apiOkResponseDtoSchema(
  duplicateFieldResponseDataSchema
);

export const duplicateFieldErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDuplicateFieldResultToDto = (
  result: DuplicateFieldResult
): Result<IDuplicateFieldResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    newFieldId: result.newField.id().toString(),
    events: result.events.map(mapDomainEventToDto),
  }));
};

import type { CreateRecordsResult, ICreateRecordsCommandInput, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
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
import type { ITableRecordDto } from './recordDto';
import { tableRecordDtoSchema } from './recordDto';

export type ICreateRecordsRequestDto = ICreateRecordsCommandInput;

export interface ICreateRecordsResponseDataDto {
  records: Array<ITableRecordDto>;
  events: Array<IDomainEventDto>;
}

export type ICreateRecordsResponseDto = IApiResponseDto<ICreateRecordsResponseDataDto>;

export type ICreateRecordsOkResponseDto = IApiOkResponseDto<ICreateRecordsResponseDataDto>;
export type ICreateRecordsErrorResponseDto = IApiErrorResponseDto;

export type ICreateRecordsEndpointResult =
  | { status: 201; body: ICreateRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateRecordsErrorResponseDto };

export const createRecordsResponseDataSchema = z.object({
  records: z.array(tableRecordDtoSchema),
  events: z.array(domainEventDtoSchema),
});

export const createRecordsOkResponseSchema = apiOkResponseDtoSchema(
  createRecordsResponseDataSchema
);

export const createRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateRecordsResultToDto = (
  result: CreateRecordsResult
): Result<ICreateRecordsResponseDataDto, DomainError> => {
  const recordDtos: ITableRecordDto[] = result.records.map((record) => ({
    id: record.id().toString(),
    fields: Object.fromEntries(
      record
        .fields()
        .entries()
        .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
    ),
  }));

  return ok({
    records: recordDtos,
    events: result.events.map(mapDomainEventToDto),
  });
};

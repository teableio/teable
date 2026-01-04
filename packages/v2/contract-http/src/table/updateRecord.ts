import type { UpdateRecordResult, IUpdateRecordCommandInput, DomainError } from '@teable/v2-core';
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

export type IUpdateRecordRequestDto = IUpdateRecordCommandInput;

export interface IUpdateRecordResponseDataDto {
  record: ITableRecordDto;
  events: Array<IDomainEventDto>;
}

export type IUpdateRecordResponseDto = IApiResponseDto<IUpdateRecordResponseDataDto>;

export type IUpdateRecordOkResponseDto = IApiOkResponseDto<IUpdateRecordResponseDataDto>;
export type IUpdateRecordErrorResponseDto = IApiErrorResponseDto;

export type IUpdateRecordEndpointResult =
  | { status: 200; body: IUpdateRecordOkResponseDto }
  | { status: HttpErrorStatus; body: IUpdateRecordErrorResponseDto };

export const updateRecordResponseDataSchema = z.object({
  record: tableRecordDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const updateRecordOkResponseSchema = apiOkResponseDtoSchema(updateRecordResponseDataSchema);

export const updateRecordErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapUpdateRecordResultToDto = (
  result: UpdateRecordResult
): Result<IUpdateRecordResponseDataDto, DomainError> => {
  const recordDto: ITableRecordDto = {
    id: result.record.id().toString(),
    fields: Object.fromEntries(
      result.record
        .fields()
        .entries()
        .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
    ),
  };

  return ok({
    record: recordDto,
    events: result.events.map(mapDomainEventToDto),
  });
};

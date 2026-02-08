import type { CreateRecordResult, ICreateRecordCommandInput, DomainError } from '@teable/v2-core';
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

export type ICreateRecordRequestDto = ICreateRecordCommandInput;

export interface ICreateRecordResponseDataDto {
  record: ITableRecordDto;
  events: Array<IDomainEventDto>;
}

export type ICreateRecordResponseDto = IApiResponseDto<ICreateRecordResponseDataDto>;

export type ICreateRecordOkResponseDto = IApiOkResponseDto<ICreateRecordResponseDataDto>;
export type ICreateRecordErrorResponseDto = IApiErrorResponseDto;

export type ICreateRecordEndpointResult =
  | { status: 201; body: ICreateRecordOkResponseDto }
  | { status: HttpErrorStatus; body: ICreateRecordErrorResponseDto };

export const createRecordResponseDataSchema = z.object({
  record: tableRecordDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const createRecordOkResponseSchema = apiOkResponseDtoSchema(createRecordResponseDataSchema);

export const createRecordErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapCreateRecordResultToDto = (
  result: CreateRecordResult
): Result<ICreateRecordResponseDataDto, DomainError> => {
  // Get base field values from the record
  const baseFields = Object.fromEntries(
    result.record
      .fields()
      .entries()
      .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
  );

  // Merge computed field changes if available
  let fields = result.computedChanges
    ? { ...baseFields, ...Object.fromEntries(result.computedChanges) }
    : baseFields;

  // Transform field keys using the mapping from handler
  if (result.fieldKeyMapping.size > 0) {
    const transformedFields: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(fields)) {
      const key = result.fieldKeyMapping.get(fieldId) ?? fieldId;
      transformedFields[key] = value;
    }
    fields = transformedFields;
  }

  const recordDto: ITableRecordDto = {
    id: result.record.id().toString(),
    fields,
  };

  return ok({
    record: recordDto,
    events: result.events.map(mapDomainEventToDto),
  });
};

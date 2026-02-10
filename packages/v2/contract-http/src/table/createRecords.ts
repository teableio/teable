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
  const { fieldKeyMapping, computedChangesByRecord } = result;

  const recordDtos: ITableRecordDto[] = result.records.map((record) => {
    const recordId = record.id().toString();

    // Get base field values from the record
    const baseFields = Object.fromEntries(
      record
        .fields()
        .entries()
        .map((entry) => {
          const fieldIdStr = entry.fieldId.toString();
          // Use original key from mapping if available, otherwise use fieldId
          const key = fieldKeyMapping.get(fieldIdStr) ?? fieldIdStr;
          return [key, entry.value.toValue()];
        })
    );

    // Merge computed field changes if available for this record
    // Apply fieldKeyMapping to computed changes to use consistent keys
    const computedChanges = computedChangesByRecord?.get(recordId);
    let fields = baseFields;
    if (computedChanges) {
      const mappedComputedChanges = Object.fromEntries(
        Array.from(computedChanges.entries()).map(([fieldId, value]) => {
          // Use original key from mapping if available, otherwise use fieldId
          const key = fieldKeyMapping.get(fieldId) ?? fieldId;
          return [key, value];
        })
      );
      fields = { ...baseFields, ...mappedComputedChanges };
    }

    return {
      id: recordId,
      fields,
    };
  });

  return ok({
    records: recordDtos,
    events: result.events.map(mapDomainEventToDto),
  });
};

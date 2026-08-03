import type { IUpdateRecordsCommandInput, UpdateRecordsResult, DomainError } from '@teable/v2-core';
import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

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

export type IUpdateRecordsRequestDto = IUpdateRecordsCommandInput;

export interface IUpdateRecordsResponseDataDto {
  updatedCount: number;
  records?: Array<ITableRecordDto>;
}

export type IUpdateRecordsResponseDto = IApiResponseDto<IUpdateRecordsResponseDataDto>;

export type IUpdateRecordsOkResponseDto = IApiOkResponseDto<IUpdateRecordsResponseDataDto>;
export type IUpdateRecordsErrorResponseDto = IApiErrorResponseDto;

export type IUpdateRecordsEndpointResult =
  | { status: 200; body: IUpdateRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IUpdateRecordsErrorResponseDto };

export const updateRecordsResponseDataSchema = z.object({
  updatedCount: z.number().int().min(0),
  records: z.array(tableRecordDtoSchema).optional(),
});

export const updateRecordsOkResponseSchema = apiOkResponseDtoSchema(
  updateRecordsResponseDataSchema
);

export const updateRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapUpdateRecordsResultToDto = (
  result: UpdateRecordsResult
): Result<IUpdateRecordsResponseDataDto, DomainError> => {
  const recordDtos = result.records?.map((record) => ({
    id: record.id().toString(),
    fields: Object.fromEntries(
      record
        .fields()
        .entries()
        .map((entry) => {
          const fieldIdStr = entry.fieldId.toString();
          const key = result.fieldKeyMapping.get(fieldIdStr) ?? fieldIdStr;
          return [key, entry.value.toValue()];
        })
    ),
  }));

  return ok({
    updatedCount: result.updatedCount,
    ...(recordDtos ? { records: recordDtos } : {}),
  });
};

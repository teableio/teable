import type { CreateRecordResult, DomainError, ISubmitRecordCommandInput } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { ICreateRecordResponseDataDto } from './createRecord';
import { createRecordResponseDataSchema, mapCreateRecordResultToDto } from './createRecord';
import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';

export type ISubmitRecordRequestDto = ISubmitRecordCommandInput;

export type ISubmitRecordResponseDataDto = ICreateRecordResponseDataDto;

export type ISubmitRecordResponseDto = IApiResponseDto<ISubmitRecordResponseDataDto>;

export type ISubmitRecordOkResponseDto = IApiOkResponseDto<ISubmitRecordResponseDataDto>;
export type ISubmitRecordErrorResponseDto = IApiErrorResponseDto;

export type ISubmitRecordEndpointResult =
  | { status: 201; body: ISubmitRecordOkResponseDto }
  | { status: HttpErrorStatus; body: ISubmitRecordErrorResponseDto };

export const submitRecordResponseDataSchema = createRecordResponseDataSchema;

export const submitRecordOkResponseSchema = apiOkResponseDtoSchema(submitRecordResponseDataSchema);

export const submitRecordErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapSubmitRecordResultToDto = (
  result: CreateRecordResult
): Result<ISubmitRecordResponseDataDto, DomainError> => {
  return mapCreateRecordResultToDto(result);
};

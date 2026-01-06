import type { DeleteRecordsResult, DomainError, IDeleteRecordsCommandInput } from '@teable/v2-core';
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

export type IDeleteRecordsRequestDto = IDeleteRecordsCommandInput;

export interface IDeleteRecordsResponseDataDto {
  deletedRecordIds: Array<string>;
  events: Array<IDomainEventDto>;
}

export type IDeleteRecordsResponseDto = IApiResponseDto<IDeleteRecordsResponseDataDto>;

export type IDeleteRecordsOkResponseDto = IApiOkResponseDto<IDeleteRecordsResponseDataDto>;
export type IDeleteRecordsErrorResponseDto = IApiErrorResponseDto;

export type IDeleteRecordsEndpointResult =
  | { status: 200; body: IDeleteRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IDeleteRecordsErrorResponseDto };

export const deleteRecordsResponseDataSchema = z.object({
  deletedRecordIds: z.array(z.string()),
  events: z.array(domainEventDtoSchema),
});

export const deleteRecordsOkResponseSchema = apiOkResponseDtoSchema(
  deleteRecordsResponseDataSchema
);

export const deleteRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapDeleteRecordsResultToDto = (
  result: DeleteRecordsResult
): Result<IDeleteRecordsResponseDataDto, DomainError> => {
  return ok({
    deletedRecordIds: [...result.deletedRecordIds],
    events: result.events.map(mapDomainEventToDto),
  });
};

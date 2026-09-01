import type {
  ArchiveRecordsResult,
  DomainError,
  IArchiveRecordsCommandInput,
} from '@teable/v2-core';
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

export type IArchiveRecordsRequestDto = IArchiveRecordsCommandInput;

export interface IArchiveRecordsResponseDataDto {
  archivedRecordIds: Array<string>;
  events: Array<IDomainEventDto>;
}

export type IArchiveRecordsResponseDto = IApiResponseDto<IArchiveRecordsResponseDataDto>;

export type IArchiveRecordsOkResponseDto = IApiOkResponseDto<IArchiveRecordsResponseDataDto>;
export type IArchiveRecordsErrorResponseDto = IApiErrorResponseDto;

export type IArchiveRecordsEndpointResult =
  | { status: 200; body: IArchiveRecordsOkResponseDto }
  | { status: HttpErrorStatus; body: IArchiveRecordsErrorResponseDto };

export const archiveRecordsResponseDataSchema = z.object({
  archivedRecordIds: z.array(z.string()),
  events: z.array(domainEventDtoSchema),
});

export const archiveRecordsOkResponseSchema = apiOkResponseDtoSchema(
  archiveRecordsResponseDataSchema
);

export const archiveRecordsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapArchiveRecordsResultToDto = (
  result: ArchiveRecordsResult
): Result<IArchiveRecordsResponseDataDto, DomainError> => {
  return ok({
    archivedRecordIds: [...result.archivedRecordIds],
    events: result.events.map(mapDomainEventToDto),
  });
};

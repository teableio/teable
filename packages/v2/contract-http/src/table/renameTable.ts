import type { IRenameTableCommandInput, RenameTableResult, DomainError } from '@teable/v2-core';
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

export type IRenameTableRequestDto = IRenameTableCommandInput;

export interface IRenameTableResponseDataDto {
  table: ITableDto;
  events: Array<IDomainEventDto>;
}

export type IRenameTableResponseDto = IApiResponseDto<IRenameTableResponseDataDto>;

export type IRenameTableOkResponseDto = IApiOkResponseDto<IRenameTableResponseDataDto>;
export type IRenameTableErrorResponseDto = IApiErrorResponseDto;

export type IRenameTableEndpointResult =
  | { status: 200; body: IRenameTableOkResponseDto }
  | { status: HttpErrorStatus; body: IRenameTableErrorResponseDto };

export const renameTableResponseDataSchema = z.object({
  table: tableDtoSchema,
  events: z.array(domainEventDtoSchema),
});

export const renameTableOkResponseSchema = apiOkResponseDtoSchema(renameTableResponseDataSchema);

export const renameTableErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapRenameTableResultToDto = (
  result: RenameTableResult
): Result<IRenameTableResponseDataDto, DomainError> => {
  return mapTableToDto(result.table).map((table) => ({
    table,
    events: result.events.map(mapDomainEventToDto),
  }));
};

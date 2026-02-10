import type { IPasteCommandInput, PasteResult, DomainError } from '@teable/v2-core';
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

export type IPasteRequestDto = IPasteCommandInput;

export interface IPasteResponseDataDto {
  /** Number of records updated */
  updatedCount: number;
  /** Number of records created */
  createdCount: number;
  /** IDs of created records (in order of creation) */
  createdRecordIds: ReadonlyArray<string>;
}

export type IPasteResponseDto = IApiResponseDto<IPasteResponseDataDto>;

export type IPasteOkResponseDto = IApiOkResponseDto<IPasteResponseDataDto>;
export type IPasteErrorResponseDto = IApiErrorResponseDto;

export type IPasteEndpointResult =
  | { status: 200; body: IPasteOkResponseDto }
  | { status: HttpErrorStatus; body: IPasteErrorResponseDto };

export const pasteResponseDataSchema = z.object({
  updatedCount: z.number().int().min(0),
  createdCount: z.number().int().min(0),
  createdRecordIds: z.array(z.string()).readonly(),
});

export const pasteOkResponseSchema = apiOkResponseDtoSchema(pasteResponseDataSchema);

export const pasteErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapPasteResultToDto = (
  result: PasteResult
): Result<IPasteResponseDataDto, DomainError> => {
  return ok({
    updatedCount: result.updatedCount,
    createdCount: result.createdCount,
    createdRecordIds: result.createdRecordIds,
  });
};

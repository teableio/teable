import type { IListViewsQueryInput, ListViewsResult } from '@teable/v2-core';
import { z } from 'zod';

import {
  apiErrorResponseDtoSchema,
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IApiOkResponseDto,
  type IApiResponseDto,
} from '../shared/http';
import type { IViewReadDto } from './viewReadDto';
import { viewReadDtoSchema } from './viewReadDto';

export type IListViewsRequestDto = IListViewsQueryInput;

export interface IListViewsResponseDataDto {
  views: ReadonlyArray<IViewReadDto>;
}

export type IListViewsResponseDto = IApiResponseDto<IListViewsResponseDataDto>;
export type IListViewsOkResponseDto = IApiOkResponseDto<IListViewsResponseDataDto>;
export type IListViewsErrorResponseDto = IApiErrorResponseDto;

export type IListViewsEndpointResult =
  | { status: 200; body: IListViewsOkResponseDto }
  | { status: HttpErrorStatus; body: IListViewsErrorResponseDto };

export const listViewsResponseDataSchema = z.object({
  views: z.array(viewReadDtoSchema),
});

export const listViewsOkResponseSchema = apiOkResponseDtoSchema(listViewsResponseDataSchema);
export const listViewsErrorResponseSchema = apiErrorResponseDtoSchema;

export const mapListViewsResultToDto = (result: ListViewsResult): IListViewsResponseDataDto => ({
  views: result.views,
});

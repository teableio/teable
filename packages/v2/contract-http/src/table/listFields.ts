import { z } from 'zod';

import {
  apiOkResponseDtoSchema,
  type HttpErrorStatus,
  type IApiErrorResponseDto,
} from '../shared/http';
import { fieldDtoSchema } from './dto';

/** Field metadata does not require table, view or record read authority. */
export const listFieldsRequestSchema = z.object({ tableId: z.string() }).strict();
export const listFieldsOkResponseSchema = apiOkResponseDtoSchema(
  z.object({ fields: z.array(fieldDtoSchema) })
);

export type IListFieldsRequestDto = z.input<typeof listFieldsRequestSchema>;
export type IListFieldsEndpointResult =
  | { status: 200; body: z.infer<typeof listFieldsOkResponseSchema> }
  | { status: HttpErrorStatus; body: IApiErrorResponseDto };

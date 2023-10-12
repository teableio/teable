import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_IDS_FROM_RANGES_URL = '/table/{tableId}/view/{viewId}/selection/getIdsFromRanges';

export enum RangeType {
  Rows = 'rows',
  Columns = 'columns',
}

export const cellSchema = z.tuple([z.number(), z.number()]);

export type ICell = z.infer<typeof cellSchema>;

export const rangesSchema = z.object({
  ranges: z
    .string()
    .refine((value) => z.array(cellSchema).min(1).safeParse(JSON.parse(value)).success, {
      message: 'The range parameter must be a valid 2D array with even length.',
    })
    .openapi({
      description:
        'The parameter "ranges" is used to represent the coordinates [column, row][] of a selected range in a table. ',
      example: '[[0, 0],[1, 1]]',
    }),
  type: z.nativeEnum(RangeType).optional().openapi({
    description: 'Types of non-contiguous selections',
    example: RangeType.Columns,
  }),
});

export enum IdReturnType {
  RecordId = 'recordId',
  FieldId = 'fieldId',
  All = 'all',
}

export const rangesToIdRoSchema = rangesSchema.merge(
  z.object({
    returnType: z.nativeEnum(IdReturnType).openapi({ description: 'Define which Id to return.' }),
  })
);

export type IRangesToIdRo = z.infer<typeof rangesToIdRoSchema>;

export const rangesToIdVoSchema = z.object({
  recordIds: z.array(z.string()).optional(),
  fieldIds: z.array(z.string()).optional(),
});

export type IRangesToIdVo = z.infer<typeof rangesToIdVoSchema>;

export const GetIdsFromRangesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_IDS_FROM_RANGES_URL,
  description: 'Get the id of records and fields from the selected range',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    query: rangesToIdRoSchema,
  },
  responses: {
    200: {
      description: 'Copy content',
      content: {
        'application/json': {
          schema: rangesToIdVoSchema,
        },
      },
    },
  },
  tags: ['selection'],
});

export const getIdsFromRanges = async (
  tableId: string,
  viewId: string,
  rangesToIdRo: IRangesToIdRo
) => {
  return axios.get<IRangesToIdVo>(
    urlBuilder(GET_IDS_FROM_RANGES_URL, {
      tableId,
      viewId,
    }),
    {
      params: rangesToIdRo,
    }
  );
};

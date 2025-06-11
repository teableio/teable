import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { IdPrefix, filterSchema, groupSchema } from '@teable/core';
import { axios } from '../axios';
import { contentQueryBaseSchema, orderBySchema } from '../record';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_IDS_FROM_RANGES_URL = '/table/{tableId}/selection/range-to-id';

export enum RangeType {
  Rows = 'rows',
  Columns = 'columns',
}

export const cellSchema = z.tuple([z.number(), z.number()]);

export type ICell = z.infer<typeof cellSchema>;

const rangeTypeSchema = z.nativeEnum(RangeType).optional().openapi({
  description: 'Types of non-contiguous selections',
  example: RangeType.Columns,
});

export const rangesSchema = z.array(cellSchema).min(1, {
  message: 'The range parameter must be a valid 2D array with even length.',
});

export const rangesRoSchema = contentQueryBaseSchema.extend({
  filter: filterSchema.optional(),
  orderBy: orderBySchema.optional(),
  groupBy: groupSchema.optional(),
  collapsedGroupIds: z.array(z.string()).optional(),
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().openapi({
    description:
      'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained',
  }),
  ranges: rangesSchema.openapi({
    description:
      'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
    example: [
      [0, 0],
      [1, 1],
    ],
  }),
  type: rangeTypeSchema,
});

export type IRangesRo = z.infer<typeof rangesRoSchema>;

export const rangesQuerySchema = contentQueryBaseSchema.extend({
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().openapi({
    description:
      'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained',
  }),
  ranges: z
    .string()
    .transform((value, ctx) => {
      const parsingResult = rangesSchema.safeParse(JSON.parse(value));
      if (!parsingResult.success) {
        parsingResult.error.issues.forEach((issue) => {
          ctx.addIssue(issue);
        });
        return z.NEVER;
      }
      return parsingResult.data;
    })
    .openapi({
      type: 'string',
      description:
        'The parameter "ranges" is used to represent the coordinates [column, row][] of a selected range in a table. ',
      example: '[[0, 0], [1, 1]]',
    }),
  type: rangeTypeSchema,
});

export enum IdReturnType {
  RecordId = 'recordId',
  FieldId = 'fieldId',
  All = 'all',
}

export const rangesToIdQuerySchema = rangesQuerySchema.extend({
  returnType: z.nativeEnum(IdReturnType).openapi({ description: 'Define which Id to return.' }),
});

export type IRangesToIdQuery = z.infer<typeof rangesToIdQuerySchema>;

export const rangesToIdVoSchema = z.object({
  recordIds: z.array(z.string()).optional(),
  fieldIds: z.array(z.string()).optional(),
});

export type IRangesToIdVo = z.infer<typeof rangesToIdVoSchema>;

export const GetIdsFromRangesRoute: RouteConfig = registerRoute({
  method: 'get',
  path: GET_IDS_FROM_RANGES_URL,
  summary: 'Get ids from range',
  description:
    'Retrieve record and field identifiers based on the selected range coordinates in a table',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    query: rangesToIdQuerySchema,
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

export const getIdsFromRanges = async (tableId: string, rangesToIdQuery: IRangesToIdQuery) => {
  return axios.get<IRangesToIdVo>(
    urlBuilder(GET_IDS_FROM_RANGES_URL, {
      tableId,
    }),
    {
      params: {
        ...rangesToIdQuery,
        filter: JSON.stringify(rangesToIdQuery.filter),
        orderBy: JSON.stringify(rangesToIdQuery.orderBy),
        ranges: JSON.stringify(rangesToIdQuery.ranges),
      },
    }
  );
};
